import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const workflow = (await readFile(
  new URL(".github/workflows/mcp-legacy-report-settings-export.yml", root),
  "utf8"
)).replace(/\r\n/g, "\n");
const exporter = (await readFile(
  new URL("mcp/scripts/export-legacy-report-settings-from-vercel.mjs", root),
  "utf8"
)).replace(/\r\n/g, "\n");

test("legacy report settings export is exact-command and read-only", () => {
  assert.match(workflow, /issue_comment:/);
  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.match(workflow, /github\.event\.comment\.body == '\/export-mcp-legacy-report-settings'/);
  assert.match(workflow, /contains\(fromJSON\('\["binhnxwjfjxm","khuongbinhinfo-a11y"\]'\), github\.actor\)/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /refs\/heads\/\*:refs\/remotes\/origin\/\*/);
  assert.match(workflow, /vercel@latest pull/);
  assert.match(exporter, /vercel@latest/);
  assert.match(exporter, /"curl"/);
  assert.match(exporter, /"--deployment"/);
  assert.match(exporter, /rev-list", "--objects", "--all/);
  assert.match(exporter, /cat-file", "blob"/);
  assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request|schedule):\s*$/m);
  assert.doesNotMatch(workflow, /deploy --prebuilt|vercel@latest deploy|git push|heroku container:release/i);
  assert.doesNotMatch(exporter, /-X|--request|\bPOST\b|\bPATCH\b|\bPUT\b|\bDELETE\b/);
});

test("export accepts only an exact 7-group and 52-item snapshot", () => {
  assert.match(exporter, /EXPECTED_GROUPS = 7/);
  assert.match(exporter, /EXPECTED_ITEMS = 52/);
  assert.match(exporter, /mcp-field-4m339eob5-binhnxwjfjxms-projects\.vercel\.app/);
  assert.match(exporter, /mcp-field-bhdi5l7vy-binhnxwjfjxms-projects\.vercel\.app/);
  assert.match(exporter, /groupIds\.has\(groupId\)/);
  assert.match(exporter, /groupKeys\.has\(groupKey\)/);
  assert.match(exporter, /itemIds\.has\(itemId\)/);
  assert.match(exporter, /itemKeys\.has\(identity\)/);
  assert.match(exporter, /statusOf\(sourceGroup\) !== "active"/);
  assert.match(exporter, /statusOf\(sourceItem\) !== "active"/);
  assert.match(exporter, /sourceItems\.length !== EXPECTED_ITEMS/);
  assert.match(exporter, /extractSqlRows\(source, "mcp_setting_groups"\)/);
  assert.match(exporter, /extractSqlRows\(source, "mcp_setting_items"\)/);
  assert.match(exporter, /legacy_report_settings_snapshot_not_found/);
});

test("only exact structured data and sanitized evidence are published", () => {
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /name: mcp-legacy-report-settings-export/);
  assert.match(workflow, /retention-days: 1/);
  assert.match(workflow, /SHA-256/);
  assert.match(workflow, /Source kind/);
  assert.match(workflow, /Source locator/);
  assert.match(workflow, /Production mutation: none/);
  assert.match(exporter, /createHash\("sha256"\)/);
  assert.match(exporter, /provider: "git-history"/);
  assert.doesNotMatch(workflow, /cat\s+.*\.env/i);
  assert.doesNotMatch(workflow, /env\s*\|/i);
  assert.doesNotMatch(exporter, /console\.log\([^)]*token/i);
  assert.doesNotMatch(workflow, /echo\s+.*VERCEL_TOKEN/i);
});
