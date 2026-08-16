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

async function horizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

await waitForHttp(`${appBase}/`);
await waitForHttp(`${appBase}/routes`);
await waitForHttp(`${appBase}/plans`);
const browser = await chromium.launch({ headless: true });
const result = { F05_APP_SHELL_THEME_SMOKE: "FAIL" };

try {
  const mobileViewports = [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 430, height: 932 }
  ];

  for (const viewport of mobileViewports) {
    const homeContext = await browser.newContext({ viewport });
    const homePage = await homeContext.newPage();
    await homePage.goto(`${appBase}/`, { waitUntil: "domcontentloaded" });

    const launchpad = homePage.locator(".mobile-home-launchpad:visible");
    assert.equal(await launchpad.count(), 1, `home must show one launchpad at ${viewport.width}px`);
    const primaryAction = launchpad.getByRole("link", { name: /Đi tuyến hôm nay/ });
    await primaryAction.waitFor({ state: "visible" });
    assert.equal(await primaryAction.getAttribute("href"), "/visits");
    assert.equal(await launchpad.locator(".mobile-home-quick-grid a").count(), 5, "home must keep five operational shortcuts");
    assert.equal(await homePage.locator(".page-header:visible").count(), 0, "mobile home must not render a second hero/header");

    const commandGrid = homePage.locator(".dashboard-command-grid");
    if (await commandGrid.count()) {
      assert.equal(await commandGrid.evaluate((node) => getComputedStyle(node).display), "none", "desktop command grid must be hidden on mobile home");
    }

    const overflow = await horizontalOverflow(homePage);
    assert.ok(overflow <= 1, `home must not overflow horizontally at ${viewport.width}px; overflow=${overflow}`);
    await homePage.locator("[data-bottom-navigation]").waitFor({ state: "visible" });
    await screenshot(homePage, `11-home-mobile-${viewport.width}`);
    await homeContext.close();
  }

  const listSpecs = [
    {
      path: "/plans",
      card: "[data-plan-mobile-card]",
      title: "Ghé lại xác nhận nhu cầu trưng bày",
      action: /Mở chi tiết việc/,
      dialogName: "Ghé lại xác nhận nhu cầu trưng bày",
      detailLabels: ["Phụ trách", "Nguồn", "Ghi chú xử lý"],
      forbiddenCardText: ["Phụ trách", "Nguồn", "Ghi chú xử lý"]
    }
  ];

  for (const viewport of mobileViewports) {
    for (const spec of listSpecs) {
      const listContext = await browser.newContext({ viewport });
      const listPage = await listContext.newPage();
      await listPage.goto(`${appBase}${spec.path}`, { waitUntil: "domcontentloaded" });

      await listPage.locator(".page-header").waitFor({ state: "visible" });
      await listPage.locator(".route-mobile-list").waitFor({ state: "visible" });
      assert.equal(await listPage.locator(".route-desktop-table").evaluate((node) => getComputedStyle(node).display), "none");

      const card = listPage.locator(spec.card).first();
      await card.waitFor({ state: "visible" });
      await card.getByText(spec.title, { exact: true }).waitFor({ state: "visible" });
      for (const hiddenText of spec.forbiddenCardText) {
        assert.equal(await card.getByText(hiddenText, { exact: true }).count(), 0, `${spec.path} mobile card must not render ${hiddenText}`);
      }
      await card.getByText("Quá hạn", { exact: true }).waitFor({ state: "visible" });
      await card.getByText("Ưu tiên Cao", { exact: true }).waitFor({ state: "visible" });

      const action = card.getByRole("button", { name: spec.action });
      const actionHeight = await action.evaluate((node) => node.getBoundingClientRect().height);
      assert.ok(actionHeight >= 44, `${spec.path} primary card action must be at least 44px`);
      await action.click();

      const dialog = listPage.getByRole("dialog", { name: spec.dialogName });
      await dialog.waitFor({ state: "visible" });
      for (const label of spec.detailLabels) {
        await dialog.getByText(label, { exact: true }).waitFor({ state: "visible" });
      }
      await listPage.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });

      const overflow = await horizontalOverflow(listPage);
      assert.ok(overflow <= 1, `${spec.path} must not overflow horizontally at ${viewport.width}px; overflow=${overflow}`);
      await listPage.locator("[data-bottom-navigation]").waitFor({ state: "visible" });
      await screenshot(listPage, `15-${spec.path.slice(1)}-mobile-${viewport.width}`);
      await listContext.close();
    }
  }

  const desktopContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const desktopPage = await desktopContext.newPage();
  for (const spec of listSpecs) {
    await desktopPage.goto(`${appBase}${spec.path}`, { waitUntil: "domcontentloaded" });
    await desktopPage.locator(".route-desktop-table .desktop-table").waitFor({ state: "visible" });
    assert.equal(await desktopPage.locator(".route-mobile-list").evaluate((node) => getComputedStyle(node).display), "none");
    const overflow = await horizontalOverflow(desktopPage);
    assert.ok(overflow <= 1, `${spec.path} desktop must not overflow horizontally; overflow=${overflow}`);
    await screenshot(desktopPage, `16-${spec.path.slice(1)}-desktop`);
  }
  await desktopPage.goto(`${appBase}/actions`, { waitUntil: "domcontentloaded" });
  await desktopPage.waitForURL((url) => url.pathname === "/plans");
  await desktopContext.close();

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  try {
    await page.goto(`${appBase}/routes`, { waitUntil: "domcontentloaded" });
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
    await screenshot(page, "17-app-shell-routes-topbar");

    await trigger.click();
    const menu = page.getByRole("dialog").last();
    await menu.waitFor({ state: "visible" });
    for (const heading of ["Vận hành hôm nay", "Quản lý MCP", "Thiết lập nghiệp vụ"]) {
      await menu.getByText(heading, { exact: true }).waitFor({ state: "visible" });
    }
    for (const label of ["Tổng quan", "Tuyến bán hàng", "Đi tuyến hôm nay", "Lịch sử phiên", "Điểm bán", "Đơn hàng", "Báo cáo phiên", "Kế hoạch", "Cài đặt MCP", "Cài đặt ứng dụng"]) {
      await menu.getByRole("button", { name: new RegExp(`^${label}`) }).first().waitFor({ state: "visible" });
    }
    await screenshot(page, "18-app-shell-expanded-menu");

    await menu.getByRole("button", { name: /^Đi tuyến hôm nay/ }).click();
    await page.waitForURL((url) => url.pathname === "/routes");
    assert.equal(await page.locator(".app-shell").getAttribute("data-shell-section"), "routes");
    await page.locator("[data-app-top-bar]").getByText("Tuyến bán hàng", { exact: true }).waitFor({ state: "visible" });

    await page.goto(`${appBase}/visits?routeId=route-active&date=2099-12-30`, { waitUntil: "domcontentloaded" });
    assert.equal(await page.locator(".app-shell").getAttribute("data-shell-section"), "session");
    await page.locator("[data-app-top-bar]").getByText("Đi tuyến hôm nay", { exact: true }).waitFor({ state: "visible" });
    const customer = page.locator("article").filter({ hasText: "UI Existing Customer" }).first();
    const actionTrigger = customer.getByRole("button", { name: "Thao tác", exact: true });
    await actionTrigger.click();
    assert.equal(await actionTrigger.getAttribute("aria-expanded"), "true");
    await customer.getByRole("button", { name: "Test", exact: true }).click();
    const form = page.getByRole("dialog", { name: "Ghi kết quả thử sản phẩm", exact: true });
    const input = form.getByPlaceholder("Nhập tên sản phẩm");
    await input.waitFor({ state: "visible" });
    const formStyle = await input.evaluate((node) => {
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, border: style.borderTopColor };
    });
    assert.equal(formStyle.background, "rgb(255, 255, 255)");
    assert.equal(formStyle.border, "rgb(216, 208, 196)");
    await screenshot(page, "19-business-form-theme");

    result.F05_APP_SHELL_THEME_SMOKE = "PASS";
    result.sections = ["home", "plans", "routes", "business", "session"];
    result.customerAuthCoverage = "delegated-to-customers-page-browser-smoke";
    result.mobileViewports = mobileViewports.map(({ width, height }) => `${width}x${height}`);
    result.homeLayout = "PASS";
    result.mobileListSummaries = "PASS";
    result.desktopTables = "PASS";
    result.actionsRedirect = "PASS";
    result.topBar = "PASS";
    result.routeExportOwnership = "PASS";
    result.expandedMenu = "PASS";
    result.businessFormTheme = "PASS";
  } finally {
    await context.close();
  }
} catch (error) {
  result.error = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ""}` : String(error);
  throw error;
} finally {
  await writeFile(`${resultsDir}/app-shell-theme-result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}
