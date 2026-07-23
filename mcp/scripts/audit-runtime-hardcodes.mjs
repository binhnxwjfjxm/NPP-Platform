import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const findingsPath = path.join(root, "runtime-hardcode-findings.txt");
const scanRoots = ["src", "apps/backend"];
const rootFiles = [".env.example", "next.config.mjs", "package.json", "vercel.json"];
const ignoredDirectories = new Set(["node_modules", ".next", "coverage", "dist", "build"]);
const extensions = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".json", ".env"]);

const forbidden = [
  ["original_vps_ip", ["165", "22", "109", "61"].join(".")],
  ["original_supabase_project", ["noiadkpkvdohljgopgfb", "supabase", "co"].join(".")],
  ["original_supabase_project_id", "noiadkpkvdohljgopgfb"],
  ["original_report_agent", ["report-agent-375343885071", "asia-southeast1", "run", "app"].join(".")]
];

async function filesBelow(relativePath) {
  const absolute = path.join(root, relativePath);
  const info = await stat(absolute).catch(() => null);
  if (!info) return [];
  if (info.isFile()) return [relativePath];

  const entries = await readdir(absolute, { withFileTypes: true });
  const nested = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const child = path.join(relativePath, entry.name);
    if (entry.isDirectory()) nested.push(...await filesBelow(child));
    else if (extensions.has(path.extname(entry.name)) || entry.name.startsWith(".env")) nested.push(child);
  }
  return nested;
}

const files = new Set(rootFiles);
for (const scanRoot of scanRoots) {
  for (const file of await filesBelow(scanRoot)) files.add(file);
}

const findings = [];
for (const relativePath of files) {
  const content = await readFile(path.join(root, relativePath), "utf8").catch(() => "");
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const [code, needle] of forbidden) {
      if (line.includes(needle)) findings.push(`${relativePath}:${index + 1} ${code}`);
    }
  });
}

const report = findings.length
  ? `runtime_hardcode_audit_failed\n${findings.map((finding) => `- ${finding}`).join("\n")}\n`
  : `runtime_hardcode_audit_passed files=${files.size}\n`;
await writeFile(findingsPath, report, "utf8");

if (findings.length) {
  console.error(report.trimEnd());
  process.exit(1);
}

console.log(report.trimEnd());
