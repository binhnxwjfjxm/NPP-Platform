import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const guardedPaths = [
  "src/features/mcp-day/McpDayClientPage.tsx",
  "src/features/mcp/McpSessionCompactView.tsx"
];

if (!process.env.CI) {
  console.log("source_immutability_check_skipped_non_ci");
  process.exit(0);
}

function runGit(args) {
  return spawnSync("git", args, {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8"
  });
}

for (const filePath of guardedPaths) {
  const content = readFileSync(new URL(`../${filePath}`, import.meta.url), "utf8");
  const digest = createHash("sha256").update(content).digest("hex");
  const markers = content
    .split(/\r?\n/)
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => /mcpDayData\.run|data\.run|const run/.test(line));

  console.log(`source_sha256 ${filePath} ${digest}`);
  for (const marker of markers) {
    console.log(`source_marker ${filePath}:${marker.number} ${marker.line.trim()}`);
  }
}

const status = runGit(["status", "--short", "--", ...guardedPaths]);
if (status.error) throw status.error;
if (status.status !== 0) {
  process.stderr.write(status.stderr);
  process.exit(status.status ?? 1);
}

if (status.stdout.trim()) {
  console.error("source_immutability_failed");
  process.stderr.write(status.stdout);
  const diff = runGit(["diff", "--", ...guardedPaths]);
  process.stderr.write(diff.stdout);
  process.stderr.write(diff.stderr);
  process.exit(1);
}

console.log("source_immutability_passed");
