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

function pathname(value) {
  return new URL(value, appBase).pathname;
}

async function readDock(page) {
  const dock = page.locator('[data-bottom-navigation="true"]');
  await dock.waitFor({ state: "visible" });
  const links = dock.locator("a");
  const values = [];
  for (let index = 0; index < await links.count(); index += 1) {
    values.push({
      label: (await links.nth(index).innerText()).trim(),
      href: pathname(await links.nth(index).getAttribute("href")),
      documentNavigation: await links.nth(index).getAttribute("data-document-navigation")
    });
  }
  return { dock, links, values };
}

await waitForHttp(`${appBase}/routes`);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const result = { MOBILE_DOCK_NAVIGATION: "FAIL" };

try {
  await page.goto(`${appBase}/routes`, { waitUntil: "networkidle" });
  const routeDock = await readDock(page);
  assert.equal(routeDock.values.length, 5, "mobile dock must keep five top-level destinations");
  assert.deepEqual(
    routeDock.values.map((item) => item.label),
    ["Tổng", "Đi tuyến", "Khách", "Đơn", "Báo cáo"],
    "mobile dock must use the agreed daily-work order"
  );
  assert.deepEqual(
    routeDock.values.map((item) => item.href),
    ["/", "/visits", "/customers", "/orders", "/reports"],
    "mobile dock destinations must match the agreed routes"
  );
  assert.equal(routeDock.values.some((item) => item.href === "/routes"), false, "route management must leave the mobile dock");
  for (const item of routeDock.values) {
    assert.equal(item.documentNavigation, "true", "every dock destination must remain a document-level escape");
  }

  const customerRequestPromise = page.waitForRequest((request) => {
    return request.isNavigationRequest() && pathname(request.url()) === "/customers";
  });
  await routeDock.dock.getByRole("link", { name: "Khách", exact: true }).click();
  const customerRequest = await customerRequestPromise;
  assert.equal(customerRequest.resourceType(), "document", "Khách must open with document navigation");
  await page.waitForURL((url) => url.pathname === "/login");
  await page.getByRole("heading", { name: "Đăng nhập nhân viên", exact: true }).waitFor({ state: "visible" });
  assert.equal(new URL(page.url()).searchParams.get("returnTo"), null, "default customer entry must use the safe /customers return target");

  await page.goto(`${appBase}/routes`, { waitUntil: "networkidle" });
  const dock = (await readDock(page)).dock;
  const visitLink = dock.getByRole("link", { name: "Đi tuyến", exact: true });
  const visitResponsePromise = page.waitForResponse((response) => {
    return response.request().isNavigationRequest() && pathname(response.url()) === "/visits";
  });
  await visitLink.click();
  const visitResponse = await visitResponsePromise;
  assert.equal(
    visitResponse.status(),
    307,
    `/visits entry must redirect before streaming a shell; status=${visitResponse.status()}`
  );
  await page.waitForURL((url) => url.pathname === "/routes");
  assert.equal(pathname(page.url()), "/routes", "no active session must land on route preparation");

  await page.goto(`${appBase}/visits?routeId=route-active&date=2099-12-30`, { waitUntil: "networkidle" });
  assert.equal(pathname(page.url()), "/visits", "active visit setup must remain on /visits");
  const sessionDock = (await readDock(page)).dock;
  const ordersLink = sessionDock.getByRole("link", { name: "Đơn", exact: true });
  const ordersRequestPromise = page.waitForRequest((request) => {
    return request.isNavigationRequest() && pathname(request.url()) === "/orders";
  });
  await ordersLink.click();
  const ordersRequest = await ordersRequestPromise;
  assert.equal(ordersRequest.resourceType(), "document", "leaving a visit must use a fresh document navigation");
  await page.waitForURL((url) => url.pathname === "/orders");

  await page.screenshot({ path: `${resultsDir}/mobile-dock-navigation-final.png`, fullPage: true });
  result.dockLabels = routeDock.values.map((item) => item.label);
  result.customerDestination = "/login";
  result.customerAuthGate = "PASS";
  result.entryRedirectStatus = visitResponse.status();
  result.noActiveDestination = "/routes";
  result.visitEscapeDestination = "/orders";
  result.documentNavigation = "PASS";
  result.MOBILE_DOCK_NAVIGATION = "PASS";
} catch (error) {
  result.error = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ""}` : String(error);
  throw error;
} finally {
  await writeFile(`${resultsDir}/mobile-dock-navigation-result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await context.close();
  await browser.close();
}
