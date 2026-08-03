import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { spawnSync } from "node:child_process";

const EXPECTED_GROUPS = 7;
const EXPECTED_ITEMS = 52;
const MAX_BLOB_BYTES = 4 * 1024 * 1024;
const endpoint = "/api/mcp-report-settings?groupType=market_report&includeInactive=1";
const deployments = [
  "https://mcp-field-4m339eob5-binhnxwjfjxms-projects.vercel.app",
  "https://mcp-field-2iusuwl4k-binhnxwjfjxms-projects.vercel.app",
  "https://mcp-field-4ovon9igh-binhnxwjfjxms-projects.vercel.app",
  "https://mcp-field-95m6so4mf-binhnxwjfjxms-projects.vercel.app",
  "https://mcp-field-bhdi5l7vy-binhnxwjfjxms-projects.vercel.app"
];
const textExtensions = new Set([
  ".csv", ".js", ".json", ".jsonl", ".md", ".mjs", ".sql", ".ts", ".tsx", ".txt", ".yaml", ".yml"
]);
const candidatePathPattern = /(mcp|report|setting|seed|snapshot|dump|migration|export|backup)/i;

function text(value) {
  return String(value ?? "").trim();
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])])
    );
  }
  return value;
}

function groupIdOf(value) {
  return text(value?.id ?? value?.groupId ?? value?.group_id);
}

function groupKeyOf(value) {
  return text(value?.key ?? value?.groupKey ?? value?.group_key);
}

function itemIdOf(value) {
  return text(value?.id ?? value?.itemId ?? value?.item_id);
}

function itemKeyOf(value) {
  return text(value?.key ?? value?.itemKey ?? value?.item_key);
}

function statusOf(value) {
  return text(value?.status).toLowerCase();
}

function validateFlatSnapshot(sourceGroups, sourceItems) {
  if (!Array.isArray(sourceGroups) || sourceGroups.length !== EXPECTED_GROUPS) return null;
  if (!Array.isArray(sourceItems) || sourceItems.length !== EXPECTED_ITEMS) return null;

  const groups = [];
  const items = [];
  const groupIds = new Set();
  const groupKeys = new Set();
  const itemIds = new Set();
  const itemKeys = new Set();

  for (const sourceGroup of sourceGroups) {
    if (!sourceGroup || typeof sourceGroup !== "object" || Array.isArray(sourceGroup)) return null;
    const groupId = groupIdOf(sourceGroup);
    const groupKey = groupKeyOf(sourceGroup);
    const title = text(sourceGroup.title ?? sourceGroup.groupName ?? sourceGroup.group_name);
    if (!groupId || !groupKey || !title || statusOf(sourceGroup) !== "active") return null;
    if (groupIds.has(groupId) || groupKeys.has(groupKey)) return null;
    groupIds.add(groupId);
    groupKeys.add(groupKey);
    const { items: _nestedItems, ...group } = sourceGroup;
    groups.push(group);
  }

  for (const sourceItem of sourceItems) {
    if (!sourceItem || typeof sourceItem !== "object" || Array.isArray(sourceItem)) return null;
    const itemId = itemIdOf(sourceItem);
    const itemKey = itemKeyOf(sourceItem);
    const groupId = text(sourceItem.groupId ?? sourceItem.group_id);
    const label = text(sourceItem.label ?? sourceItem.settingName ?? sourceItem.setting_name);
    const identity = `${groupId}:${itemKey}`;
    if (!itemId || !itemKey || !groupIds.has(groupId) || !label || statusOf(sourceItem) !== "active") return null;
    if (itemIds.has(itemId) || itemKeys.has(identity)) return null;
    itemIds.add(itemId);
    itemKeys.add(identity);
    items.push(sourceItem);
  }

  return { groups, items };
}

function validateNestedSnapshot(sourceGroups) {
  if (!Array.isArray(sourceGroups) || sourceGroups.length !== EXPECTED_GROUPS) return null;
  const flatItems = [];
  for (const group of sourceGroups) {
    if (!Array.isArray(group?.items)) return null;
    const groupId = groupIdOf(group);
    for (const item of group.items) {
      flatItems.push({ ...item, groupId: text(item?.groupId ?? item?.group_id) || groupId });
    }
  }
  return validateFlatSnapshot(sourceGroups, flatItems);
}

function validateSnapshot(payload) {
  const containers = [
    payload,
    payload?.data,
    payload?.snapshot,
    payload?.snapshot?.data,
    payload?.artifact,
    payload?.artifact?.data
  ].filter(Boolean);

  for (const container of containers) {
    const groups = container?.groups;
    if (!Array.isArray(groups)) continue;
    const nested = validateNestedSnapshot(groups);
    if (nested) return nested;
    const flat = validateFlatSnapshot(groups, container?.items);
    if (flat) return flat;
  }
  return null;
}

