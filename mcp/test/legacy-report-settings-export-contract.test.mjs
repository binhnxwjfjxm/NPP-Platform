import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const workflow = (await readFile(
  new URL(".github/workflows/mcp-legacy-report-settings-export.yml", root),
  "utf8"
)).replace(/\r\n/g, "\n");

test("legacy report settings export is exact-command and read-only", () => {
  assert.match(workflow, /issue_comment:/);
  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.match(workflow, /github\.event\.comment\.body == '\/export-mcp-legacy-report-settings'/);
  assert.match(workflow, /contains\(fromJSON\('\["binhnxwjfjxm","khuongbinhinfo-a11y"\]'\), github\.actor\)/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /issues: write/);
  assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request|schedule):\s*$/m);
  assert.doesNotMatch(workflow, /deploy --prebuilt|vercel@latest deploy|git push|heroku container:release/i);
  assert.doesNotMatch(workflow, /(?:POST|PATCH|PUT|DELETE)\s+\/rest\/v1/i);
});

test("export resolves the exact old project and fails closed on 7 groups and 52 items", () => {
  assert.match(workflow, /LEGACY_SUPABASE_PROJECT_REF: noiadkpkvdohljgopgfb/);
  assert.match(workflow, /EXPECTED_GROUPS = 7/);
  assert.match(workflow, /EXPECTED_ITEMS = 52/);
  assert.match(workflow, /mcp_setting_groups\?select=\*&group_type=eq\.market_report/);
  assert.match(workflow, /mcp_setting_items\?select=\*/);
  assert.match(workflow, /legacy_item_orphan_detected/);
  assert.match(workflow, /legacy_item_duplicate_key/);
  assert.match(workflow, /legacy_group_status_mismatch/);
  assert.match(workflow, /legacy_item_status_mismatch/);
});

test("provider secrets remain masked and only the data artifact is published", () => {
  assert.match(workflow, /::add-mask::/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /name: mcp-legacy-report-settings-export/);
  assert.match(workflow, /retention-days: 1/);
  assert.match(workflow, /SHA-256/);
  assert.match(workflow, /Production mutation: none/);
  assert.doesNotMatch(workflow, /cat\s+.*\.env/i);
  assert.doesNotMatch(workflow, /env\s*\|/i);
  assert.doesNotMatch(workflow, /echo\s+.*SUPABASE_(?:ANON|SECRET|SERVICE|PUBLISHABLE)/i);
  assert.doesNotMatch(workflow, /echo\s+.*HEROKU_API_KEY/i);
});
