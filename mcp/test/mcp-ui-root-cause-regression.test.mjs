import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const layout = await readFile("src/app/layout.tsx", "utf8");
const route = await readFile("src/app/mcp-setting/page.tsx", "utf8");
const canonicalSettingsPage = await readFile("src/features/mcp-settings/McpReportSettingsPage.tsx", "utf8");

test("mobile browser chrome uses the canvas theme instead of creating a second brown bottom row", () => {
  assert.match(layout, /themeColor:\s*"#F7F3ED"/);
  assert.doesNotMatch(layout, /themeColor:\s*"#5A3A24"/);
});

test("MCP settings route has one canonical UI owner", async () => {
  assert.match(route, /McpReportSettingsPage/);
  assert.doesNotMatch(route, /McpReportSettingsPageInternal/);
  await assert.rejects(access("src/features/mcp-settings/McpReportSettingsPageInternal.tsx"));
});

test("MCP setting POST and PATCH mutations use stable idempotency and canonical API errors", () => {
  assert.match(canonicalSettingsPage, /idempotentMutationFetch/);
  assert.match(canonicalSettingsPage, /method === "POST" \|\| method === "PATCH"/);
  assert.match(canonicalSettingsPage, /operation: `report-setting-item\.\$\{method\.toLowerCase\(\)\}`/);
  assert.match(canonicalSettingsPage, /payload\.error\?\.message/);
  assert.match(canonicalSettingsPage, /function saveNewItem\(\)[\s\S]*?method: "POST"/);
  assert.match(canonicalSettingsPage, /function saveEditedItem\(\)[\s\S]*?method: "PATCH"/);
  assert.match(canonicalSettingsPage, /body: JSON\.stringify\(\{ itemId: item\.id, status:/);
});
