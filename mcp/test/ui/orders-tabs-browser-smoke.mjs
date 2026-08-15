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

async function verifyNoBodyOverflow(page, label) {
  const geometry = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth
  }));
  assert.ok(geometry.documentWidth <= geometry.viewport + 1, `${label}: document must not overflow horizontally`);
  assert.ok(geometry.bodyWidth <= geometry.viewport + 1, `${label}: body must not overflow horizontally`);
  return geometry;
}

async function verifyProtectedOrdersEntry(browser, width, height) {
  const context = await browser.newContext({
    viewport: { width, height },
    extraHTTPHeaders: proxyHeaders
  });
  const page = await context.newPage();
  await page.goto(`${appBase}/orders`, { waitUntil: "networkidle" });

  assert.equal(new URL(page.url()).pathname, "/login", `${width}px: protected /orders must redirect to login without a workforce session`);
  assert.equal(new URL(page.url()).searchParams.get("returnTo"), "/orders", `${width}px: login must preserve /orders return target`);
  await page.getByRole("heading", { name: "Đăng nhập nhân viên", exact: true }).waitFor({ state: "visible" });
  assert.equal(await page.getByRole("tab").count(), 0, `${width}px: legacy order-intent tabs must not render before authentication`);
  const geometry = await verifyNoBodyOverflow(page, `orders auth boundary ${width}px`);

  if (width === 390) {
    await page.screenshot({ path: `${resultsDir}/orders-auth-boundary-mobile.png`, fullPage: true });
  }
  await context.close();
  return { width, destination: "/login", returnTo: "/orders", geometry };
}

await waitForHttp(`${appBase}/`);
const browser = await chromium.launch({ headless: true });
const result = { ORDERS_BOUNDARY_BROWSER_SMOKE: "FAIL" };
try {
  result.mobile = [];
  for (const viewport of [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 430, height: 932 }
  ]) {
    result.mobile.push(await verifyProtectedOrdersEntry(browser, viewport.width, viewport.height));
  }
  result.desktop = await verifyProtectedOrdersEntry(browser, 1280, 800);
  result.ordersAuthGate = "PASS";
  result.ordersReturnTo = "/orders";
  result.legacyOrderIntentTabsAbsent = "PASS";
  result.noHorizontalOverflow = "PASS";
  result.ORDERS_BOUNDARY_BROWSER_SMOKE = "PASS";
} catch (error) {
  result.error = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ""}` : String(error);
  throw error;
} finally {
  await writeFile(`${resultsDir}/orders-tabs-browser-result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}
