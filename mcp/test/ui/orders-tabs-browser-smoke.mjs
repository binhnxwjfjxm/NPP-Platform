import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const appBase = process.env.F05_UI_APP_BASE || "http://127.0.0.1:3000";
const resultsDir = process.env.F05_UI_RESULTS_DIR || "test-results/f05-ui-smoke";
const proxyHeaders = { "x-forwarded-proto": "https" };
const unauthenticatedHeaders = { ...proxyHeaders, "x-f05-auth-mode": "unauthenticated" };
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
    extraHTTPHeaders: unauthenticatedHeaders
  });
  const page = await context.newPage();
  await page.goto(`${appBase}/orders`, { waitUntil: "domcontentloaded" });

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

function closeEnough(left, right, tolerance = 1.25) {
  return Math.abs(left - right) <= tolerance;
}

async function railGeometry(rail) {
  const box = await rail.boundingBox();
  assert.ok(box, "orders tab rail must have geometry");
  return box;
}

async function headerGeometry(page) {
  const box = await page.locator(".page-header-copy").boundingBox();
  assert.ok(box, "orders header copy must have geometry");
  return box;
}

async function scrollMetrics(scrollRegion) {
  return scrollRegion.evaluate((node) => ({
    scrollTop: node.scrollTop,
    maxScrollTop: Math.max(0, node.scrollHeight - node.clientHeight)
  }));
}

async function pseudoTransform(rail) {
  return rail.evaluate((node) => getComputedStyle(node, "::before").transform);
}

