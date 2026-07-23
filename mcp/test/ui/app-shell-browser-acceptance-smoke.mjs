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

function hexToRgb(value) {
  let hex = value.trim().replace(/^#/, "");
  if (hex.length === 3) hex = hex.split("").map((part) => `${part}${part}`).join("");
  assert.match(hex, /^[0-9a-f]{6}$/i, `unsupported color ${value}`);
  return [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
}

function luminance(value) {
  const [red, green, blue] = hexToRgb(value).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground, background) {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

async function shellMetrics(page) {
  return page.evaluate(() => {
    const topNode = document.querySelector("[data-app-top-bar]");
    const mainNode = document.querySelector("[data-app-scroll-region]");
    const bottomNode = document.querySelector('[data-bottom-navigation="true"]');
    const sidebarNode = document.querySelector(".sidebar");
    const contentNode = document.querySelector("[data-app-content-shell]");
    const firstBottomLink = bottomNode?.querySelector(".bottom-nav-link");
    const activeBottomLink = bottomNode?.querySelector(".bottom-nav-link.active");
    const top = topNode?.getBoundingClientRect();
    const main = mainNode?.getBoundingClientRect();
    const bottom = bottomNode?.getBoundingClientRect();
    const sidebar = sidebarNode?.getBoundingClientRect();
    const content = contentNode?.getBoundingClientRect();
    const firstBottomLinkRect = firstBottomLink?.getBoundingClientRect();
    const mainStyle = mainNode ? getComputedStyle(mainNode) : null;
    const bottomStyle = bottomNode ? getComputedStyle(bottomNode) : null;
    const activeBottomStyle = activeBottomLink ? getComputedStyle(activeBottomLink) : null;
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      top: top ? { top: top.top, right: top.right, bottom: top.bottom, left: top.left, width: top.width, height: top.height } : null,
      main: main ? { top: main.top, right: main.right, bottom: main.bottom, left: main.left, width: main.width, height: main.height } : null,
      bottom: bottom ? { top: bottom.top, right: bottom.right, bottom: bottom.bottom, left: bottom.left, width: bottom.width, height: bottom.height } : null,
      sidebar: sidebar ? { top: sidebar.top, right: sidebar.right, bottom: sidebar.bottom, left: sidebar.left, width: sidebar.width, height: sidebar.height } : null,
      content: content ? { top: content.top, right: content.right, bottom: content.bottom, left: content.left, width: content.width, height: content.height } : null,
      firstBottomLinkHeight: firstBottomLinkRect?.height || 0,
      mainPaddingBottom: mainStyle ? Number.parseFloat(mainStyle.paddingBottom) : 0,
      bottomPosition: bottomStyle?.position || null,
      bottomParentIsShell: bottomNode?.parentElement?.hasAttribute("data-app-content-shell") || false,
      bottomAppearance: bottomStyle ? {
        borderRadius: Number.parseFloat(bottomStyle.borderTopLeftRadius),
        borderTopWidth: Number.parseFloat(bottomStyle.borderTopWidth),
        marginTop: Number.parseFloat(bottomStyle.marginTop),
        marginRight: Number.parseFloat(bottomStyle.marginRight),
        marginBottom: Number.parseFloat(bottomStyle.marginBottom),
        marginLeft: Number.parseFloat(bottomStyle.marginLeft),
        boxShadow: bottomStyle.boxShadow
      } : null,
      activeBottomAppearance: activeBottomStyle ? {
        backgroundImage: activeBottomStyle.backgroundImage,
        backgroundColor: activeBottomStyle.backgroundColor,
        boxShadow: activeBottomStyle.boxShadow
      } : null
    };
  });
}

async function verifySingleTrigger(page) {
  const triggers = page.getByRole("button", { name: "Mở menu ứng dụng", exact: true });
  assert.equal(await triggers.count(), 1, "AppShell must render exactly one menu trigger");
  return triggers.first();
}

async function verifyContrast(page) {
  const tokens = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    const read = (name) => style.getPropertyValue(name).trim();
    return {
      canvas: read("--npp-color-canvas"),
      surface: read("--npp-color-surface"),
      header: read("--npp-color-header"),
      primary: read("--npp-color-primary"),
      text: read("--npp-color-text"),
      muted: read("--npp-color-text-muted"),
      onHeader: read("--npp-color-on-header")
    };
  });
  const ratios = {
    header: contrastRatio(tokens.onHeader, tokens.header),
    primary: contrastRatio(tokens.onHeader, tokens.primary),
    body: contrastRatio(tokens.text, tokens.surface),
    muted: contrastRatio(tokens.muted, tokens.canvas)
  };
  for (const [name, ratio] of Object.entries(ratios)) assert.ok(ratio >= 4.5, `${name} contrast ${ratio.toFixed(2)} must be >= 4.5`);
  return ratios;
}

