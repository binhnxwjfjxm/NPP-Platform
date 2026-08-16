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

async function horizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

await waitForHttp(`${appBase}/mcp`);
const browser = await chromium.launch({ headless: true });
const result = { F05_MCP_HOME_MOBILE_SMOKE: "FAIL" };

try {
  const mobileViewports = [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 430, height: 932 }
  ];

  for (const viewport of mobileViewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.goto(`${appBase}/mcp`, { waitUntil: "domcontentloaded" });

    const mobileFlow = page.locator('[data-mcp-mobile-flow="true"]');
    const desktopFlow = page.locator('[data-mcp-desktop-flow="true"]');
    await mobileFlow.waitFor({ state: "visible" });
    await desktopFlow.waitFor({ state: "hidden" });
    assert.equal(await desktopFlow.isVisible(), false, "desktop MCP flow must stay hidden at mobile breakpoints");
    assert.equal(await page.locator(".page-header:visible").count(), 0, "mobile MCP must not repeat the page header below the app bar");

    const primaryAction = mobileFlow.locator('[data-mcp-primary-action="true"]');
    await primaryAction.waitFor({ state: "visible" });
    assert.equal(await primaryAction.getAttribute("href"), "/visits", "primary MCP action must open today's visit flow");
    const primaryHeight = await primaryAction.evaluate((node) => node.getBoundingClientRect().height);
    assert.ok(primaryHeight >= 96, `primary action must stay prominent at ${viewport.width}px`);

    const stats = mobileFlow.locator('[data-mcp-mobile-stats="true"] > div');
    assert.equal(await stats.count(), 3, "mobile MCP must show one compact three-value status strip");

    const actions = mobileFlow.locator('[data-mcp-mobile-action="true"]');
    assert.equal(await actions.count(), 3, "mobile MCP must use three secondary rows instead of four square cards");
    const actionCount = await actions.count();
    for (let index = 0; index < actionCount; index += 1) {
      const dimensions = await actions.nth(index).evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      assert.ok(dimensions.width / dimensions.height > 3, `mobile action ${index + 1} must be a wide row, not a square card`);
      assert.ok(dimensions.height >= 44, `mobile action ${index + 1} must remain touch friendly`);
    }

    const overflow = await horizontalOverflow(page);
    assert.ok(overflow <= 1, `MCP mobile must not overflow at ${viewport.width}px; overflow=${overflow}`);
    await page.screenshot({ path: `${resultsDir}/20-mcp-mobile-${viewport.width}.png`, fullPage: true });
    await context.close();
  }

  const desktopContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const desktopPage = await desktopContext.newPage();
  await desktopPage.goto(`${appBase}/mcp`, { waitUntil: "domcontentloaded" });
  const mobileFlow = desktopPage.locator('[data-mcp-mobile-flow="true"]');
  const desktopFlow = desktopPage.locator('[data-mcp-desktop-flow="true"]');
  await mobileFlow.waitFor({ state: "hidden" });
  await desktopFlow.waitFor({ state: "visible" });
  assert.equal(await mobileFlow.isVisible(), false, "mobile MCP flow must stay hidden at desktop breakpoints");
  const desktopModules = desktopFlow.locator('section[aria-label="Chức năng MCP"] a');
  assert.equal(await desktopModules.count(), 4);
  assert.equal(await desktopModules.filter({ hasText: "Đi tuyến hôm nay" }).getAttribute("href"), "/visits");
  const desktopOverflow = await horizontalOverflow(desktopPage);
  assert.ok(desktopOverflow <= 1, `MCP desktop must not overflow; overflow=${desktopOverflow}`);
  await desktopPage.screenshot({ path: `${resultsDir}/21-mcp-desktop.png`, fullPage: true });
  await desktopContext.close();

  result.F05_MCP_HOME_MOBILE_SMOKE = "PASS";
  result.mobileViewports = mobileViewports.map(({ width, height }) => `${width}x${height}`);
  result.primaryAction = "/visits";
  result.secondaryActionRows = 3;
  result.desktopModules = 4;
} catch (error) {
  result.error = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ""}` : String(error);
  throw error;
} finally {
  await writeFile(`${resultsDir}/mcp-home-mobile-result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}
