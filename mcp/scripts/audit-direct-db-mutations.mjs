import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SCAN_ROOTS = [
  "src",
  "apps/backend",
  "supabase",
  "scripts",
  "ops",
  ".github",
  "agent-backend"
];
const IGNORED_DIRECTORIES = new Set([".git", ".next", "node_modules", "coverage", "dist", "build"]);
const EXCLUDED_FILES = new Set([
  "scripts/audit-direct-db-mutations.mjs",
  "scripts/direct-db-mutation-baseline.json"
]);
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".ps1", ".yml", ".yaml", ".json"]);
const SERVICE_ROLE_PATTERN = /SUPABASE_SERVICE_ROLE_KEY|supabaseServiceRoleKey|service_role/i;
const MUTATION_METHOD_PATTERN = /\bmethod\s*:\s*["'`](POST|PUT|PATCH|DELETE)["'`]|\bmethod\s*=\s*["'`](POST|PUT|PATCH|DELETE)["'`]|\brequests\.(post|put|patch|delete)\s*\(/i;
const READ_METHOD_PATTERN = /\bmethod\s*:\s*["'`]GET["'`]|\bmethod\s*=\s*["'`]GET["'`]|\brequests\.get\s*\(/i;

function normalizePath(value) {
  return value.split(path.sep).join("/");
}

function normalizeToken(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/["'`]/g, "")
    .trim()
    .slice(0, 180);
}

function fingerprintOf(relativePath, ruleCode, functionName, target) {
  return createHash("sha256")
    .update([relativePath, ruleCode, functionName, target].join("\n"))
    .digest("hex")
    .slice(0, 24);
}

function classifyConsumer(relativePath, content) {
  if (relativePath.startsWith("src/")) {
    if (/^[\s\r\n]*["']use client["'];?/m.test(content)) return "browser";
    return "next-server";
  }
  if (relativePath.startsWith("apps/backend/foundation/gateway")) return "gateway";
  if (relativePath.startsWith("apps/backend/")) return "backend";
  if (relativePath.startsWith("supabase/functions/")) return "edge";
  if (relativePath.startsWith("scripts/")) return "script";
  if (relativePath.startsWith(".github/")) return "ci";
  if (relativePath.startsWith("ops/")) return "admin";
  if (relativePath.startsWith("agent-backend/")) return "backend";
  return "unknown";
}

function lineNumberAt(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

function functionRanges(content) {
  const starts = [];
  const patterns = [
    /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g,
    /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/g,
    /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?[A-Za-z_$][\w$]*\s*=>\s*\{/g
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const braceIndex = content.indexOf("{", match.index);
      if (braceIndex >= 0) starts.push({ name: match[1], start: match.index, braceIndex });
    }
  }

  const ranges = [];
  for (const item of starts.sort((a, b) => a.start - b.start)) {
    let depth = 0;
    let quote = null;
    let escaped = false;
    let end = content.length;
    for (let index = item.braceIndex; index < content.length; index += 1) {
      const char = content[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (quote) {
        if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'" || char === "`") {
        quote = char;
        continue;
      }
      if (char === "{") depth += 1;
      if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          end = index + 1;
          break;
        }
      }
    }
    ranges.push({ ...item, end, text: content.slice(item.start, end) });
  }
  return ranges;
}

function ownerAt(ranges, index, content) {
  const candidates = ranges.filter((range) => range.start <= index && index < range.end);
  if (candidates.length === 0) return { name: "<file>", start: 0, end: content.length, text: content };
  return candidates.sort((a, b) => b.start - a.start)[0];
}

function operationFrom(block, fallback = "unknown") {
  if (MUTATION_METHOD_PATTERN.test(block)) return "mutation";
  if (READ_METHOD_PATTERN.test(block)) return "read";
  return fallback;
}

function targetsFrom(text, regex, fallback) {
  const values = new Set();
  for (const match of text.matchAll(regex)) values.add(normalizeToken(match[1] || fallback));
  if (values.size === 0) values.add(fallback);
  return [...values];
}

function detectFindings(relativePath, content) {
  const ranges = functionRanges(content);
  const findings = [];
  const emitted = new Set();
  const consumer = classifyConsumer(relativePath, content);
  const usesServiceRole = SERVICE_ROLE_PATTERN.test(content);

  function emit({ index, functionName, ruleCode, operation, providerSurface, target, evidence }) {
    const normalizedTarget = normalizeToken(target || "<dynamic>");
    const fingerprint = fingerprintOf(relativePath, ruleCode, functionName, normalizedTarget);
    if (emitted.has(fingerprint)) return;
    emitted.add(fingerprint);
    findings.push({
      fingerprint,
      file: relativePath,
      line: lineNumberAt(content, index),
      functionName,
      consumer,
      operation,
      providerSurface,
      classification: "unclassified",
      ruleCode,
      target: normalizedTarget,
      reason: "No audited baseline entry matches this finding.",
      replacementTarget: null,
      owner: null,
      replacementPhase: null,
      usesServiceRole,
      evidence: normalizeToken(evidence)
    });
  }

  for (const [ruleCode, regex] of [
    ["SUPABASE_SDK_IMPORT", /@supabase\/supabase-js/g],
    ["SUPABASE_CREATE_CLIENT", /\bcreateClient\s*\(/g]
  ]) {
    for (const match of content.matchAll(regex)) {
      const owner = ownerAt(ranges, match.index, content);
      emit({ index: match.index, functionName: owner.name, ruleCode, operation: "unknown", providerSurface: "sdk", target: match[0], evidence: match[0] });
    }
  }

  const helperRules = [
    {
      code: "HELPER_REST_CALL",
      surface: "rest",
      regex: /\bsupabaseRest\s*\(/g,
      targetRegex: /supabaseRest\s*\(\s*[^,]+,\s*["'`]([^"'`]+)["'`]/g,
      fallback: "<dynamic-rest-resource>",
      operation: (block) => operationFrom(block, "read")
    },
    {
      code: "HELPER_RPC_CALL",
      surface: "rpc",
      regex: /\bsupabaseRpc\s*\(/g,
      targetRegex: /supabaseRpc\s*\(\s*(?:[^,]+,\s*)?["'`]([^"'`]+)["'`]/g,
      fallback: "<dynamic-rpc>",
      operation: () => "unknown"
    },
    {
      code: "HELPER_INSERT_CALL",
      surface: "rest",
      regex: /\bsupabaseInsert\s*\(/g,
      targetRegex: /supabaseInsert\s*\(\s*["'`]([^"'`]+)["'`]/g,
      fallback: "<dynamic-table>",
      operation: () => "mutation"
    },
    {
      code: "HELPER_PATCH_CALL",
      surface: "rest",
      regex: /\bsupabasePatch\s*\(/g,
      targetRegex: /supabasePatch\s*\(\s*["'`]([^"'`]+)["'`]/g,
      fallback: "<dynamic-table>",
      operation: () => "mutation"
    },
    {
      code: "HELPER_DELETE_CALL",
      surface: "rest",
      regex: /\bsupabaseDelete\s*\(/g,
      targetRegex: /supabaseDelete\s*\(\s*["'`]([^"'`]+)["'`]/g,
      fallback: "<dynamic-table>",
      operation: () => "mutation"
    }
  ];

  for (const rule of helperRules) {
    for (const match of content.matchAll(rule.regex)) {
      const owner = ownerAt(ranges, match.index, content);
      for (const target of targetsFrom(owner.text, rule.targetRegex, rule.fallback)) {
        emit({ index: match.index, functionName: owner.name, ruleCode: rule.code, operation: rule.operation(owner.text), providerSurface: rule.surface, target, evidence: match[0] });
      }
    }
  }

  for (const rule of [
    { code: "REST_HTTP_CALL", surface: "rest", regex: /\/rest\/v1\//g, targetRegex: /\/rest\/v1\/([^?"'`\s)]+)/g, fallback: "<dynamic-rest-path>" },
    { code: "EDGE_HTTP_CALL", surface: "edge-function", regex: /\/functions\/v1\//g, targetRegex: /\/functions\/v1\/([^?"'`\s)]+)/g, fallback: "<dynamic-edge-function>" }
  ]) {
    for (const match of content.matchAll(rule.regex)) {
      const owner = ownerAt(ranges, match.index, content);
      for (const target of targetsFrom(owner.text, rule.targetRegex, rule.fallback)) {
        emit({ index: match.index, functionName: owner.name, ruleCode: rule.code, operation: operationFrom(owner.text, "read"), providerSurface: rule.surface, target, evidence: match[0] });
      }
    }
  }

  const sdkMutation = /\bsupabase(?:Client)?\.from\s*\(\s*["'`]([^"'`]+)["'`]\s*\)[\s\S]{0,500}?\.(insert|update|upsert|delete)\s*\(/g;
  for (const match of content.matchAll(sdkMutation)) {
    const owner = ownerAt(ranges, match.index, content);
    emit({ index: match.index, functionName: owner.name, ruleCode: `SDK_${match[2].toUpperCase()}`, operation: "mutation", providerSurface: "sdk", target: match[1], evidence: match[0] });
  }

  const sdkFrom = /\bsupabase(?:Client)?\.from\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
  for (const match of content.matchAll(sdkFrom)) {
    const owner = ownerAt(ranges, match.index, content);
    const tail = content.slice(match.index, Math.min(content.length, match.index + 500));
    if (/\.(insert|update|upsert|delete)\s*\(/.test(tail)) continue;
    emit({ index: match.index, functionName: owner.name, ruleCode: "SDK_FROM_READ", operation: "read", providerSurface: "sdk", target: match[1], evidence: match[0] });
  }

  for (const match of content.matchAll(/\bsupabase(?:Client)?\.rpc\s*\(\s*["'`]([^"'`]+)["'`]/g)) {
    const owner = ownerAt(ranges, match.index, content);
    emit({ index: match.index, functionName: owner.name, ruleCode: "SDK_RPC_CALL", operation: "unknown", providerSurface: "rpc", target: match[1], evidence: match[0] });
  }

  for (const match of content.matchAll(/\bsupabase(?:Client)?\.storage\.from\s*\(\s*["'`]([^"'`]+)["'`]/g)) {
    const owner = ownerAt(ranges, match.index, content);
    emit({ index: match.index, functionName: owner.name, ruleCode: "STORAGE_FROM", operation: "unknown", providerSurface: "storage", target: match[1], evidence: match[0] });
  }

  for (const match of content.matchAll(/\bsupabase(?:Client)?\.functions\.invoke\s*\(\s*["'`]([^"'`]+)["'`]/g)) {
    const owner = ownerAt(ranges, match.index, content);
    emit({ index: match.index, functionName: owner.name, ruleCode: "FUNCTIONS_INVOKE", operation: "unknown", providerSurface: "edge-function", target: match[1], evidence: match[0] });
  }

  return findings;
}

async function filesBelow(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  const info = await stat(absolutePath).catch(() => null);
  if (!info) return [];
  if (info.isFile()) return [normalizePath(relativePath)];

  const files = [];
  for (const entry of await readdir(absolutePath, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const child = normalizePath(path.join(relativePath, entry.name));
    if (entry.isDirectory()) files.push(...await filesBelow(root, child));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(child);
  }
  return files;
}

function validateBaseline(entries) {
  const errors = [];
  const seen = new Set();
  for (const entry of entries) {
    if (!entry.fingerprint) errors.push("baseline_entry_missing_fingerprint");
    if (seen.has(entry.fingerprint)) errors.push(`duplicate_baseline_fingerprint:${entry.fingerprint}`);
    seen.add(entry.fingerprint);
    for (const field of ["classification", "operation", "owner", "reason", "replacementPhase"]) {
      if (!entry[field]) errors.push(`baseline_entry_missing_${field}:${entry.fingerprint || "unknown"}`);
    }
    if (!["approved-boundary", "known-legacy-debt"].includes(entry.classification)) {
      errors.push(`invalid_baseline_classification:${entry.fingerprint || "unknown"}`);
    }
  }
  return errors;
}

function applyBaseline(findings, entries) {
  const byFingerprint = new Map(entries.map((entry) => [entry.fingerprint, entry]));
  return findings.map((finding) => {
    const entry = byFingerprint.get(finding.fingerprint);
    if (!entry) return finding;
    return {
      ...finding,
      classification: entry.classification,
      operation: entry.operation,
      owner: entry.owner,
      reason: entry.reason,
      replacementPhase: entry.replacementPhase,
      replacementTarget: entry.replacementTarget || null
    };
  });
}

function validateFindings(findings, entries, baselineErrors) {
  const errors = [...baselineErrors];
  const live = new Set(findings.map((finding) => finding.fingerprint));
  for (const entry of entries) if (!live.has(entry.fingerprint)) errors.push(`stale_baseline:${entry.fingerprint}`);

  for (const finding of findings) {
    if (finding.operation === "mutation" && finding.consumer === "browser") {
      finding.classification = "forbidden";
      finding.reason = "Browser/client code must not mutate Supabase directly.";
      errors.push(`browser_direct_mutation:${finding.fingerprint}`);
    }
    if (finding.classification === "unclassified") errors.push(`unclassified_finding:${finding.fingerprint}`);
    if (finding.operation === "mutation" && /READ/i.test(finding.ruleCode)) errors.push(`mutation_mislabeled_read:${finding.fingerprint}`);
    if (
      finding.operation === "mutation" &&
      finding.usesServiceRole &&
      !["backend", "edge", "script", "admin", "ci"].includes(finding.consumer) &&
      finding.classification !== "known-legacy-debt"
    ) {
      errors.push(`service_role_wrong_consumer:${finding.fingerprint}`);
    }
    if (finding.operation === "mutation" && finding.consumer === "edge" && finding.classification !== "known-legacy-debt") {
      errors.push(`public_edge_mutation_not_legacy_debt:${finding.fingerprint}`);
    }
  }
  return [...new Set(errors)].sort();
}

function summarize(findings) {
  const summary = { total: findings.length, approved: 0, legacyDebt: 0, forbidden: 0, unclassified: 0, read: 0, mutation: 0, unknownOperation: 0 };
  for (const finding of findings) {
    if (finding.classification === "approved-boundary") summary.approved += 1;
    if (finding.classification === "known-legacy-debt") summary.legacyDebt += 1;
    if (finding.classification === "forbidden") summary.forbidden += 1;
    if (finding.classification === "unclassified") summary.unclassified += 1;
    if (finding.operation === "read") summary.read += 1;
    else if (finding.operation === "mutation") summary.mutation += 1;
    else summary.unknownOperation += 1;
  }
  return summary;
}

function textReport(result) {
  const lines = [
    result.errors.length ? "direct_db_mutation_audit_failed" : "direct_db_mutation_audit_passed",
    `files=${result.files.length}`,
    `findings=${result.summary.total}`,
    `approved=${result.summary.approved}`,
    `legacy_debt=${result.summary.legacyDebt}`,
    `forbidden=${result.summary.forbidden}`,
    `unclassified=${result.summary.unclassified}`,
    `read=${result.summary.read}`,
    `mutation=${result.summary.mutation}`,
    `unknown_operation=${result.summary.unknownOperation}`
  ];
  if (result.errors.length) {
    lines.push("", "errors:");
    for (const error of result.errors) lines.push(`- ${error}`);
  }
  if (result.findings.length) {
    lines.push("", "findings:");
    for (const finding of result.findings) {
      lines.push(
        `- ${finding.fingerprint} ${finding.classification} ${finding.operation} ${finding.consumer} ${finding.providerSurface} ${finding.file}:${finding.line} ${finding.functionName} ${finding.ruleCode} target=${finding.target}`,
        `  reason=${finding.reason}`,
        `  owner=${finding.owner || "-"} replacementPhase=${finding.replacementPhase || "-"} replacementTarget=${finding.replacementTarget || "-"}`
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export async function scanRepository({
  root = process.cwd(),
  scanRoots = DEFAULT_SCAN_ROOTS,
  baselinePath = "scripts/direct-db-mutation-baseline.json",
  writeReports = true,
  findingsTextPath = "direct-db-mutation-findings.txt",
  findingsJsonPath = "direct-db-mutation-findings.json"
} = {}) {
  const files = [];
  for (const scanRoot of scanRoots) files.push(...await filesBelow(root, scanRoot));
  const uniqueFiles = [...new Set(files.map(normalizePath))]
    .filter((file) => !EXCLUDED_FILES.has(file))
    .sort();

  const rawFindings = [];
  for (const relativePath of uniqueFiles) {
    const content = await readFile(path.join(root, relativePath), "utf8").catch(() => "");
    rawFindings.push(...detectFindings(relativePath, content));
  }
  rawFindings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.ruleCode.localeCompare(b.ruleCode));

  const baselineDocument = JSON.parse(await readFile(path.join(root, baselinePath), "utf8"));
  const entries = Array.isArray(baselineDocument.entries) ? baselineDocument.entries : [];
  const findings = applyBaseline(rawFindings, entries);
  const errors = validateFindings(findings, entries, validateBaseline(entries));
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scanRoots,
    files: uniqueFiles,
    summary: summarize(findings),
    errors,
    findings
  };

  if (writeReports) {
    await writeFile(path.join(root, findingsTextPath), textReport(result), "utf8");
    await writeFile(path.join(root, findingsJsonPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  return result;
}

async function main() {
  try {
    const result = await scanRepository();
    const report = textReport(result);
    if (result.errors.length) {
      console.error(report.trimEnd());
      process.exitCode = 1;
    } else {
      console.log(report.trimEnd());
    }
  } catch (error) {
    const result = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      scanRoots: DEFAULT_SCAN_ROOTS,
      files: [],
      summary: summarize([]),
      errors: [`scanner_error:${error?.message || String(error)}`],
      findings: []
    };
    await writeFile("direct-db-mutation-findings.txt", textReport(result), "utf8").catch(() => {});
    await writeFile("direct-db-mutation-findings.json", `${JSON.stringify(result, null, 2)}\n`, "utf8").catch(() => {});
    console.error(textReport(result).trimEnd());
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
