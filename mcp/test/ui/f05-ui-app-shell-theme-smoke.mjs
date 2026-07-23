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

async function screenshot(page, name) {
  await page.screenshot({ path: `${resultsDir}/${name}.png`, fullPage: true });
}

await waitForHttp(`${appBase}/routes`);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const result = { F05_APP_SHELL_THEME_SMOKE: "FAIL" };

try {
  await page.goto(`${appBase}/routes`, { waitUntil: "networkidle" });
  const shell = page.locator(".app-shell");
  assert.equal(await shell.getAttribute("data-shell-section"), "routes");

  const topBar = page.locator("[data-app-top-bar]");
  await topBar.waitFor({ state: "visible" });
  await topBar.getByText("Tuyến bán hàng", { exact: true }).waitFor({ state: "visible" });
  const trigger = topBar.getByRole("button", { name: "Mở menu ứng dụng", exact: true });
  assert.equal(await trigger.count(), 1, "top bar must own exactly one menu trigger");
  assert.equal(await page.locator("body > .card").count(), 0, "route export must not render as a detached card before AppShell");
  const exportTrigger = topBar.locator('summary[aria-label="Mở xuất dữ liệu tuyến"]');
  await exportTrigger.waitFor({ state: "visible" });
  await exportTrigger.click();
  await topBar.getByRole("link", { name: "Xuất khách tuyến", exact: true }).waitFor({ state: "visible" });
  await topBar.getByRole("link", { name: "Xuất khách cần GPS", exact: true }).waitFor({ state: "visible" });
  await exportTrigger.click();

  const positions = await page.evaluate(() => {
    const bar = document.querySelector("[data-app-top-bar]");
    const button = bar?.querySelector('button[aria-label="Mở menu ứng dụng"]');
    return {
      bar: bar ? getComputedStyle(bar).position : "missing",
      trigger: button ? getComputedStyle(button).position : "missing"
    };
  });
  assert.equal(positions.bar, "sticky");
  assert.notEqual(positions.trigger, "fixed");
  await screenshot(page, "12-app-shell-routes-topbar");

  await trigger.click();
  const menu = page.getByRole("dialog").last();
  await menu.waitFor({ state: "visible" });
  for (const heading of ["Vận hành hôm nay", "Quản lý MCP", "Thiết lập nghiệp vụ"]) {
    await menu.getByText(heading, { exact: true }).waitFor({ state: "visible" });
  }
  for (const label of ["Tổng quan", "Tuyến bán hàng", "Đi tuyến hôm nay", "Lịch sử phiên", "Điểm bán", "Đơn hàng", "Báo cáo phiên", "Kế hoạch", "Cài đặt MCP", "Cài đặt ứng dụng"]) {
    await menu.getByRole("button", { name: new RegExp(`^${label}`) }).first().waitFor({ state: "visible" });
  }
  await screenshot(page, "13-app-shell-expanded-menu");

  await menu.getByRole("button", { name: /^Đi tuyến hôm nay/ }).click();
  await page.waitForURL((url) => url.pathname === "/mcp");
  assert.equal(await page.locator(".app-shell").getAttribute("data-shell-section"), "business");
  await page.locator("[data-app-top-bar]").getByText("MCP", { exact: true }).waitFor({ state: "visible" });

  await page.goto(`${appBase}/visits?routeId=route-active&date=2099-12-30`, { waitUntil: "networkidle" });
  assert.equal(await page.locator(".app-shell").getAttribute("data-shell-section"), "session");
  await page.locator("[data-app-top-bar]").getByText("Đi tuyến hôm nay", { exact: true }).waitFor({ state: "visible" });
  const customer = page.locator("article").filter({ hasText: "UI Existing Customer" }).first();
  await customer.getByRole("button", { name: "Test", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Ghi kết quả thử sản phẩm", exact: true });
  const input = form.getByPlaceholder("Nhập tên sản phẩm");
  await input.waitFor({ state: "visible" });
  const formStyle = await input.evaluate((node) => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, border: style.borderTopColor };
  });
  assert.equal(formStyle.background, "rgb(255, 255, 255)");
  assert.equal(formStyle.border, "rgb(232, 222, 210)");
  await screenshot(page, "14-business-form-theme");

  result.F05_APP_SHELL_THEME_SMOKE = "PASS";
  result.sections = ["routes", "business", "session"];
  result.topBar = "PASS";
  result.routeExportOwnership = "PASS";
  result.expandedMenu = "PASS";
  result.businessFormTheme = "PASS";
} catch (error) {
  result.error = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ""}` : String(error);
  await screenshot(page, "app-shell-theme-failure").catch(() => {});
  await writeFile(`${resultsDir}/app-shell-theme-failure.html`, await page.content()).catch(() => {});
  throw error;
} finally {
  await writeFile(`${resultsDir}/app-shell-theme-result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await context.close();
  await browser.close();
}
