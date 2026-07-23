import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(root, "src");
const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
const retiredFingerprints = [
  "ea324aaa3d01a7941bf3aa3f",
  "1502e64fc75da4598b208f1a",
  "6a660d7d414afe70cd88cc4d"
];

async function filesBelow(directory) {
  const info = await stat(directory).catch(() => null);
  if (!info) return [];
  if (info.isFile()) return sourceExtensions.has(path.extname(directory)) ? [directory] : [];
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => filesBelow(path.join(directory, entry.name))));
  return nested.flat();
}

async function occurrences(token) {
  const matches = [];
  for (const file of await filesBelow(sourceRoot)) {
    const content = await readFile(file, "utf8");
    if (!content.includes(token)) continue;
    matches.push({
      file: path.relative(root, file).split(path.sep).join("/"),
      lines: content
        .split(/\r?\n/)
        .map((line, index) => ({ line: index + 1, text: line.trim() }))
        .filter((item) => item.text.includes(token))
    });
  }
  return matches;
}

test("A5.4.2 leaves no Next session-report snapshot writer or caller", async () => {
  const matches = await occurrences("saveMcpSessionReportSnapshot");
  console.log(JSON.stringify({ event: "a5_4_2_session_report_callers", matches }, null, 2));
  assert.deepEqual(matches, []);
});

test("session report read model contains no direct service-role mutation", async () => {
  const source = await readFile(path.join(root, "src/lib/mcp/session-report.ts"), "utf8");
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(source, /\/rest\/v1\/mcp_session_reports/);
  assert.doesNotMatch(source, /method:\s*"POST"/);
});

test("legacy backend contains no direct session report AI writer or route", async () => {
  const source = await readFile(path.join(root, "apps/backend/server.js"), "utf8");
  assert.doesNotMatch(source, /persistMcpSessionAiResultV1/);
  assert.doesNotMatch(source, /supabasePatch\(\s*["']mcp_session_reports["']/);
  assert.doesNotMatch(source, /pathname === "\/api\/mcp-session-report\/ai-result"/);
  assert.match(source, /mcp_create_session_report_snapshot/);
});

test("public and Foundation routes point to the backend session-report owner", async () => {
  const route = await readFile(path.join(root, "src/app/api/mcp-session-report/route.ts"), "utf8");
  const transitional = await readFile(path.join(root, "apps/backend/foundation/transitional-api.js"), "utf8");
  assert.match(route, /proxyBackendRequest\(request, "\/api\/mcp-session-report", "POST"\)/);
  assert.doesNotMatch(route, /saveMcpSessionReportSnapshot/);
  assert.match(transitional, /pathname === "\/api\/mcp-session-report"/);
  assert.match(transitional, /pathname === "\/api\/mcp-session-report\/ai-result"/);
  assert.match(transitional, /createSessionReportSnapshot/);
  assert.match(transitional, /saveSessionReportAiResult/);
});

test("all three A5.4.2 fingerprints are recorded in the immutable retirement ledger", async () => {
  const ledger = JSON.parse(await readFile(path.join(root, "scripts/direct-db-mutation-retirements.json"), "utf8"));
  const entry = ledger.entries.find((item) => item.phase === "A5.4.2");
  assert.ok(entry);
  for (const fingerprint of retiredFingerprints) {
    assert.ok(entry.fingerprints.includes(fingerprint), fingerprint);
  }
});
