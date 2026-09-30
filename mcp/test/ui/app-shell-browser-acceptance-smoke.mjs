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

async function shellMetrics(page) {
  return page.evaluate(() => {
    const topNode = document.querySelector("[data-mcp-app-top-bar]");
    const mainNode = document.querySelector("[data-mcp-scroll-region]");
    const slotNode = document.querySelector("[data-mcp-bottom-navigation]");
    const bottomNode = slotNode?.querySelector("nav");
    const sidebarNode = document.querySelector("[data-mcp-sidebar]");
    const contentNode = document.querySelector("[data-mcp-app-content-shell]");
    const top = topNode?.getBoundingClientRect();
    const main = mainNode?.getBoundingClientRect();
    const slot = slotNode?.getBoundingClientRect();
    const bottom = bottomNode?.getBoundingClientRect();
    const sidebar = sidebarNode?.getBoundingClientRect();
    const content = contentNode?.getBoundingClientRect();
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      top: top ? { top: top.top, bottom: top.bottom, left: top.left, right: top.right, height: top.height } : null,
      main: main ? { top: main.top, bottom: main.bottom, left: main.left, right: main.right, height: main.height } : null,
      slot: slot ? { top: slot.top, bottom: slot.bottom, left: slot.left, right: slot.right, height: slot.height } : null,
      bottom: bottom ? { top: bottom.top, bottom: bottom.bottom, left: bottom.left, right: bottom.right, height: bottom.height } : null,
      sidebar: sidebar ? { left: sidebar.left, right: sidebar.right, height: sidebar.height } : null,
      content: content ? { left: content.left, right: content.right } : null
    };
  });
}

async function verifyMobile(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${appBase}/routes`, { waitUntil: "domcontentloaded" });

  const topBar = page.locator("[data-mcp-app-top-bar]");
  await topBar.waitFor({ state: "visible" });
  await topBar.getByText("Tuyến cố định", { exact: true }).waitFor({ state: "visible" });

  const slot = page.locator("[data-mcp-bottom-navigation]");
  await slot.waitFor({ state: "visible" });
  const links = slot.locator("nav a");
  assert.equal(await links.count(), 5);
  assert.deepEqual(await links.allTextContents(), ["Hôm nay", "Đi tuyến", "Điểm bán", "Đơn hàng", "Thêm"]);
  assert.equal(await slot.getAttribute("data-navigation-item-count"), "5");
  assert.equal(await slot.locator('a[aria-current="page"]').innerText(), "Thêm");

  const before = await shellMetrics(page);
  assert.ok(before.top && before.main && before.slot && before.bottom, "mobile shell regions must exist");
  assert.ok(before.top.bottom <= before.main.top + 1, "top bar must not overlap the scroll region");
  assert.ok(before.main.bottom <= before.slot.top + 1, "scroll region must not overlap bottom navigation");
  assert.ok(Math.abs(before.slot.bottom - before.viewport.height) <= 1, "bottom navigation row must stay attached to the viewport");
  assert.ok(before.bottom.height >= 68, "bottom navigation must keep the Mobile 68px baseline");

  const moreLink = slot.getByRole("link", { name: "Thêm", exact: true });
  const moreColor = await moreLink.evaluate((node) => getComputedStyle(node).color);
  assert.equal(moreColor, "rgb(22, 119, 255)");

  await page.evaluate(() => {
    const main = document.querySelector("[data-mcp-scroll-region]");
    const spacer = document.createElement("div");
    spacer.style.height = "1600px";
    main?.append(spacer);
    if (main instanceof HTMLElement) main.scrollTop = main.scrollHeight;
  });
  const after = await shellMetrics(page);
  assert.equal(Math.round(after.top.top), Math.round(before.top.top));
  assert.equal(Math.round(after.slot.top), Math.round(before.slot.top));

  const trigger = topBar.getByRole("button", { name: "Mở menu ứng dụng", exact: true });
  await trigger.click();
  const menu = page.locator('[data-mcp-app-menu-panel="true"]');
  await menu.waitFor({ state: "visible" });
  for (const label of ["Hôm nay", "Đi tuyến", "Điểm bán", "Đơn hàng", "Thêm"]) {
    await menu.getByRole("button", { name: new RegExp(`^${label}`) }).waitFor({ state: "visible" });
  }
  const menuStyle = await menu.evaluate((node) => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, color: style.color };
  });
  assert.equal(menuStyle.background, "rgb(255, 255, 255)");
  assert.equal(menuStyle.color, "rgb(16, 35, 63)");

  await page.screenshot({ path: `${resultsDir}/16-app-shell-mobile-acceptance.png`, fullPage: true });
  await context.close();
}

async function verifyDesktop(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${appBase}/routes`, { waitUntil: "domcontentloaded" });

  await page.locator("[data-mcp-sidebar]").waitFor({ state: "visible" });
  assert.equal(await page.locator("[data-mcp-bottom-navigation]").isVisible(), false);
  const sidebarLinks = page.locator("[data-mcp-sidebar] nav a");
  assert.equal(await sidebarLinks.count(), 5);
  assert.deepEqual(await sidebarLinks.allTextContents(), [
    "Hôm nayTuyến, tiến độ và công việc cần xử lý trong ngày",
    "Đi tuyếnLàm việc theo tuyến và ghi nhận kết quả tại điểm bán",
    "Điểm bánTra cứu điểm bán, khách Công Ty và thông tin liên hệ",
    "Đơn hàngTheo dõi và tạo đơn hàng",
    "ThêmMở các chức năng quản lý, báo cáo và thiết lập"
  ]);

  const metrics = await shellMetrics(page);
  assert.ok(metrics.sidebar && metrics.content && metrics.top && metrics.main);
  assert.ok(metrics.sidebar.right <= metrics.content.left + 1);
  assert.ok(metrics.top.bottom <= metrics.main.top + 1);

  await page.screenshot({ path: `${resultsDir}/17-app-shell-desktop-acceptance.png`, fullPage: false });
  await context.close();
}

await waitForHttp(`${appBase}/routes`);
const browser = await chromium.launch({ headless: true });
const result = { APP_SHELL_BROWSER_ACCEPTANCE: "FAIL" };

try {
  await verifyMobile(browser);
  await verifyDesktop(browser);
  result.APP_SHELL_BROWSER_ACCEPTANCE = "PASS";
  result.primaryNavigation = ["Hôm nay", "Đi tuyến", "Điểm bán", "Đơn hàng", "Thêm"];
  result.shellOwnership = "foundation";
} catch (error) {
  result.error = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ""}` : String(error);
  throw error;
} finally {
  await writeFile(`${resultsDir}/app-shell-browser-acceptance-result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}
