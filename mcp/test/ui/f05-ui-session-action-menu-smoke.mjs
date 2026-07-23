import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
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

await waitForHttp(`${appBase}/visits?routeId=route-active&date=2099-12-30`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();

try {
  await page.goto(`${appBase}/visits?routeId=route-active&date=2099-12-30`, { waitUntil: "networkidle" });

  const appMenuButton = page.getByRole("button", { name: "Mở menu ứng dụng", exact: true });
  await appMenuButton.waitFor({ state: "visible" });
  assert.equal(await appMenuButton.count(), 1, "mobile must have exactly one top menu button");
  assert.equal(await page.getByRole("button", { name: "Cài đặt", exact: true }).count(), 0, "standalone settings button must be removed");
  assert.equal(await page.getByRole("button", { name: "Mở menu tác vụ phiên", exact: true }).count(), 0, "standalone session action button must be removed");
  assert.equal(await page.locator("[data-page-header-actions] button").count(), 0, "page header must not contain a second menu button");

  const triggerBox = await appMenuButton.boundingBox();
  assert.ok(triggerBox, "unified menu button must have a mobile bounding box");
  assert.ok(triggerBox.x >= 0 && triggerBox.x + triggerBox.width <= 390, `unified menu button must stay inside viewport: ${JSON.stringify(triggerBox)}`);

  await page.screenshot({ path: `${resultsDir}/12-unified-menu-trigger-mobile.png`, fullPage: true });
  await appMenuButton.click();

  const menu = page.getByRole("dialog", { name: "Menu phiên", exact: true });
  await menu.waitFor({ state: "visible" });
  await menu.getByRole("button", { name: /Xem báo cáo phiên/ }).waitFor({ state: "visible" });
  const exportButton = menu.getByRole("button", { name: /Xuất dữ liệu/ });
  await exportButton.waitFor({ state: "visible" });
  const closeSessionButton = menu.getByRole("button", { name: /Chốt phiên/ });
  await closeSessionButton.waitFor({ state: "visible" });
  await menu.getByRole("button", { name: /Cài đặt ứng dụng/ }).waitFor({ state: "visible" });
  assert.match(String(await closeSessionButton.getAttribute("class")), /danger/, "close session must remain a destructive menu item");

  await page.screenshot({ path: `${resultsDir}/13-unified-app-menu-mobile.png`, fullPage: true });
  await exportButton.click();

  const exportSheet = page.getByRole("dialog", { name: "Xuất dữ liệu phiên", exact: true });
  await exportSheet.waitFor({ state: "visible" });
  const pdfButton = exportSheet.getByRole("button", { name: /Báo cáo phiên PDF/ });
  const excelButton = exportSheet.getByRole("button", { name: /Checklist khách Excel/ });
  await pdfButton.waitFor({ state: "visible" });
  await excelButton.waitFor({ state: "visible" });
  assert.equal(await pdfButton.getAttribute("data-export-kind"), "pdf");
  assert.equal(await excelButton.getAttribute("data-export-kind"), "excel");
  assert.equal(await pdfButton.isEnabled(), true, "PDF export action must be enabled");
  assert.equal(await excelButton.isEnabled(), true, "Excel export action must be enabled");
  await page.screenshot({ path: `${resultsDir}/14-unified-export-menu-mobile.png`, fullPage: true });

  console.log(JSON.stringify({
    F05_UNIFIED_MOBILE_MENU_SMOKE: "PASS",
    viewport: "390x844",
    triggerCount: 1,
    standaloneSettingsButton: false,
    standaloneSessionButton: false,
    actions: ["report", "export", "close", "settings"],
    exportActions: "PASS"
  }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
