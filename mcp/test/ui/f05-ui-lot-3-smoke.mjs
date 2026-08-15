import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const appBase = process.env.F05_UI_APP_BASE || "http://127.0.0.1:3000";
const resultsDir = process.env.F05_UI_RESULTS_DIR || "test-results/f05-ui-smoke";
const proxyHeaders = { "x-forwarded-proto": "https" };
await mkdir(resultsDir, { recursive: true });

async function waitForHttp(url, timeoutMs = 120000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return;
      lastError = new Error(`${url} -> ${response.status}`);
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw lastError || new Error(`timeout_waiting_for_${url}`);
}

async function horizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function screenshot(page, name) {
  await page.screenshot({ path: `${resultsDir}/${name}.png`, fullPage: true });
}

await waitForHttp(`${appBase}/`);
await waitForHttp(`${appBase}/mcp/sessions?dateFrom=2099-12-01&dateTo=2099-12-31`);

const browser = await chromium.launch({ headless: true });
const result = { MCP_UI_LOT_3_SMOKE: "FAIL" };
const mobileViewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 }
];

try {
  for (const viewport of mobileViewports) {
    const homeContext = await browser.newContext({ viewport });
    const homePage = await homeContext.newPage();
    await homePage.goto(`${appBase}/`, { waitUntil: "networkidle" });
    for (const text of ["Tổng quan hôm nay", "Điều hành gọn trên điện thoại", "Mở tuyến trước, sau đó xem nhanh phiên, đơn, báo cáo và việc cần xử lý."]) {
      assert.equal(await homePage.getByText(text, { exact: true }).count(), 0, `home must remove ${text}`);
    }
    await homePage.getByRole("link", { name: /Đi tuyến hôm nay/ }).waitFor({ state: "visible" });
    assert.ok(await horizontalOverflow(homePage) <= 1, `home overflow at ${viewport.width}px`);
    await screenshot(homePage, `20-home-no-explainer-${viewport.width}`);
    await homeContext.close();

    const sessionsContext = await browser.newContext({ viewport });
    const sessionsPage = await sessionsContext.newPage();
    await sessionsPage.goto(`${appBase}/mcp/sessions?dateFrom=2099-12-01&dateTo=2099-12-31`, { waitUntil: "networkidle" });
    const filterToggle = sessionsPage.getByRole("button", { name: /Bộ lọc/ });
    await filterToggle.waitFor({ state: "visible" });
    assert.equal(await filterToggle.getAttribute("aria-expanded"), "false");
    const filterForm = sessionsPage.locator("#mcp-session-filter-form");
    assert.equal(await filterForm.evaluate((node) => getComputedStyle(node).display), "none");
    await filterToggle.click();
    assert.equal(await filterToggle.getAttribute("aria-expanded"), "true");
    const sessionCard = sessionsPage.locator("[data-session-card]").first();
    await sessionCard.waitFor({ state: "visible" });
    assert.equal(await sessionCard.locator("[data-session-primary-action]").count(), 1);
    assert.ok(await horizontalOverflow(sessionsPage) <= 1, `sessions overflow at ${viewport.width}px`);
    await screenshot(sessionsPage, `21-sessions-mobile-${viewport.width}`);
    await sessionsContext.close();

    const orderContext = await browser.newContext({ viewport, extraHTTPHeaders: proxyHeaders });
    const orderPage = await orderContext.newPage();
    let legacyOnboardingCalls = 0;
    let legacySalesOrderCalls = 0;
    await orderPage.route("**/api/backend/mcp-day/session-customer/customer-onboarding**", async (route) => {
      legacyOnboardingCalls += 1;
      await route.abort();
    });
    await orderPage.route("**/api/backend/mcp-day/session-customer/sales-order**", async (route) => {
      legacySalesOrderCalls += 1;
      await route.abort();
    });
    await orderPage.goto(`${appBase}/visits/order-intent?sessionCustomerId=sc-existing&orderId=order-ui&customerName=UI%20Existing%20Customer`, { waitUntil: "networkidle" });
    await orderPage.waitForURL((url) => url.pathname === "/login" && url.searchParams.get("returnTo") === "/orders");
    assert.equal(legacyOnboardingCalls, 0, "retired route must not call session onboarding");
    assert.equal(legacySalesOrderCalls, 0, "retired route must not call session sales-order");
    await orderPage.getByRole("heading", { name: "Đăng nhập nhân viên", exact: true }).waitFor({ state: "visible" });
    assert.equal(await orderPage.locator("[data-order-step]").count(), 0, "legacy order-intent wizard must stay absent");
    assert.ok(await horizontalOverflow(orderPage) <= 1, `orders auth boundary overflow at ${viewport.width}px`);
    await screenshot(orderPage, `22-legacy-order-redirect-${viewport.width}`);
    await orderContext.close();
  }

  const desktopContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const desktopPage = await desktopContext.newPage();
  await desktopPage.goto(`${appBase}/mcp/sessions?dateFrom=2099-12-01&dateTo=2099-12-31`, { waitUntil: "networkidle" });
  assert.equal(await desktopPage.locator(".mcp-session-filter-toggle").evaluate((node) => getComputedStyle(node).display), "none");
  assert.notEqual(await desktopPage.locator("#mcp-session-filter-form").evaluate((node) => getComputedStyle(node).display), "none");
  assert.equal(await desktopPage.locator("[data-session-card]").first().locator("[data-session-primary-action]").count(), 1);
  assert.ok(await horizontalOverflow(desktopPage) <= 1, "sessions desktop must not overflow");
  await screenshot(desktopPage, "23-sessions-desktop");
  await desktopContext.close();

  result.MCP_UI_LOT_3_SMOKE = "PASS";
  result.mobileViewports = mobileViewports.map(({ width, height }) => `${width}x${height}`);
  result.homeExplainerRemoved = "PASS";
  result.sessionsCompactFlow = "PASS";
  result.orderIntentRetired = "PASS";
  result.orderIntentAuthBoundary = "/login?returnTo=/orders";
  result.desktopSessions = "PASS";
} catch (error) {
  result.error = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ""}` : String(error);
  throw error;
} finally {
  await writeFile(`${resultsDir}/lot-3-result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}
