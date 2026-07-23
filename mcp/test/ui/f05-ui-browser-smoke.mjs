import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const appBase = process.env.F05_UI_APP_BASE || "http://127.0.0.1:3000";
const mockBase = process.env.F05_UI_MOCK_BASE || "http://127.0.0.1:3109";
const resultsDir = process.env.F05_UI_RESULTS_DIR || "test-results/f05-ui-smoke";

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

async function resetMock() {
  const response = await fetch(`${mockBase}/__reset`, { method: "POST" });
  assert.equal(response.status, 200, "mock reset must succeed");
}

async function mockState() {
  const response = await fetch(`${mockBase}/__state`, { cache: "no-store" });
  assert.equal(response.status, 200, "mock state must be readable");
  return response.json();
}

function lastRequest(state, path) {
  const requests = state.requests.filter((item) => item.path === path);
  assert.ok(requests.length > 0, `missing request ${path}`);
  return requests.at(-1);
}

async function selectRoute(page, routeName) {
  const heading = page.getByRole("heading", { name: routeName, exact: true });
  await heading.waitFor({ state: "visible" });
  const card = heading.locator("xpath=ancestor::article");
  await card.getByRole("button", { name: "Chọn tuyến", exact: true }).click();
  await page.getByText(`Đã chọn: ${routeName}`, { exact: true }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Thêm điểm bán vào tuyến", exact: true }).waitFor({ state: "visible" });
}

async function openCustomerDraft(page, customerName) {
  await page.getByRole("button", { name: "Thêm điểm bán vào tuyến", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Thêm điểm bán vào tuyến", exact: true });
  await dialog.waitFor({ state: "visible" });
  await dialog.getByPlaceholder("Nhập tên điểm bán").fill(customerName);
  await dialog.getByLabel("Số điện thoại").fill("0901234567");
  await dialog.getByLabel("Vĩ độ").fill("10.762622");
  await dialog.getByLabel("Kinh độ").fill("106.660172");
  await dialog.getByLabel("Độ chính xác GPS, mét").fill("9");
  await dialog.getByLabel("Ghi chú").fill("F05 browser smoke");
  return dialog;
}

async function submitInitialCustomerDraft(page, dialog) {
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET" && url.pathname === "/api/backend/mcp-settings/session-status";
  });
  await dialog.getByRole("button", { name: "Thêm điểm bán", exact: true }).click();
  const response = await responsePromise;
  const payload = await response.json();
  assert.equal(response.status(), 200, `session preflight failed: ${JSON.stringify(payload)}`);
  return { url: response.url(), payload };
}

function assertSessionPreflight(trace, routeId, expectedActiveCount) {
  const url = new URL(trace.url);
  assert.equal(url.searchParams.get("routeId"), routeId, "preflight must use the selected route ID");
  const sessions = Array.isArray(trace.payload?.data?.sessions) ? trace.payload.data.sessions : [];
  assert.equal(sessions.filter((session) => session.status === "active").length, expectedActiveCount, `unexpected preflight payload: ${JSON.stringify(trace.payload)}`);
}

async function activeChoiceDialog(page) {
  const dialog = page.getByRole("dialog", { name: "Thêm điểm bán vào phiên hiện tại?", exact: true });
  await dialog.waitFor({ state: "visible" });
  await dialog.getByText("Tuyến này đang có phiên hoạt động. Thêm khách vào phiên hiện tại luôn?", { exact: true }).waitFor({ state: "visible" });
  return dialog;
}

async function screenshot(page, name) {
  await page.screenshot({ path: `${resultsDir}/${name}.png`, fullPage: true });
}

async function routeWithoutActiveSession(browser) {
  await resetMock();
  const page = await browser.newPage();
  await page.goto(`${appBase}/routes`, { waitUntil: "networkidle" });
  await selectRoute(page, "UI Smoke No Active");
  const draft = await openCustomerDraft(page, "UI Route Only No Session");
  const preflight = await submitInitialCustomerDraft(page, draft);
  assertSessionPreflight(preflight, "route-no-active", 0);
  await page.getByText("Đã thêm điểm bán vào tuyến, áp dụng từ phiên sau.", { exact: true }).waitFor({ state: "visible" });
  assert.equal(await page.getByRole("dialog", { name: "Thêm điểm bán vào phiên hiện tại?", exact: true }).count(), 0);

  const request = lastRequest(await mockState(), "/api/route-customers");
  assert.equal(request.payload.routeId, "route-no-active");
  assert.equal(request.payload.includeActiveSession, false);
  assert.equal(Object.hasOwn(request.payload, "activeSessionId"), false);
  assert.ok(request.idempotencyKey, "route-only UI request must carry Idempotency-Key");
  await screenshot(page, "01-route-no-active-pass");
  await page.close();
  return "PASS";
}

async function routeWithActiveSessionInclude(browser) {
  await resetMock();
  const page = await browser.newPage();
  await page.goto(`${appBase}/routes`, { waitUntil: "networkidle" });
  await selectRoute(page, "UI Smoke Active");
  const draft = await openCustomerDraft(page, "UI Include Active Session");
  const preflight = await submitInitialCustomerDraft(page, draft);
  assertSessionPreflight(preflight, "route-active", 1);

  const dialog = await activeChoiceDialog(page);
  const primary = dialog.getByRole("button", { name: "Thêm vào tuyến và phiên", exact: true });
  const secondary = dialog.getByRole("button", { name: "Chỉ thêm vào tuyến", exact: true });
  assert.match(String(await primary.getAttribute("class")), /primary/, "include-active choice must be primary/default");
  await screenshot(page, "02-active-session-prompt");
  await primary.click();
  await page.getByText("Đã thêm điểm bán vào tuyến và phiên hiện tại.", { exact: true }).waitFor({ state: "visible" });

  const state = await mockState();
  const request = lastRequest(state, "/api/route-customers");
  assert.equal(request.payload.routeId, "route-active");
  assert.equal(request.payload.includeActiveSession, true);
  assert.equal(request.payload.activeSessionId, "session-active");
  assert.ok(request.idempotencyKey, "include-active UI request must carry Idempotency-Key");
  assert.ok(state.sessionLines.some((line) => line.accountName === "UI Include Active Session"), "active snapshot must be created");
  assert.equal(await secondary.count(), 0, "prompt must close after successful mutation");
  await screenshot(page, "03-active-session-include-pass");
  await page.close();
  return "PASS";
}

async function routeWithActiveSessionRouteOnly(browser) {
  await resetMock();
  const page = await browser.newPage();
  await page.goto(`${appBase}/routes`, { waitUntil: "networkidle" });
  await selectRoute(page, "UI Smoke Active");
  const draft = await openCustomerDraft(page, "UI Active Route Only");
  const preflight = await submitInitialCustomerDraft(page, draft);
  assertSessionPreflight(preflight, "route-active", 1);
  const dialog = await activeChoiceDialog(page);
  await dialog.getByRole("button", { name: "Chỉ thêm vào tuyến", exact: true }).click();
  await page.getByText("Đã thêm điểm bán vào tuyến, áp dụng từ phiên sau.", { exact: true }).waitFor({ state: "visible" });

  const state = await mockState();
  const request = lastRequest(state, "/api/route-customers");
  assert.equal(request.payload.includeActiveSession, false);
  assert.equal(Object.hasOwn(request.payload, "activeSessionId"), false);
  assert.equal(state.sessionLines.some((line) => line.accountName === "UI Active Route Only"), false, "route-only choice must not create active snapshot");
  await screenshot(page, "04-active-session-route-only-pass");
  await page.close();
  return "PASS";
}

async function reusedCustomerCopy(browser) {
  await resetMock();
  const page = await browser.newPage();
  await page.goto(`${appBase}/routes`, { waitUntil: "networkidle" });
  await selectRoute(page, "UI Smoke Active");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const draft = await openCustomerDraft(page, "UI Duplicate Customer");
    const preflight = await submitInitialCustomerDraft(page, draft);
    assertSessionPreflight(preflight, "route-active", 1);
    const dialog = await activeChoiceDialog(page);
    await dialog.getByRole("button", { name: "Thêm vào tuyến và phiên", exact: true }).click();
    if (attempt === 0) {
      await page.getByText("Đã thêm điểm bán vào tuyến và phiên hiện tại.", { exact: true }).waitFor({ state: "visible" });
    } else {
      await page.getByText("Điểm bán đã tồn tại và được dùng lại trong tuyến và phiên hiện tại.", { exact: true }).waitFor({ state: "visible" });
    }
  }

  const state = await mockState();
  assert.equal(state.routeCustomers.filter((item) => item.accountName === "UI Duplicate Customer").length, 1);
  assert.equal(state.sessionLines.filter((item) => item.accountName === "UI Duplicate Customer").length, 1);
  const requests = state.requests.filter((item) => item.path === "/api/route-customers");
  assert.equal(requests.length, 2);
  assert.notEqual(requests[0].idempotencyKey, requests[1].idempotencyKey, "separate user intents must use separate keys");
  await screenshot(page, "05-duplicate-reuse-pass");
  await page.close();
  return "PASS";
}

