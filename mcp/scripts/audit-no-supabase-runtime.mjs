import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isMainModule } from "./esm-entrypoint.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MCP_ROOT = path.resolve(SCRIPT_DIR, "..");

const TARGETS = [
  "package.json",
  "package-lock.json",
  "next.config.mjs",
  ".env.example",
  "src",
  "apps/backend",
  "agent-backend",
  "ops",
  "scripts/validate-runtime-config.mjs",
  "scripts/smoke-f0-2-boundary.mjs"
];

const SOURCE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".json",
  ".yml",
  ".yaml",
  ".sh",
  ".ps1"
]);

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  "node_modules",
  "coverage",
  "dist",
  "build",
  "test",
  "tests",
  "docs"
]);

const RULES = [
  ["SUPABASE_ENV", /\bSUPABASE_(?:URL|ANON_KEY|PUBLISHABLE_KEY|SERVICE_ROLE_KEY|SECRET_KEY|REST_URL|DB_PASSWORD|CONNECTION_STRING|JWKS_URL)\b/g],
  ["SUPABASE_ADAPTER", /\bsupabase(?:Rest|Rpc|Request|Insert|Patch|Delete|ServiceRoleKey|Url)\b|supabase-adapter/gi],
  ["SUPABASE_HTTP", /\/rest\/v1\/|\/functions\/v1\/|\.supabase\.co\b/g],
  ["SUPABASE_PACKAGE", /@supabase\//g]
];

function normalizePath(value) {
  return value.split(path.sep).join("/");
}

function lineNumberAt(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

async function filesBelow(relativePath) {
  const absolutePath = path.join(MCP_ROOT, relativePath);
  const info = await stat(absolutePath).catch(() => null);
  if (!info) return [];
  if (info.isFile()) return [normalizePath(relativePath)];

  const files = [];
  for (const entry of await readdir(absolutePath, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const child = normalizePath(path.join(relativePath, entry.name));
    if (entry.isDirectory()) files.push(...await filesBelow(child));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(child);
  }
  return files;
}

export async function auditNoSupabaseRuntime() {
  const files = [...new Set((await Promise.all(TARGETS.map(filesBelow))).flat())].sort();
  const findings = [];

  for (const file of files) {
    const content = await readFile(path.join(MCP_ROOT, file), "utf8");
    for (const [rule, regex] of RULES) {
      regex.lastIndex = 0;
      for (const match of content.matchAll(regex)) {
        findings.push({
          file,
          line: lineNumberAt(content, match.index),
          rule,
          evidence: match[0]
        });
      }
    }
  }

  return { files, findings };
}

async function main() {
  const result = await auditNoSupabaseRuntime();
  if (result.findings.length) {
    console.error(`supabase_runtime_audit_failed findings=${result.findings.length}`);
    for (const finding of result.findings) {
      console.error(`- ${finding.file}:${finding.line}:${finding.rule}:${finding.evidence}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`supabase_runtime_audit_passed files=${result.files.length}`);
}

if (isMainModule(import.meta.url, process.argv[1])) await main();