function requestDeployment(deployment, index, token, exportDir) {
  const candidateFile = join(exportDir, `candidate-${index}.json`);
  const result = spawnSync(
    "npx",
    [
      "--yes",
      "vercel@latest",
      "curl",
      endpoint,
      "--deployment",
      deployment,
      "--token",
      token,
      "--no-color",
      "--silent",
      "--show-error",
      "--output",
      candidateFile,
      "--write-out",
      "%{http_code}"
    ],
    {
      encoding: "utf8",
      env: process.env,
      maxBuffer: 10 * 1024 * 1024
    }
  );

  const statusMatch = text(result.stdout).match(/(\d{3})$/);
  return {
    candidateFile,
    status: statusMatch?.[1] || "000",
    commandOk: result.status === 0
  };
}

function git(args, options = {}) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024
  });
  if (result.status !== 0) return null;
  return result.stdout;
}

function stripSqlCasts(value) {
  let current = text(value);
  while (/::\s*[a-zA-Z0-9_."\[\]]+\s*$/.test(current)) {
    current = current.replace(/::\s*[a-zA-Z0-9_."\[\]]+\s*$/, "").trim();
  }
  return current;
}

function parseSqlValue(raw) {
  const value = stripSqlCasts(raw);
  if (/^null$/i.test(value)) return null;
  if (/^true$/i.test(value)) return true;
  if (/^false$/i.test(value)) return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith("'") && value.endsWith("'")) {
    const decoded = value.slice(1, -1).replace(/''/g, "'");
    try {
      return JSON.parse(decoded);
    } catch {
      return decoded;
    }
  }
  return value;
}

function findClosingParen(source, openIndex) {
  let depth = 0;
  let quote = "";
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (quote === "'") {
      if (char === "'" && source[index + 1] === "'") {
        index += 1;
      } else if (char === "'") {
        quote = "";
      }
      continue;
    }
    if (quote === '"') {
      if (char === '"' && source[index + 1] === '"') {
        index += 1;
      } else if (char === '"') {
        quote = "";
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitSqlFields(tuple) {
  const fields = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let index = 0; index < tuple.length; index += 1) {
    const char = tuple[index];
    if (quote === "'") {
      if (char === "'" && tuple[index + 1] === "'") index += 1;
      else if (char === "'") quote = "";
      continue;
    }
    if (quote === '"') {
      if (char === '"' && tuple[index + 1] === '"') index += 1;
      else if (char === '"') quote = "";
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[") depth += 1;
    if (char === ")" || char === "]") depth -= 1;
    if (char === "," && depth === 0) {
      fields.push(tuple.slice(start, index));
      start = index + 1;
    }
  }
  fields.push(tuple.slice(start));
  return fields.map(parseSqlValue);
}

function extractSqlRows(source, tableName) {
  const rows = [];
  const pattern = new RegExp(`insert\\s+into\\s+(?:public\\.)?${tableName}\\b`, "gi");
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const columnOpen = source.indexOf("(", pattern.lastIndex);
    if (columnOpen < 0) continue;
    const columnClose = findClosingParen(source, columnOpen);
    if (columnClose < 0) continue;
    const columns = source
      .slice(columnOpen + 1, columnClose)
      .split(",")
      .map((column) => text(column).replace(/^"|"$/g, ""));
    const valuesMatch = /\bvalues\b/gi;
    valuesMatch.lastIndex = columnClose + 1;
    const valuesToken = valuesMatch.exec(source);
    if (!valuesToken || valuesToken.index > source.indexOf(";", columnClose + 1)) continue;

    let cursor = valuesMatch.lastIndex;
    while (cursor < source.length) {
      while (/[\s,]/.test(source[cursor] || "")) cursor += 1;
      if (/^on\s+conflict\b/i.test(source.slice(cursor)) || source[cursor] === ";") break;
      if (source[cursor] !== "(") break;
      const tupleClose = findClosingParen(source, cursor);
      if (tupleClose < 0) break;
      const values = splitSqlFields(source.slice(cursor + 1, tupleClose));
      if (values.length === columns.length) {
        rows.push(Object.fromEntries(columns.map((column, index) => [column, values[index]])));
      }
      cursor = tupleClose + 1;
    }
    pattern.lastIndex = cursor;
  }
  return rows;
}

function sqlSnapshot(source) {
  const rawGroups = extractSqlRows(source, "mcp_setting_groups");
  const rawItems = extractSqlRows(source, "mcp_setting_items");
  if (rawGroups.length !== EXPECTED_GROUPS || rawItems.length !== EXPECTED_ITEMS) return null;

  const groups = rawGroups.map((row) => ({
    ...row,
    id: row.id,
    key: row.group_key,
    title: row.title,
    status: row.status,
    sortOrder: row.sort_order,
    description: row.description,
    type: row.group_type,
    meta: row.raw_payload
  }));
  const items = rawItems.map((row) => ({
    ...row,
    id: row.id,
    groupId: row.group_id,
    key: row.item_key,
    label: row.label,
    value: row.value,
    category: row.category,
    brandName: row.brand_name,
    productId: row.product_id,
    status: row.status,
    sortOrder: row.sort_order,
    meta: row.raw_payload
  }));
  return validateFlatSnapshot(groups, items);
}

function parseCandidateContent(content) {
  const trimmed = content.trim();
  if (!trimmed) return null;
  try {
    const json = JSON.parse(trimmed);
    const snapshot = validateSnapshot(json);
    if (snapshot) return snapshot;
  } catch {
    // Continue to SQL extraction.
  }
  if (/mcp_setting_groups/i.test(content) && /mcp_setting_items/i.test(content)) {
    return sqlSnapshot(content);
  }
  return null;
}

function gitHistorySnapshot() {
  const objectList = git(["rev-list", "--objects", "--all"]);
  if (!objectList) throw new Error("git_history_object_list_failed");
  const seen = new Set();
  const candidates = [];

  for (const line of objectList.split(/\r?\n/)) {
    const separator = line.indexOf(" ");
    if (separator < 1) continue;
    const sha = line.slice(0, separator);
    const path = line.slice(separator + 1);
    const extension = extname(path).toLowerCase();
    if (!textExtensions.has(extension) || !candidatePathPattern.test(path) || seen.has(sha)) continue;
    seen.add(sha);
    candidates.push({ sha, path });
  }

  for (const candidate of candidates) {
    const type = text(git(["cat-file", "-t", candidate.sha], { maxBuffer: 1024 * 1024 }));
    if (type !== "blob") continue;
    const size = Number(text(git(["cat-file", "-s", candidate.sha], { maxBuffer: 1024 * 1024 })) || 0);
    if (!Number.isFinite(size) || size <= 0 || size > MAX_BLOB_BYTES) continue;
    const content = git(["cat-file", "blob", candidate.sha], { maxBuffer: MAX_BLOB_BYTES + 1024 * 1024 });
    if (content === null) continue;
    const snapshot = parseCandidateContent(content);
    if (snapshot) {
      return {
        data: snapshot,
        source: {
          provider: "git-history",
          blob: candidate.sha,
          path: candidate.path
        }
      };
    }
  }
  return null;
}

async function publishSnapshot(data, source, exportFile, exportShaFile, outputFile) {
  const canonicalData = canonical(data);
  const encodedData = `${JSON.stringify(canonicalData, null, 2)}\n`;
  const sha256 = createHash("sha256").update(encodedData).digest("hex");
  const sourceLocator = source.deployment || `${source.blob}:${source.path}`;
  const artifact = {
    source: {
      ...source,
      capturedAt: new Date().toISOString(),
      sourceSha: text(process.env.GITHUB_SHA)
    },
    counts: { groups: data.groups.length, items: data.items.length },
    sha256,
    data: canonicalData
  };

  await writeFile(exportFile, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  await writeFile(exportShaFile, `${sha256}  ${exportFile}\n`, { mode: 0o600 });
  await writeFile(
    outputFile,
    `groups=${data.groups.length}\nitems=${data.items.length}\nsha256=${sha256}\nsource_kind=${source.provider}\nsource_locator=${sourceLocator}\n`,
    { flag: "a" }
  );
}

async function main() {
  const token = text(process.env.VERCEL_TOKEN);
  const exportFile = text(process.env.EXPORT_FILE);
  const exportShaFile = text(process.env.EXPORT_SHA_FILE);
  const outputFile = text(process.env.GITHUB_OUTPUT);
  if (!exportFile || !exportShaFile || !outputFile) throw new Error("legacy_export_path_missing");

  const exportDir = dirname(exportFile);
  await mkdir(exportDir, { recursive: true });

  if (token) {
    for (const [index, deployment] of deployments.entries()) {
      const request = requestDeployment(deployment, index, token, exportDir);
      try {
        if (!request.commandOk || request.status !== "200") continue;
        const payload = JSON.parse(await readFile(request.candidateFile, "utf8"));
        const data = validateSnapshot(payload);
        if (!data) continue;
        await publishSnapshot(
          data,
          { provider: "vercel-historical-deployment", deployment },
          exportFile,
          exportShaFile,
          outputFile
        );
        process.stdout.write(`legacy_snapshot_match:vercel:${index}\n`);
        return;
      } catch {
        // Continue unless a protected deployment returns the exact contract.
      } finally {
        await rm(request.candidateFile, { force: true });
      }
    }
  }

  const history = gitHistorySnapshot();
  if (history) {
    await publishSnapshot(history.data, history.source, exportFile, exportShaFile, outputFile);
    process.stdout.write("legacy_snapshot_match:git-history\n");
    return;
  }

  throw new Error("legacy_report_settings_snapshot_not_found");
}

await main();
