import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const appBase = process.env.F05_UI_APP_BASE || "http://127.0.0.1:3000";
const resultsDir = process.env.F05_UI_RESULTS_DIR || "test-results/f05-ui-smoke";
await mkdir(resultsDir, { recursive: true });

async function waitForHttp(url, timeoutMs = 120000) {
  const started = Date.now();
  let lastError;
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

async function verifyMobile(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${appBase}/orders`, { waitUntil: "networkidle" });

  const tabs = page.getByRole("tab");
  assert.equal(await tabs.count(), 4, "orders must expose exactly four internal tabs");
  assert.equal(await page.getByRole("tab", { name: /Đơn hàng/ }).getAttribute("aria-selected"), "true");
  await page.getByRole("button", { name: "+ Tạo đơn", exact: true }).waitFor({ state: "visible" });
  assert.equal(await page.locator('[role="tabpanel"]').count(), 1, "only the active orders panel may render");
  assert.ok(await page.getByText("DH-UI-001", { exact: false }).count(), "default orders list must render live order rows");
  const defaultGeometry = await verifyNoBodyOverflow(page, "orders default mobile");

  await page.getByRole("tab", { name: /Cần xử lý/ }).click();
  await page.waitForURL((url) => url.pathname === "/orders" && url.searchParams.get("view") === "attention");
  await page.getByRole("tabpanel", { name: "Cần xử lý" }).waitFor({ state: "visible" });
  for (const label of ["Chờ xử lý", "Tồn quá 3 ngày", "Nghi trùng", "Đã hủy", "Giá trị bằng 0"]) {
    await page.getByRole("button", { name: new RegExp(label) }).first().waitFor({ state: "visible" });
  }
  assert.ok(await page.getByText("Đơn có dấu hiệu trùng", { exact: false }).count(), "attention panel must show duplicate risk");

  await page.getByRole("tab", { name: /Doanh số đặt hàng/ }).click();
  await page.waitForURL((url) => url.searchParams.get("view") === "sales");
  const salesPanel = page.getByRole("tabpanel", { name: "Doanh số đặt hàng" });
  await salesPanel.getByText("Đang đo doanh số đặt hàng", { exact: true }).waitFor({ state: "visible" });
  await salesPanel.getByText(/chưa phải doanh thu giao hàng hoặc tiền đã thu/).waitFor({ state: "visible" });
  assert.equal(await salesPanel.locator('[aria-label="Chỉ số doanh số đặt hàng"] > *').count(), 4, "sales panel must show four focused KPIs");
  await salesPanel.getByText("Nhịp doanh số theo ngày", { exact: true }).waitFor({ state: "visible" });
  await verifyNoBodyOverflow(page, "orders sales mobile");

  await page.getByRole("tab", { name: /Tổng quan/ }).click();
  await page.waitForURL((url) => url.searchParams.get("view") === "overview");
  const overviewPanel = page.getByRole("tabpanel", { name: "Tổng quan đơn hàng" });
  assert.equal(await overviewPanel.locator('[aria-label="Tổng quan đơn hàng"] > *').count(), 4, "overview must contain exactly four decision cards");
  assert.equal(await overviewPanel.getByText("Nhịp doanh số theo ngày", { exact: true }).count(), 0, "overview must not duplicate the full sales report");
  await page.screenshot({ path: `${resultsDir}/orders-tabs-mobile.png`, fullPage: true });
  const overviewGeometry = await verifyNoBodyOverflow(page, "orders overview mobile");
  await context.close();
  return { defaultGeometry, overviewGeometry };
}

async function verifyDesktop(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${appBase}/orders?view=overview`, { waitUntil: "networkidle" });
  assert.equal(await page.getByRole("tab").count(), 4);
  assert.equal(await page.locator('[data-bottom-navigation="true"]').isVisible(), false, "desktop must keep the mobile dock hidden");
  const rail = page.getByRole("tablist", { name: "Phân tích và xử lý đơn hàng" });
  const railStyle = await rail.evaluate((node) => {
    const style = getComputedStyle(node);
    return { display: style.display, columns: style.gridTemplateColumns, overflowX: style.overflowX };
  });
  assert.equal(railStyle.display, "grid", "desktop orders tabs must use a four-column rail");
  assert.equal(railStyle.columns.split(" ").filter(Boolean).length, 4, "desktop tab rail must resolve to four columns");
  const geometry = await verifyNoBodyOverflow(page, "orders desktop");
  await page.screenshot({ path: `${resultsDir}/orders-tabs-desktop.png`, fullPage: false });
  await context.close();
  return { railStyle, geometry };
}

await waitForHttp(`${appBase}/orders`);
const browser = await chromium.launch({ headless: true });
const result = { ORDERS_TABS_BROWSER_SMOKE: "FAIL" };
try {
  result.mobile = await verifyMobile(browser);
  result.desktop = await verifyDesktop(browser);
  result.fourViews = "PASS";
  result.defaultOrders = "PASS";
  result.attention = "PASS";
  result.orderSales = "PASS";
  result.overviewFourKpis = "PASS";
  result.noHorizontalOverflow = "PASS";
  result.ORDERS_TABS_BROWSER_SMOKE = "PASS";
} catch (error) {
  result.error = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ""}` : String(error);
  throw error;
} finally {
  await writeFile(`${resultsDir}/orders-tabs-browser-result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}
