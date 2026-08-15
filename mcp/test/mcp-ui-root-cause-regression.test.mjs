import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const layout = await readFile("src/app/layout.tsx", "utf8");
const route = await readFile("src/app/mcp-setting/page.tsx", "utf8");
const groupRoute = await readFile("src/app/mcp-setting/groups/page.tsx", "utf8");
const groupStyles = await readFile("src/app/mcp-setting/groups/page.module.css", "utf8");
const canonicalSettingsPage = await readFile("src/features/mcp-settings/McpReportSettingsPage.tsx", "utf8");
const loginPage = await readFile("src/app/login/page.tsx", "utf8");
const loginRoute = await readFile("src/app/api/auth/login/route.ts", "utf8");
const loginStyles = await readFile("src/app/login/login.module.css", "utf8");

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

test("report setting groups use one compact mobile list and a desktop table", () => {
  assert.match(groupRoute, /className=\{styles\.mobileList\}/);
  assert.match(groupRoute, /className=\{styles\.desktopTableWrap\}/);
  assert.match(groupRoute, />\s*Thêm nhóm\s*</);
  assert.doesNotMatch(groupRoute, /style=\{\{/);
  assert.match(groupStyles, /\.mobileList\s*\{[\s\S]*?display:\s*grid/);
  assert.match(groupStyles, /\.desktopTableWrap\s*\{[\s\S]*?display:\s*none/);
  assert.match(groupStyles, /@media \(min-width:\s*720px\)[\s\S]*?\.mobileList\s*\{[\s\S]*?display:\s*none/);
  assert.match(groupStyles, /@media \(min-width:\s*720px\)[\s\S]*?\.desktopTableWrap\s*\{[\s\S]*?display:\s*block/);
});

test("report setting group form is an accessible sheet and keeps idempotent mutations", () => {
  assert.match(groupRoute, /role="dialog"/);
  assert.match(groupRoute, /aria-modal="true"/);
  assert.match(groupRoute, /event\.key === "Escape"/);
  assert.match(groupRoute, /aria-label="Đóng biểu mẫu nhóm"/);
  assert.match(groupRoute, /idempotentMutationFetch/);
  assert.match(groupRoute, /operation: `report-setting-group\.\$\{method\.toLowerCase\(\)\}`/);
  assert.match(groupStyles, /\.cardActions button,[\s\S]*?min-height:\s*44px/);
  assert.match(groupStyles, /\.closeButton\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px/);
});

test("MCP login matches the canonical two-stage Owner verification UI", () => {
  assert.match(loginPage, /type VerificationState = "owner_code_required" \| "machine_code_required"/);
  assert.match(loginPage, /parseVerificationState/);
  assert.match(loginPage, /mode === "credentials"/);
  assert.match(loginPage, /Xác minh thiết bị/);
  assert.match(loginPage, /Đổi tài khoản/);
  assert.match(loginPage, /formData\.set\("ownerCode", code\.trim\(\)\)/);
  assert.match(loginPage, /credentials: "same-origin"/);
  assert.doesNotMatch(loginPage, /Tài khoản Owner cần mã xác minh bổ sung/);
  assert.doesNotMatch(loginPage, /localStorage|sessionStorage/);
  assert.match(loginRoute, /search\.set\("state", state\)/);
  assert.match(loginRoute, /INTERNAL_AUTH_OWNER_CHALLENGE_REQUIRED[\s\S]*"owner_code_required"/);
  assert.match(loginRoute, /INTERNAL_AUTH_OWNER_CODE_INVALID[\s\S]*"owner_code_required"/);
});

test("MCP verification screen keeps credentials in memory and gives the same motion feedback as Admin and Delivery", () => {
  assert.match(loginPage, /useState<LoginMode>/);
  assert.match(loginPage, /formData\.set\("username", username\.trim\(\)\)/);
  assert.match(loginPage, /formData\.set\("password", password\)/);
  assert.match(loginPage, /submitState === "loading"/);
  assert.match(loginPage, /submitState === "success"/);
  assert.match(loginStyles, /@keyframes formOut/);
  assert.match(loginStyles, /@keyframes verifyIn/);
  assert.match(loginStyles, /@keyframes codeShake/);
  assert.match(loginStyles, /@keyframes shieldPulse/);
  assert.match(loginStyles, /prefers-reduced-motion/);
});
