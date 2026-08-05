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
      const response = await fetch(url, { cache: "no-store", redirect: "follow" });
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
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

async function screenshot(page, name) {
  await page.screenshot({ path: `${resultsDir}/${name}.png`, fullPage: true });
}

async function assertShell(page, routeName, mobile) {
  await page.locator(".app-shell").waitFor({ state: "visible" });
  assert.equal(
    await page.getByText("404: This page could not be found.", { exact: true }).count(),
    0,
    `${routeName} must not render 404`,
  );
  assert.ok(await horizontalOverflow(page) <= 1, `${routeName} must not overflow horizontally`);
  if (mobile) {
    await page.locator("[data-bottom-navigation]").waitFor({ state: "visible" });
  }
}

function mockOrderIntent(page) {
  return Promise.all([
    page.route("**/api/backend/mcp-day/session-customer/customer-onboarding?*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          data: {
            orderId: "order-lot-4",
            orderCode: "INT-LOT-4",
            coreRequestId: "request-lot-4",
            status: "under_review",
            officialOrderAllowed: false,
          },
        }),
      });
    }),
    page.route("**/api/backend/mcp-day/session-customer/sales-order?*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify({
          data: {
            orderId: "order-lot-4",
            coreSalesOrderId: null,
            status: null,
            currency: "VND",
          },
        }),
      });
    }),
  ]);
}

const groupFixture = [
  {
    id: "group-active",
    key: "product",
    title: "Sản phẩm đang dùng",
    description: "Nhóm dùng khi ghi nhận sản phẩm tại điểm bán",
    status: "active",
    sortOrder: 1,
    items: [{ id: "item-1" }, { id: "item-2" }],
  },
  {
    id: "group-inactive",
    key: "need",
    title: "Nhu cầu",
    description: "Nhóm tạm dừng",
    status: "inactive",
    sortOrder: 2,
    items: [],
  },
];

async function mockGroups(page, mutationLog) {
  await page.route("**/api/mcp-report-settings?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({ data: { groups: groupFixture } }),
    });
  });
  await page.route("**/api/mcp-report-setting-groups", async (route) => {
    mutationLog.push({
      method: route.request().method(),
      idempotencyKey: route.request().headers()["idempotency-key"] || "",
      body: route.request().postDataJSON(),
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({ data: { ok: true } }),
    });
  });
}

await waitForHttp(`${appBase}/`);
await waitForHttp(`${appBase}/mcp-setting/groups`);

const browser = await chromium.launch({ headless: true });
const result = { MCP_UI_LOT_4_SMOKE: "FAIL" };
const mobileViewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];

