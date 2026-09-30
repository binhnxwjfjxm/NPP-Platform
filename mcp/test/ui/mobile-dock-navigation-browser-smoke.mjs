import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const appBase = process.env.F05_UI_APP_BASE || "http://127.0.0.1:3000";
const resultsDir = process.env.F05_UI_RESULTS_DIR || "test-results/f05-ui-smoke";
await mkdir(resultsDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const result = { MOBILE_DOCK_NAVIGATION: "FAIL" };

try {
  await page.goto(`${appBase}/routes`, { waitUntil: "domcontentloaded" });
  const slot = page.locator("[data-mcp-bottom-navigation]");
  await slot.waitFor({ state: "visible" });
  const links = slot.locator("a");

  assert.equal(await links.count(), 5);
  assert.deepEqual(await links.allTextContents(), ["Hôm nay", "Đi tuyến", "Điểm bán", "Đơn hàng", "Thêm"]);
  assert.equal(await slot.locator('a[aria-current="page"]').innerText(), "Thêm");
  assert.equal(await slot.getByRole("link", { name: "Đi tuyến", exact: true }).getAttribute("data-client-navigation"), "true");

  await page.goto(`${appBase}/visits?routeId=route-active&date=2099-12-30`, { waitUntil: "domcontentloaded" });
  const visitSlot = page.locator("[data-mcp-bottom-navigation]");
  await visitSlot.waitFor({ state: "visible" });
  const homeLink = visitSlot.getByRole("link", { name: "Hôm nay", exact: true });
  assert.equal(await homeLink.getAttribute("data-document-navigation"), "true");

  result.MOBILE_DOCK_NAVIGATION = "PASS";
  result.itemCount = 5;
  result.primaryLabels = ["Hôm nay", "Đi tuyến", "Điểm bán", "Đơn hàng", "Thêm"];
  result.visitEscape = "document-navigation";
} catch (error) {
  result.error = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ""}` : String(error);
  throw error;
} finally {
  await writeFile(`${resultsDir}/mobile-dock-navigation-result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await context.close();
  await browser.close();
}
