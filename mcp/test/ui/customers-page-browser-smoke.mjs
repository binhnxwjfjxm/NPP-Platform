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

async function assertNoInventedMetrics(page) {
  for (const label of ["Hạng A", "Doanh số tháng", "Ghé gần nhất", "Đơn gần nhất", "Cần ghé lại"]) {
    assert.equal(await page.getByText(label, { exact: true }).count(), 0, `customers must not render invented metric: ${label}`);
  }
}

async function verifyMobile(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${appBase}/customers`, { waitUntil: "networkidle" });

  await page.getByRole("heading", { name: "Điểm bán", exact: true }).waitFor({ state: "visible" });
  await page.getByPlaceholder("Tên, liên hệ, khu vực hoặc tuyến").waitFor({ state: "visible" });
  assert.equal(await page.getByLabel("Tuyến", { exact: true }).count(), 1, "customers mobile must expose route filter");
  assert.equal(await page.getByLabel("Trạng thái", { exact: true }).count(), 1, "customers mobile must expose status filter");
  const cards = page.locator("[data-outlet-mobile-card]");
  const cardCount = await cards.count();
  assert.ok(cardCount, "customers mobile must render live route-customer cards");
  await assertNoInventedMetrics(page);

  const dock = page.locator('[data-bottom-navigation="true"]');
  await dock.waitFor({ state: "visible" });
  assert.equal(await dock.getByRole("link", { name: "Khách", exact: true }).getAttribute("aria-current"), "page");

  await cards.first().getByRole("button", { name: /Mở hồ sơ/ }).click();
  const sheet = page.getByRole("dialog");
  await sheet.waitFor({ state: "visible" });
  await sheet.getByText("Trạng thái hồ sơ", { exact: true }).waitFor({ state: "visible" });
  const directions = sheet.getByRole("link", { name: "Di chuyển", exact: true });
  assert.match(String(await directions.getAttribute("href")), /^https:\/\/www\.google\.com\/maps\//, "customer profile must link to Google Maps");
  assert.equal(await directions.getAttribute("target"), null, "customer profile directions must stay reliable in the current mobile tab");

  const geometry = await verifyNoHorizontalOverflow(page, "customers mobile");
  await page.screenshot({ path: `${resultsDir}/customers-mobile.png`, fullPage: true });
  await context.close();
  return { cards: cardCount, geometry };
}

async function verifyDesktop(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${appBase}/customers`, { waitUntil: "networkidle" });

  const table = page.getByRole("table");
  await table.waitFor({ state: "visible" });
  for (const header of ["STT", "Điểm bán", "Liên hệ", "Khu vực", "Tuyến", "Vị trí", "Trạng thái"]) {
    await table.getByRole("columnheader", { name: header, exact: true }).waitFor({ state: "visible" });
  }
  assert.ok(await table.getByRole("row").count() > 1, "customers desktop must render at least one data row");
  assert.equal(await page.locator('[data-bottom-navigation="true"]').isVisible(), false, "desktop must keep mobile dock hidden");
  await assertNoInventedMetrics(page);

  const search = page.getByPlaceholder("Tên, liên hệ, khu vực hoặc tuyến");
  const firstName = await table.getByRole("row").nth(1).getByRole("cell").nth(1).innerText();
  await search.fill(firstName);
  assert.equal(await table.getByRole("row").count(), 2, "search must narrow customers to the matching data row");

  const geometry = await verifyNoHorizontalOverflow(page, "customers desktop");
  await page.screenshot({ path: `${resultsDir}/customers-desktop.png`, fullPage: false });
  await context.close();
  return { firstName, geometry };
}

await waitForHttp(`${appBase}/customers`);
const browser = await chromium.launch({ headless: true });
const result = { CUSTOMERS_PAGE_BROWSER_SMOKE: "FAIL" };
try {
  result.mobile = await verifyMobile(browser);
  result.desktop = await verifyDesktop(browser);
  result.realRouteCustomerFields = "PASS";
  result.noInventedMetrics = "PASS";
  result.mobileDirections = "PASS";
  result.CUSTOMERS_PAGE_BROWSER_SMOKE = "PASS";
} catch (error) {
  result.error = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ""}` : String(error);
  throw error;
} finally {
  await writeFile(`${resultsDir}/customers-page-browser-result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}