async function verifyMobile(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${appBase}/routes`, { waitUntil: "networkidle" });

  const trigger = await verifySingleTrigger(page);
  const bottomNav = page.locator('[data-bottom-navigation="true"]');
  await bottomNav.waitFor({ state: "visible" });
  const bottomItems = bottomNav.locator("a");
  const bottomItemCount = await bottomItems.count();
  assert.ok(bottomItemCount <= 5, "bottom navigation must contain at most five items");
  assert.equal(Number(await bottomNav.getAttribute("data-navigation-item-count")), bottomItemCount);
  await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('[data-bottom-navigation="true"] .bottom-nav-link'));
    links.forEach((link) => link.classList.remove("active"));
    links.at(-1)?.classList.add("active");
  });

  const before = await shellMetrics(page);
  assert.ok(before.top && before.main && before.bottom, "mobile shell regions must exist");
  assert.ok(before.top.bottom <= before.main.top + 1, "top bar must not overlap the scroll region");
  assert.ok(before.main.bottom <= before.bottom.top + 1, "scroll region must not overlap bottom navigation");
  assert.ok(before.bottom.left >= 0 && before.bottom.right <= before.viewport.width, "bottom nav must stay inside viewport width");
  assert.ok(Math.abs(before.bottom.bottom - before.viewport.height) <= 1, "bottom nav must attach directly to the viewport bottom edge");
  assert.equal(before.bottomPosition, "relative", "bottom navigation must be an AppShell row, not a fixed viewport overlay");
  assert.equal(before.bottomParentIsShell, true, "bottom navigation must be owned by app-content-shell");
  assert.ok(Math.abs(before.bottom.height - 58) <= 1, "bottom nav visual height must stay at 58px");
  assert.ok(before.firstBottomLinkHeight >= 49 && before.firstBottomLinkHeight <= 51, "bottom nav shortcuts must keep a 50px touch target");
  assert.ok(before.bottomAppearance, "bottom navigation appearance must be measurable");
  assert.ok(before.bottomAppearance.borderRadius <= 0.1, "bottom nav shell must not render as a rounded floating card");
  assert.ok(before.bottomAppearance.borderTopWidth >= 1, "bottom nav must use a subtle top divider");
  for (const margin of [before.bottomAppearance.marginTop, before.bottomAppearance.marginRight, before.bottomAppearance.marginBottom, before.bottomAppearance.marginLeft]) {
    assert.ok(Math.abs(margin) <= 0.1, "bottom nav must not have floating outer margins");
  }
  assert.ok(before.activeBottomAppearance, "active bottom navigation item must be measurable");
  assert.equal(before.activeBottomAppearance.backgroundImage, "none", "active bottom item must not use the old gradient pill");
  assert.equal(before.activeBottomAppearance.boxShadow, "none", "active bottom item must not use an oversized floating shadow");

  await page.evaluate(() => {
    const main = document.querySelector("[data-app-scroll-region]");
    const spacer = document.createElement("div");
    spacer.dataset.acceptanceSpacer = "true";
    spacer.style.height = "1800px";
    main?.append(spacer);
    if (main instanceof HTMLElement) main.scrollTop = main.scrollHeight;
  });
  await page.waitForTimeout(80);
  const afterScroll = await shellMetrics(page);
  assert.equal(Math.round(afterScroll.top.top), Math.round(before.top.top), "top bar must remain fixed while main scrolls");
  assert.equal(Math.round(afterScroll.bottom.top), Math.round(before.bottom.top), "bottom nav height and position must remain stable while main scrolls");
  assert.equal(Math.round(afterScroll.bottom.height), Math.round(before.bottom.height), "bottom nav height must not change while main scrolls");

  await page.setViewportSize({ width: 390, height: 720 });
  await page.waitForTimeout(120);
  const afterViewportResize = await shellMetrics(page);
  assert.equal(Math.round(afterViewportResize.bottom.height), Math.round(before.bottom.height), "bottom nav height must stay constant when mobile browser chrome changes viewport height");
  assert.ok(afterViewportResize.main.bottom <= afterViewportResize.bottom.top + 1, "resized scroll region must not overlap bottom navigation");
  assert.ok(Math.abs(afterViewportResize.bottom.bottom - afterViewportResize.viewport.height) <= 1, "resized bottom nav must remain attached to the viewport bottom edge");

  await trigger.waitFor({ state: "visible" });
  const triggerBox = await trigger.boundingBox();
  assert.ok(triggerBox, "menu trigger must have a box");
  await page.mouse.move(triggerBox.x + triggerBox.width / 2, triggerBox.y + triggerBox.height / 2);
  await page.mouse.down();
  const pressedTransform = await trigger.evaluate((node) => getComputedStyle(node).transform);
  assert.notEqual(pressedTransform, "none", "pressed state must provide visible transform feedback");
  await page.mouse.up();

  const menu = page.locator('[data-app-menu-panel="true"]');
  await menu.waitFor({ state: "visible" });
  const menuStartBox = await menu.boundingBox();
  assert.ok(menuStartBox && menuStartBox.y <= 1, "top menu animation must enter from above the top edge");
  await page.waitForTimeout(260);
  const menuBox = await menu.boundingBox();
  assert.ok(menuBox && Math.abs(menuBox.y) <= 1, "expanded menu must settle at the top edge");
  assert.ok(menuBox && menuBox.y + menuBox.height <= afterViewportResize.viewport.height + 1, "expanded menu must fit the mobile viewport");
  const menuAppearance = await menu.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      color: style.color,
      backgroundImage: style.backgroundImage,
      animationName: style.animationName,
      borderBottomLeftRadius: style.borderBottomLeftRadius
    };
  });
  assert.equal(menuAppearance.color, "rgb(255, 255, 255)", "top menu text must be white");
  assert.match(menuAppearance.backgroundImage, /linear-gradient/, "top menu must use the brown gradient theme");
  assert.notEqual(menuAppearance.animationName, "none", "top menu must animate down from the top");
  assert.ok(Number.parseFloat(menuAppearance.borderBottomLeftRadius) >= 20, "top menu must use a soft rounded lower edge");

  const contrast = await verifyContrast(page);
  await page.screenshot({ path: `${resultsDir}/16-app-shell-mobile-acceptance.png`, fullPage: true });
  await context.close();
  return {
    bottomItems: bottomItemCount,
    bottomHeight: before.bottom.height,
    bottomAppearance: before.bottomAppearance,
    activeBottomAppearance: before.activeBottomAppearance,
    contrast,
    menuAppearance
  };
}

async function verifyDesktop(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${appBase}/routes`, { waitUntil: "networkidle" });

  await verifySingleTrigger(page);
  assert.equal(await page.locator('[data-bottom-navigation="true"]').isVisible(), false, "bottom navigation must be hidden on desktop");
  assert.equal(await page.locator(".sidebar").isVisible(), true, "sidebar must be visible on desktop");

  const before = await shellMetrics(page);
  assert.ok(before.sidebar && before.content && before.top && before.main, "desktop shell regions must exist");
  assert.ok(before.sidebar.right <= before.content.left + 1, "desktop sidebar must not overlap app content");
  assert.ok(before.top.left >= before.sidebar.right - 1, "desktop top bar must remain inside app content");
  assert.ok(before.top.bottom <= before.main.top + 1, "desktop top bar must remain inside app content");
  await page.evaluate(() => {
    const main = document.querySelector("[data-app-scroll-region]");
    const spacer = document.createElement("div");
    spacer.dataset.acceptanceSpacer = "desktop";
    spacer.style.height = "1800px";
    main?.append(spacer);
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await page.waitForTimeout(80);
  const after = await shellMetrics(page);
  assert.equal(Math.round(after.top.top), 0, "desktop top bar must remain sticky at viewport top");

  const contrast = await verifyContrast(page);
  await page.screenshot({ path: `${resultsDir}/17-app-shell-desktop-acceptance.png`, fullPage: false });
  await context.close();
  return { contrast };
}

await waitForHttp(`${appBase}/routes`);
const browser = await chromium.launch({ headless: true });
const result = { APP_SHELL_BROWSER_ACCEPTANCE: "FAIL" };

try {
  result.mobile = await verifyMobile(browser);
  result.desktop = await verifyDesktop(browser);
  result.singleMenuTrigger = "PASS";
  result.bottomNavigationLimit = "PASS";
  result.flatNativeBottomNavigation = "PASS";
  result.stableBottomNavigation = "PASS";
  result.noOverlap = "PASS";
  result.fixedTopBar = "PASS";
  result.topDownMenuTheme = "PASS";
  result.contrast = "PASS";
  result.pressedState = "PASS";
  result.APP_SHELL_BROWSER_ACCEPTANCE = "PASS";
} catch (error) {
  result.error = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ""}` : String(error);
  throw error;
} finally {
  await writeFile(`${resultsDir}/app-shell-browser-acceptance-result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}
