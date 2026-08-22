import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const appBase = process.env.MCP_ACTION_UI_APP_BASE || "http://127.0.0.1:3011";
const mockBase = process.env.MCP_ACTION_UI_MOCK_BASE || "http://127.0.0.1:3110";
const resultsDir = process.env.MCP_ACTION_UI_RESULTS_DIR || "test-results/mcp-session-actions";
const proxyHeaders = { "x-forwarded-proto": "https" };
await mkdir(resultsDir, { recursive: true });
async function waitForHttp(url, timeoutMs = 120000) { const start = Date.now(); let error; while (Date.now() - start < timeoutMs) { try { const response = await fetch(url, { cache: "no-store" }); if (response.ok) return; error = new Error(`${url}:${response.status}`); } catch (next) { error = next; } await new Promise((resolve) => setTimeout(resolve, 500)); } throw error || new Error(`timeout:${url}`); }
async function reset() { const response = await fetch(`${mockBase}/__reset`, { method: "POST" }); assert.equal(response.status, 200); }
async function state() { const response = await fetch(`${mockBase}/__state`, { cache: "no-store" }); assert.equal(response.status, 200); return response.json(); }
function card(page) { return page.locator("article").filter({ hasText: "UI Existing Customer" }).first(); }
async function openCardAction(page, actionName) { const customer = card(page); const trigger = customer.getByRole("button", { name: "Thao tác", exact: true }); await trigger.click(); assert.equal(await trigger.getAttribute("aria-expanded"), "true"); await customer.getByRole("button", { name: actionName, exact: true }).click(); }
async function saveAndWait(page, dialogName, saveName) { const dialog = page.getByRole("dialog", { name: dialogName, exact: true }); await dialog.getByRole("button", { name: saveName, exact: true }).click(); await dialog.waitFor({ state: "hidden" }); }
async function shot(page, name) { await page.screenshot({ path: `${resultsDir}/${name}.png`, fullPage: true }); }

await waitForHttp(`${mockBase}/health`); await waitForHttp(`${appBase}/visits?routeId=route-active&date=2099-12-30`); await reset();
const browser = await chromium.launch({ headless: true }); const context = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: proxyHeaders }); await context.addCookies([{ name: "hp_mcp_session", value: "ui-smoke-session", url: appBase }]); const page = await context.newPage(); const result = { MCP_SESSION_ACTION_UI_SMOKE: "FAIL" };
try {
  await page.goto(`${appBase}/visits?routeId=route-active&date=2099-12-30`, { waitUntil: "domcontentloaded" });
  await card(page).waitFor({ state: "visible" });
  const tokens = await page.evaluate(() => { const style = getComputedStyle(document.documentElement); return { canvas: style.getPropertyValue("--npp-color-canvas").trim(), surface: style.getPropertyValue("--npp-color-surface").trim(), header: style.getPropertyValue("--npp-color-header").trim(), primary: style.getPropertyValue("--npp-color-primary").trim(), accent: style.getPropertyValue("--npp-color-accent").trim() }; });
  assert.deepEqual(tokens, { canvas: "#f7f5f1", surface: "#fff", header: "#5a3b20", primary: "#98600f", accent: "#b78333" }); await shot(page, "01-warm-theme-session");
  await openCardAction(page, "Có đơn");
  assert.equal(await page.getByRole("dialog", { name: "Ghi nhận nhu cầu mua", exact: true }).count(), 0, "Có đơn must not open a popup");
  await card(page).getByText("Có đơn", { exact: true }).waitFor({ state: "visible" });
  const customer = card(page); const actionTrigger = customer.getByRole("button", { name: "Thao tác", exact: true }); await actionTrigger.click(); const activeOrderButton = customer.getByRole("button", { name: "Đã có đơn", exact: true }); await activeOrderButton.waitFor({ state: "visible" }); assert.equal(await activeOrderButton.getAttribute("aria-pressed"), "true"); await actionTrigger.click(); result.hasOrderDirectToggle = "PASS";
  await openCardAction(page, "Test"); const testDialog = page.getByRole("dialog", { name: "Ghi kết quả thử sản phẩm", exact: true }); await testDialog.getByPlaceholder("Nhập tên sản phẩm").fill("Trà UI Smoke"); await testDialog.getByRole("button", { name: "Đạt", exact: true }).first().click(); await saveAndWait(page, "Ghi kết quả thử sản phẩm", "Lưu kết quả thử");
  await openCardAction(page, "Quan sát"); const reportDialog = page.getByRole("dialog", { name: "Ghi quan sát thị trường", exact: true }); await reportDialog.getByRole("button", { name: "Cần báo giá", exact: true }).click(); await saveAndWait(page, "Ghi quan sát thị trường", "Lưu quan sát");
  await openCardAction(page, "Theo dõi"); const followupDialog = page.getByRole("dialog", { name: "Tạo việc cần theo dõi", exact: true }); await followupDialog.getByRole("button", { name: "Gửi báo giá", exact: true }).click(); await followupDialog.getByRole("button", { name: "Mai", exact: true }).click(); await saveAndWait(page, "Tạo việc cần theo dõi", "Lưu việc theo dõi"); await shot(page, "02-session-facts-and-actions-pass");
  const mock = await state(); const resultRequest = mock.requests.find((item) => item.path === "/api/mcp-day/session-customer/result"); assert.ok(resultRequest, "missing result fact request"); assert.match(resultRequest.idempotencyKey, /^[A-Za-z0-9._-]+$/); assert.equal(resultRequest.payload.sessionCustomerId, "sc-existing"); assert.equal(resultRequest.payload.resultType, "order"); assert.equal(resultRequest.payload.hasOrder, true);
  for (const route of ["test", "report", "followup"]) { const request = mock.requests.find((item) => item.path === `/api/mcp-day/session-customer/${route}`); assert.ok(request, `missing ${route} request`); assert.ok(request.idempotencyKey); assert.equal(request.payload.sessionCustomerId, "sc-existing"); }
  assert.equal(mock.requests.some((item) => item.path === "/api/mcp-day/session-customer/order"), false); assert.equal(mock.requests.some((item) => item.path.includes("customer-onboarding")), false); assert.equal(mock.requests.some((item) => item.path.includes("sales-order")), false); assert.equal(mock.aggregates.results.length, 1); assert.equal(mock.aggregates.orders.length, 0); assert.equal(mock.aggregates.tests.length, 1); assert.equal(mock.aggregates.reports.length, 1); assert.equal(mock.aggregates.followups.length, 1);
  result.MCP_SESSION_ACTION_UI_SMOKE = "PASS"; result.actions = ["hasOrder", "test", "report", "followup"]; result.idempotencyKeys = "PASS"; result.noPurchasePopup = "PASS"; result.themeTokens = tokens;
} catch (error) { result.error = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ""}` : String(error); await shot(page, "failure").catch(() => {}); await writeFile(`${resultsDir}/failure.html`, await page.content()).catch(() => {}); throw error; } finally { await writeFile(`${resultsDir}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2)); await context.close(); await browser.close(); }
