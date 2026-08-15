import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const appBase = process.env.ORDER_CREATE_APP_BASE || "http://127.0.0.1:3001";
const mockBase = process.env.ORDER_CREATE_MOCK_BASE || "http://127.0.0.1:3110";
const resultsDir = process.env.ORDER_CREATE_RESULTS_DIR || "test-results/order-create-smoke";
const safeKey = /^[A-Za-z0-9._-]{1,128}$/;

await mkdir(resultsDir, { recursive: true });

async function waitForHttp(url, timeoutMs = 120_000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return;
      lastError = new Error(`${url} -> ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw lastError || new Error(`timeout_waiting_for_${url}`);
}

await waitForHttp(`${appBase}/`);
await waitForHttp(`${mockBase}/__direct-state`);
await fetch(`${mockBase}/__direct-reset`, { method: "POST" });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "x-forwarded-proto": "https" } });
const page = await context.newPage();
await context.addCookies([{
  name: "hp_mcp_session",
  value: "ci-order-create-session",
  url: appBase
}]);

await page.goto(`${appBase}/orders`, { waitUntil: "networkidle" });
await page.getByRole("heading", { name: "Trung tâm đơn hàng", exact: true }).waitFor({ state: "visible" });
for (const tab of ["Đơn hàng", "Cần xử lý", "Doanh số đặt hàng", "Tổng quan"]) {
  await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).waitFor({ state: "visible" });
}
await page.getByRole("button", { name: "+ Tạo đơn", exact: true }).click();
await page.getByRole("dialog", { name: "Tạo đơn hàng", exact: true }).waitFor({ state: "visible" });
await page.getByText("1. Chọn khách công ty", { exact: true }).waitFor({ state: "visible" });
assert.equal(await page.getByText(/Đơn giá tạm/).count(), 0, "Core flow must not expose browser price authority");
assert.equal(await page.getByText(/Khách nhập tay|Khách mới|Phiên \/ tuyến/).count(), 0, "Core flow must not depend on manual customer or session order-intent");
assert.equal(await page.getByText(/Mở \/ liên kết mã/).count(), 0, "order form must not open/link customers as a side effect");

await page.getByRole("radio", { name: /UI Existing Customer/ }).click();
await page.getByRole("button", { name: /Tiếp tục với UI Existing Customer/ }).click();
await page.getByRole("button", { name: /Thêm Siro Hưng Phát, Dâu/ }).click();
await page.getByRole("button", { name: /Thêm Trà Lài Hưng Phát/ }).click();

await page.getByRole("button", { name: "Xem lại đơn", exact: true }).click();
const siroCartItem = page.locator("article").filter({ hasText: "Siro Hưng Phát" }).filter({ hasText: "Số lượng" });
await siroCartItem.locator('input[type="number"]').waitFor({ state: "visible" });
await siroCartItem.locator('input[type="number"]').fill("3");
await page.getByRole("textbox", { name: "Ghi chú đơn", exact: true }).fill("Giao giờ hành chính");
await page.getByRole("button", { name: "Tạo đơn", exact: true }).click();

await page.getByText(/Đã tạo SO-MCP-0001\./).waitFor({ state: "visible" });
await page.getByText(/^SO-MCP-0001 · /).waitFor({ state: "visible" });
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("heading", { name: "Trung tâm đơn hàng", exact: true }).waitFor({ state: "visible" });
await page.getByText(/^SO-MCP-0001 · /).waitFor({ state: "visible" });

const stateResponse = await fetch(`${mockBase}/__direct-state`, { cache: "no-store" });
assert.equal(stateResponse.status, 200);
const state = await stateResponse.json();
assert.equal(state.attempts.length, 2, "one temporary failure must be retried exactly once");
assert.equal(state.attempts[0].key, state.attempts[1].key, "retry must reuse the exact same Idempotency-Key");
assert.match(state.attempts[0].key, safeKey, "Idempotency-Key must stay inside shared canonical charset");
assert.deepEqual(state.attempts[0].payload, state.attempts[1].payload, "retry payload must be identical");

const submitted = state.attempts[0].payload;
assert.deepEqual(Object.keys(submitted).sort(), ["customerAddressId", "customerId", "lines", "note"]);
assert.deepEqual(Object.keys(submitted.lines[0]).sort(), ["note", "quantity", "variantId"]);
for (const forbidden of ["unitPrice", "sales", "employeeId", "routeCustomerId", "sessionCustomerId", "status", "customerMode"]) {
  assert.equal(forbidden in submitted, false, `browser payload must not own ${forbidden}`);
}
assert.equal(state.orders.length, 1, "retry must still create exactly one canonical Core order");
assert.equal(state.orders[0].sourceType, "MCP");

await page.screenshot({ path: `${resultsDir}/restored-order-center-core-create.png`, fullPage: true });
await context.close();
await browser.close();

console.log(JSON.stringify({
  status: "PASS",
  restoredOrderCenter: true,
  canonicalOrderSurvivesReload: true,
  idempotencyAttempts: state.attempts.length,
  canonicalOrders: state.orders.length
}, null, 2));