async function verifyAuthenticatedOrdersMotion(browser, width, height) {
  const context = await browser.newContext({
    viewport: { width, height },
    extraHTTPHeaders: proxyHeaders
  });
  await context.addCookies([{ name: "hp_mcp_session", value: "ui-smoke-session", url: appBase }]);
  const page = await context.newPage();
  await page.goto(`${appBase}/orders`, { waitUntil: "domcontentloaded" });
  assert.equal(new URL(page.url()).pathname, "/orders", `${width}px: authenticated orders smoke must enter /orders`);

  const rail = page.getByRole("tablist", { name: "Phân tích và xử lý đơn hàng" });
  await rail.waitFor({ state: "visible" });
  const tabs = page.getByRole("tab");
  assert.equal(await tabs.count(), 4, `${width}px: orders rail must keep four tabs`);
  assert.deepEqual(
    await tabs.allTextContents().then((items) => items.map((item) => item.replace(/\s+/g, " ").trim()).map((item) => item.split(/Tìm,|Nháp,|Ngày,|4 chỉ/)[0].trim())),
    ["Đơn hàng", "Cần xử lý", "Doanh số đặt hàng", "Tổng quan"],
    `${width}px: orders tab order must stay stable`
  );

  const initialHeader = await headerGeometry(page);
  const actions = page.locator(".page-header-actions");
  assert.equal(Math.round((await actions.boundingBox())?.height || 0), 46, `${width}px: orders header action lane must be fixed at 46px`);
  assert.equal(await actions.locator(":scope > *").count(), 3, "orders view starts with source, export and create actions");

  const scrollRegion = page.locator("[data-app-scroll-region]");
  await scrollRegion.evaluate((node) => { node.scrollTop = Math.min(36, Math.max(0, node.scrollHeight - node.clientHeight)); });
  const stableScrollTop = await scrollRegion.evaluate((node) => node.scrollTop);
  let expectedScrollTop = stableScrollTop;
  const stableRail = await railGeometry(rail);
  const stableRailContentY = stableRail.y + stableScrollTop;
  const viewScrollTops = new Map([["default", stableScrollTop]]);
  const transforms = [await pseudoTransform(rail)];

  const sequence = [
    { label: "Cần xử lý", view: "attention", actions: 0 },
    { label: "Doanh số đặt hàng", view: "sales", actions: 2 },
    { label: "Tổng quan", view: "overview", actions: 0 },
    { label: "Đơn hàng", view: null, actions: 3 }
  ];

  for (const step of sequence) {
    await page.getByRole("tab", { name: new RegExp(`^${step.label}`) }).click();
    await page.waitForFunction(
      ({ expected }) => new URL(window.location.href).searchParams.get("view") === expected,
      { expected: step.view }
    );
    await page.waitForTimeout(190);

    const currentRail = await railGeometry(rail);
    const currentHeader = await headerGeometry(page);
    const currentScroll = await scrollMetrics(scrollRegion);
    const clampedExpectedScrollTop = Math.min(expectedScrollTop, currentScroll.maxScrollTop);
    assert.ok(closeEnough(currentRail.x, stableRail.x), `${step.label}: rail x must stay fixed`);
    assert.ok(closeEnough(currentRail.y + currentScroll.scrollTop, stableRailContentY), `${step.label}: rail content position must stay fixed`);
    assert.ok(closeEnough(currentRail.width, stableRail.width), `${step.label}: rail width must stay fixed`);
    assert.ok(closeEnough(currentRail.height, stableRail.height), `${step.label}: rail height must stay fixed`);
    assert.ok(closeEnough(currentHeader.height, initialHeader.height), `${step.label}: page header height must stay fixed`);
    assert.equal(await actions.locator(":scope > *").count(), step.actions, `${step.label}: action count should change without changing header geometry`);
    assert.ok(closeEnough(currentScroll.scrollTop, clampedExpectedScrollTop, 1), `${step.label}: tab navigation must preserve scroll unless shorter content clamps it`);
    expectedScrollTop = currentScroll.scrollTop;
    viewScrollTops.set(step.view || "default", currentScroll.scrollTop);

    const panel = page.getByRole("tabpanel");
    await panel.waitFor({ state: "visible" });
    assert.equal(await panel.evaluate((node) => getComputedStyle(node).animationDuration), "0.145s", `${step.label}: panel uses the lightweight 145ms transition`);
    transforms.push(await pseudoTransform(rail));
  }

  assert.equal(new Set(transforms).size, 4, "orders active pill must settle at four distinct horizontal positions");

  await page.goBack();
  await page.waitForFunction(() => new URL(window.location.href).searchParams.get("view") === "overview");
  assert.equal(await page.getByRole("tab", { name: /^Tổng quan/ }).getAttribute("aria-selected"), "true", "browser back restores overview tab");
  assert.ok(closeEnough(await scrollRegion.evaluate((node) => node.scrollTop), viewScrollTops.get("overview") || 0, 1), "browser back restores the overview scroll position");

  await page.goForward();
  await page.waitForFunction(() => new URL(window.location.href).searchParams.get("view") === null);
  assert.equal(await page.getByRole("tab", { name: /^Đơn hàng/ }).getAttribute("aria-selected"), "true", "browser forward restores orders tab");
  assert.ok(closeEnough(await scrollRegion.evaluate((node) => node.scrollTop), viewScrollTops.get("default") || 0, 1), "browser forward restores the orders scroll position");

  await page.goto(`${appBase}/orders?view=sales`, { waitUntil: "domcontentloaded" });
  assert.equal(await page.getByRole("tab", { name: /^Doanh số đặt hàng/ }).getAttribute("aria-selected"), "true", "deep link must select sales view");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("tab", { name: /^Tổng quan/ }).click();
  await page.waitForFunction(() => new URL(window.location.href).searchParams.get("view") === "overview");
  const reducedTransition = await rail.evaluate((node) => getComputedStyle(node, "::before").transitionDuration);
  assert.ok(reducedTransition.split(",").every((value) => value.trim() === "0s"), `reduced motion must disable orders pill transition; got ${reducedTransition}`);
  assert.equal(await page.getByRole("tabpanel").evaluate((node) => getComputedStyle(node).animationName), "none", "reduced motion must disable panel entrance animation");

  const geometry = await verifyNoBodyOverflow(page, `authenticated orders ${width}px`);
  if (width === 390) {
    await page.screenshot({ path: `${resultsDir}/orders-tabs-motion-mobile.png`, fullPage: true });
  }
  await context.close();
  return {
    width,
    rail: stableRail,
    header: initialHeader,
    scrollTop: stableScrollTop,
    transforms,
    deepLink: "sales",
    backForward: "PASS",
    reducedMotion: "PASS",
    geometry
  };
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
  result.motion = [];
  for (const viewport of [
    { width: 360, height: 800 },
    { width: 390, height: 844 }
  ]) {
    result.motion.push(await verifyAuthenticatedOrdersMotion(browser, viewport.width, viewport.height));
  }
  result.ordersAuthGate = "PASS";
  result.ordersReturnTo = "/orders";
  result.legacyOrderIntentTabsAbsent = "PASS";
  result.fourTabMotion = "PASS";
  result.railGeometryStable = "PASS";
  result.scrollPreserved = "PASS";
  result.backForward = "PASS";
  result.deepLink = "PASS";
  result.reducedMotion = "PASS";
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