try {
  for (const viewport of mobileViewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();

    const routes = [
      ["home", "/"],
      ["customers", "/customers"],
      ["plans", "/plans"],
      ["sessions", "/mcp/sessions?dateFrom=2099-12-01&dateTo=2099-12-31"],
    ];

    for (const [name, path] of routes) {
      await page.goto(`${appBase}${path}`, { waitUntil: "networkidle" });
      await assertShell(page, `${name} at ${viewport.width}px`, true);
    }

    await mockOrderIntent(page);
    await page.goto(
      `${appBase}/visits/order-intent?sessionCustomerId=sc-existing&orderId=order-lot-4&customerName=UI%20Lot%204`,
      { waitUntil: "networkidle" },
    );
    await assertShell(page, `order intent at ${viewport.width}px`, true);
    assert.equal(await page.locator("[data-order-step]").count(), 4);
    assert.equal(await page.locator("[data-order-primary-action]").count(), 1);

    const mutationLog = [];
    await mockGroups(page, mutationLog);
    await page.goto(`${appBase}/mcp-setting/groups`, { waitUntil: "networkidle" });
    await assertShell(page, `report groups at ${viewport.width}px`, true);

    const mobileList = page.locator("section[aria-label='Danh sách nhóm lựa chọn']");
    await mobileList.waitFor({ state: "visible" });
    await mobileList
      .getByText("Sản phẩm đang dùng", { exact: true })
      .waitFor({ state: "visible" });
    assert.equal(
      await page.locator("section[aria-label='Bảng nhóm lựa chọn']").evaluate(
        (node) => getComputedStyle(node).display,
      ),
      "none",
    );

    const addButton = page.getByRole("button", { name: "Thêm nhóm", exact: true }).first();
    assert.ok(
      (await addButton.evaluate((node) => node.getBoundingClientRect().height)) >= 44,
      "add group action must be touchable",
    );
    await addButton.click();
    const dialog = page.getByRole("dialog", { name: "Thêm nhóm" });
    await dialog.waitFor({ state: "visible" });
    assert.equal(await dialog.getAttribute("aria-modal"), "true");

    const closeButton = dialog.getByRole("button", { name: "Đóng biểu mẫu nhóm" });
    const cancelButton = dialog.getByRole("button", { name: "Hủy" });
    await closeButton.focus();
    await page.keyboard.press("Shift+Tab");
    assert.equal(
      await cancelButton.evaluate((node) => document.activeElement === node),
      true,
      "Shift+Tab from first control must wrap to last control",
    );
    await page.keyboard.press("Tab");
    assert.equal(
      await closeButton.evaluate((node) => document.activeElement === node),
      true,
      "Tab from last control must wrap to first control",
    );

    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });

    const editButton = page.getByRole("button", { name: "Sửa nhóm Sản phẩm đang dùng" }).first();
    assert.ok(
      (await editButton.evaluate((node) => node.getBoundingClientRect().height)) >= 44,
      "edit group action must be touchable",
    );
    await editButton.click();
    const editDialog = page.getByRole("dialog", { name: "Sửa nhóm" });
    await editDialog.waitFor({ state: "visible" });
    assert.equal(
      await editDialog.getByLabel("Tên nhóm").inputValue(),
      "Sản phẩm đang dùng",
    );
    await editDialog.getByLabel("Tên nhóm").fill("Sản phẩm đang dùng mới");
    await editDialog.getByRole("button", { name: "Lưu thay đổi" }).click();
    await editDialog.waitFor({ state: "hidden" });
    assert.equal(mutationLog.length, 1);
    assert.equal(mutationLog[0].method, "PATCH");
    assert.ok(mutationLog[0].idempotencyKey, "group mutation must keep idempotency key");

    await screenshot(page, `24-groups-mobile-${viewport.width}`);
    await context.close();
  }

  const desktopContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const desktopPage = await desktopContext.newPage();
  const desktopMutationLog = [];
  await mockGroups(desktopPage, desktopMutationLog);
  await desktopPage.goto(`${appBase}/mcp-setting/groups`, { waitUntil: "networkidle" });
  await assertShell(desktopPage, "report groups desktop", false);
  assert.equal(
    await desktopPage.locator("section[aria-label='Danh sách nhóm lựa chọn']").evaluate(
      (node) => getComputedStyle(node).display,
    ),
    "none",
  );
  const desktopTable = desktopPage.locator("section[aria-label='Bảng nhóm lựa chọn']");
  await desktopTable.waitFor({ state: "visible" });
  await desktopTable
    .getByText("Sản phẩm đang dùng", { exact: true })
    .waitFor({ state: "visible" });
  assert.equal(await desktopTable.locator("table tbody tr").count(), 2);
  await screenshot(desktopPage, "25-groups-desktop");

  await desktopPage.goto(`${appBase}/actions`, { waitUntil: "networkidle" });
  assert.equal(new URL(desktopPage.url()).pathname, "/plans");
  await desktopPage.goto(`${appBase}/mcp/settings`, { waitUntil: "networkidle" });
  assert.equal(new URL(desktopPage.url()).pathname, "/mcp-setting");
  await desktopContext.close();

  result.MCP_UI_LOT_4_SMOKE = "PASS";
  result.mobileViewports = mobileViewports.map(({ width, height }) => `${width}x${height}`);
  result.sixScreenNoOverflow = "PASS";
  result.groupSheetAccessibility = "PASS";
  result.groupFocusTrap = "PASS";
  result.groupMutationIdempotency = "PASS";
  result.desktopGroupTable = "PASS";
  result.redirects = "PASS";
} catch (error) {
  result.error =
    error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ""}` : String(error);
  throw error;
} finally {
  await writeFile(`${resultsDir}/lot-4-result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}
