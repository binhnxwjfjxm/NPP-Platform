import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const appBase = process.env.F05_UI_APP_BASE || "http://127.0.0.1:3000";
const resultsDir = process.env.F05_UI_RESULTS_DIR || "test-results/f05-ui-smoke";
await mkdir(resultsDir, { recursive: true });

async function waitForHttp(url, timeoutMs = 120_000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { cache: "no-store", redirect: "manual" });
      if (response.status >= 200 && response.status < 400) return;
      lastError = new Error(`${url} -> ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw lastError || new Error(`timeout_waiting_for_${url}`);
}

async function verifyNoHorizontalOverflow(page, label) {
  const geometry = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth
  }));
  assert.ok(geometry.documentWidth <= geometry.viewport + 1, `${label}: document must not overflow horizontally`);
  assert.ok(geometry.bodyWidth <= geometry.viewport + 1, `${label}: body must not overflow horizontally`);
  return geometry;
}

async function verifyProtectedPage(browser, { viewport, path, expectedReturnTo, screenshotName }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(`${appBase}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForURL((url) => url.pathname === "/login");
  await page.getByRole("heading", { name: "Đăng nhập nhân viên", exact: true }).waitFor({ state: "visible" });
  await page.getByLabel("Tên đăng nhập", { exact: true }).waitFor({ state: "visible" });
  await page.getByLabel("Mật khẩu", { exact: true }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).waitFor({ state: "visible" });
  assert.equal(await page.locator(".app-shell").count(), 0, "protected customer pages must not stream the MCP shell before authentication");
  assert.equal(new URL(page.url()).searchParams.get("returnTo"), expectedReturnTo);
  assert.equal(await page.locator('input[name="returnTo"]').inputValue(), expectedReturnTo || "/customers");
  const geometry = await verifyNoHorizontalOverflow(page, path);
  await page.screenshot({ path: `${resultsDir}/${screenshotName}.png`, fullPage: true });
  await context.close();
  return geometry;
}

async function verifyProtectedApi(browser, path) {
  const context = await browser.newContext();
  const response = await context.request.get(`${appBase}${path}`, { failOnStatusCode: false });
  assert.equal(response.status(), 401, `${path} must deny unauthenticated access`);
  const payload = await response.json();
  assert.equal(payload?.error?.code, "UNAUTHORIZED", `${path} must expose the canonical unauthenticated code`);
  await context.close();
}

await waitForHttp(`${appBase}/login`);
const browser = await chromium.launch({ headless: true });
const result = { CUSTOMERS_PAGE_BROWSER_SMOKE: "FAIL" };
try {
  result.mobile = await verifyProtectedPage(browser, {
    viewport: { width: 390, height: 844 },
    path: "/customers",
    expectedReturnTo: null,
    screenshotName: "customers-auth-mobile"
  });
  result.desktop = await verifyProtectedPage(browser, {
    viewport: { width: 1280, height: 800 },
    path: "/customers/onboarding",
    expectedReturnTo: "/customers/onboarding",
    screenshotName: "customers-auth-desktop"
  });
  await verifyProtectedApi(browser, "/api/backend/core-customers");
  await verifyProtectedApi(browser, "/api/backend/customer-verifications");
  result.browserAuthGate = "PASS";
  result.apiAuthGate = "PASS";
  result.safeReturnTo = "PASS";
  result.CUSTOMERS_PAGE_BROWSER_SMOKE = "PASS";
} catch (error) {
  result.error = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ""}` : String(error);
  throw error;
} finally {
  await writeFile(`${resultsDir}/customers-page-browser-result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}