async function sessionAddCustomer(browser) {
  await resetMock();
  const page = await browser.newPage();
  await page.goto(`${appBase}/visits?routeId=route-active&date=2099-12-30`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Thêm khách vào phiên và tuyến", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Thêm khách", exact: true });
  await dialog.waitFor({ state: "visible" });
  await dialog.getByPlaceholder("Tên cửa hàng / điểm bán").fill("UI Session Add Customer");
  await dialog.getByPlaceholder("Số điện thoại").fill("0907654321");
  await dialog.locator('button[form="mcp-add-session-customer-form"]').click();
  await dialog.waitFor({ state: "hidden" });

  const state = await mockState();
  const request = lastRequest(state, "/api/mcp-day/session-customer/add");
  assert.equal(request.payload.sessionId, "session-active");
  assert.equal(request.payload.customerName, "UI Session Add Customer");
  assert.ok(request.idempotencyKey, "session add UI request must carry Idempotency-Key");
  assert.ok(state.routeCustomers.some((item) => item.accountName === "UI Session Add Customer"));
  assert.ok(state.sessionLines.some((item) => item.accountName === "UI Session Add Customer"));
  await screenshot(page, "06-session-add-customer-pass");
  await page.close();
  return "PASS";
}

async function unifiedMobileMenu(browser) {
  await resetMock();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${appBase}/visits?routeId=route-active&date=2099-12-30`, { waitUntil: "networkidle" });

  const appMenuTrigger = page.getByRole("button", { name: "Mở menu ứng dụng", exact: true });
  await appMenuTrigger.waitFor({ state: "visible" });
  assert.equal(await appMenuTrigger.count(), 1, "mobile must render exactly one top menu trigger");
  assert.equal(await page.getByRole("button", { name: "Cài đặt", exact: true }).count(), 0, "standalone settings gear must be removed");
  assert.equal(await page.getByRole("button", { name: "Mở menu tác vụ phiên", exact: true }).count(), 0, "session header must not add a second menu trigger");
  assert.equal(await page.locator("[data-page-header-actions] button").count(), 0, "session header action slot must not contain another button");
  await screenshot(page, "09-unified-mobile-menu-trigger");

  await appMenuTrigger.click();
  const menu = page.getByRole("dialog", { name: "Menu phiên", exact: true });
  await menu.waitFor({ state: "visible" });
  await menu.getByRole("button", { name: /Xem báo cáo phiên/ }).waitFor({ state: "visible" });
  await menu.getByRole("button", { name: /Xuất dữ liệu/ }).waitFor({ state: "visible" });
  const closeAction = menu.getByRole("button", { name: /Chốt phiên/ });
  await closeAction.waitFor({ state: "visible" });
  await menu.getByRole("button", { name: /Cài đặt ứng dụng/ }).waitFor({ state: "visible" });
  assert.match(String(await closeAction.getAttribute("class")), /danger/, "close session must remain destructive in unified menu");
  await screenshot(page, "10-unified-mobile-app-menu");

  await menu.getByRole("button", { name: /Xuất dữ liệu/ }).click();
  const exportDialog = page.getByRole("dialog", { name: "Xuất dữ liệu phiên", exact: true });
  await exportDialog.waitFor({ state: "visible" });
  const pdf = exportDialog.getByRole("button", { name: /Báo cáo phiên PDF/ });
  const excel = exportDialog.getByRole("button", { name: /Checklist khách Excel/ });
  await pdf.waitFor({ state: "visible" });
  await excel.waitFor({ state: "visible" });
  assert.equal(await pdf.getAttribute("data-export-kind"), "pdf", "PDF export must remain a controlled action");
  assert.equal(await excel.getAttribute("data-export-kind"), "excel", "Excel export must remain a controlled action");
  assert.equal(await pdf.isEnabled(), true, "PDF export must be enabled");
  assert.equal(await excel.isEnabled(), true, "Excel export must be enabled");
  await screenshot(page, "11-unified-mobile-export-menu");

  await context.close();
  return {
    status: "PASS",
    triggerCount: 1,
    standaloneSettingsButton: false,
    sessionHeaderMenuButton: false,
    actions: ["report", "export", "close", "settings"],
    exportActions: "PASS"
  };
}

async function manualCheckin(browser) {
  await resetMock();
  const context = await browser.newContext({
    permissions: ["geolocation"],
    geolocation: { latitude: 10.123456, longitude: 106.123456, accuracy: 12 },
    viewport: { width: 430, height: 932 }
  });
  const page = await context.newPage();
  await page.goto(`${appBase}/visits?routeId=route-active&date=2099-12-30`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Check-in vị trí hiện tại tại UI Existing Customer", exact: true }).click();
  await page.getByText(/Đã check-in vị trí hiện tại tại UI Existing Customer/).waitFor({ state: "visible" });

  let state = await mockState();
  let request = lastRequest(state, "/api/mcp-day/session-customer/checkin");
  assert.equal(request.payload.checkedIn, true);
  assert.equal(request.payload.geoLat, 10.123456);
  assert.equal(request.payload.geoLng, 106.123456);
  assert.equal(request.payload.geoAccuracy, 12);
  assert.ok(request.idempotencyKey, "manual check-in request must carry Idempotency-Key");
  assert.equal(state.sessionLines.find((line) => line.id === "sc-existing").status, "pending", "check-in must preserve visit status");
  await screenshot(page, "07-manual-checkin-pass");

  await page.getByRole("button", { name: "Bỏ check-in tại UI Existing Customer", exact: true }).click();
  await page.getByText("Đã bỏ check-in của UI Existing Customer.", { exact: true }).waitFor({ state: "visible" });
  state = await mockState();
  request = lastRequest(state, "/api/mcp-day/session-customer/checkin");
  assert.equal(request.payload.checkedIn, false);
  assert.equal(Object.hasOwn(request.payload, "geoLat"), false, "undo must not resend coordinates");
  assert.equal(state.sessionLines.find((line) => line.id === "sc-existing").checkedIn, false);
  assert.equal(state.sessionLines.find((line) => line.id === "sc-existing").status, "pending");
  await screenshot(page, "08-manual-checkin-undo-pass");
  await context.close();
  return "PASS";
}

await waitForHttp(`${mockBase}/health`);
await waitForHttp(`${appBase}/routes`);

const browser = await chromium.launch({ headless: true });
const results = {};
try {
  results.routeNoActive = await routeWithoutActiveSession(browser);
  results.routeActiveInclude = await routeWithActiveSessionInclude(browser);
  results.routeActiveRouteOnly = await routeWithActiveSessionRouteOnly(browser);
  results.duplicateReuse = await reusedCustomerCopy(browser);
  results.sessionAddCustomer = await sessionAddCustomer(browser);
  results.unifiedMobileMenu = await unifiedMobileMenu(browser);
  results.manualCheckin = await manualCheckin(browser);
  results.F05_UI_BROWSER_SMOKE = "PASS";
} catch (error) {
  results.F05_UI_BROWSER_SMOKE = "FAIL";
  results.error = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ""}` : String(error);
  let index = 0;
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      index += 1;
      await page.screenshot({ path: `${resultsDir}/failure-${index}.png`, fullPage: true }).catch(() => {});
      await writeFile(`${resultsDir}/failure-${index}.html`, await page.content()).catch(() => {});
    }
  }
  throw error;
} finally {
  await browser.close();
  await writeFile(`${resultsDir}/result.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
