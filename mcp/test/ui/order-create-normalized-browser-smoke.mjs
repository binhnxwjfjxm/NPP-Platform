import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const appBase = process.env.ORDER_CREATE_APP_BASE || "http://127.0.0.1:3001";
const mockBase = process.env.ORDER_CREATE_MOCK_BASE || "http://127.0.0.1:3110";
const resultsDir = process.env.ORDER_CREATE_RESULTS_DIR || "test-results/order-create-smoke";

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

async function resetMock() {
  const response = await fetch(`${mockBase}/__reset`, { method: "POST" });
  assert.equal(response.status, 200, "mock reset must succeed");
}

async function mockState() {
  const response = await fetch(`${mockBase}/__state`, { cache: "no-store" });
  assert.equal(response.status, 200, "mock state must be readable");
  return response.json();
}

function orderRequests(state) {
  return state.requests.filter((request) => request.method === "POST" && request.path === "/api/orders");
}

async function installOrderDetailMock(page) {
  await page.route("**/api/backend/orders/*", async (route) => {
    const orderId = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop() || "order-base-001");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          id: orderId,
          code: "DH-UI-BASE-001",
          date: "2099-12-30",
          accountName: "UI Existing Customer",
          customerPhone: "0900000001",
          routeName: "Tuyến phiên đang chạy",
          area: "Bình Đại",
          deliveryAddress: "12 Đường Browser Smoke",
          owner: "Sale A",
          source: "orders_tab",
          status: "confirmed",
          subtotal: 500000,
          discountTotal: 0,
          totalAmount: 500000,
          note: "Giao buổi sáng",
          skuCount: 3,
          quantity: 10,
          items: [
            { id: "item-1", productId: "product-syrup", variantId: "variant-strawberry", productName: "Siro Hưng Phát", sku: "HP-SIRO-DAU-750", unit: "chai", quantity: 4, unitPrice: 50000, discount: 0, lineTotal: 200000, note: "Dâu · 750ml" },
            { id: "item-2", productId: "product-syrup", variantId: "variant-peach", productName: "Siro Hưng Phát", sku: "HP-SIRO-DAO-750", unit: "chai", quantity: 3, unitPrice: 60000, discount: 0, lineTotal: 180000, note: "Đào · 750ml" },
            { id: "item-3", productId: "product-tea", variantId: "variant-tea-jasmine", productName: "Trà Lài Hưng Phát", sku: "HP-TRA-LAI-500", unit: "gói", quantity: 3, unitPrice: 40000, discount: 0, lineTotal: 120000, note: "Lài · 500g" }
          ]
        },
        requestId: "order-detail-browser-smoke",
        receivedAt: new Date().toISOString()
      })
    });
  });
}

async function openOrderSheet(page) {
  await page.goto(`${appBase}/orders`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "+ Tạo đơn", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Tạo đơn hàng", exact: true });
  await dialog.waitFor({ state: "visible" });
  return dialog;
}

async function orderControlCenterFlow(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await context.newPage();
  await installOrderDetailMock(page);
  await page.goto(`${appBase}/orders`, { waitUntil: "networkidle" });

  await page.getByRole("heading", { name: "Trung tâm đơn hàng", exact: true }).waitFor({ state: "visible" });
  await page.getByText("Đang đo doanh số đặt hàng", { exact: true }).waitFor({ state: "visible" });
  await page.getByText("Doanh số theo khách", { exact: true }).waitFor({ state: "visible" });
  await page.getByText("Cần chủ doanh nghiệp chú ý", { exact: true }).waitFor({ state: "visible" });
  await page.getByText(/7\/7 đơn/).waitFor({ state: "visible" });

  const routeSelect = page.locator("label").filter({ hasText: /^Tuyến/ }).locator("select");
  await routeSelect.selectOption({ label: "Tuyến phiên đang chạy" });
  await page.getByText(/4\/7 đơn/).waitFor({ state: "visible" });
  assert.equal(await page.getByText("UI Other Route Customer", { exact: true }).count(), 0, "route drill-down must exclude other routes");

  const customerPanel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Doanh số theo khách", exact: true }) });
  await customerPanel.getByRole("button", { name: /UI Existing Customer/ }).click();
  await page.getByRole("button", { name: "Khách: UI Existing Customer ×", exact: true }).waitFor({ state: "visible" });
  assert.equal(await page.getByText("UI Second Customer", { exact: true }).count(), 0, "customer drill-down must own the order result list");

  const scrollRegion = page.locator("[data-app-scroll-region='true']");
  const firstOrderCard = page.locator("#orders-result-list article").first();
  await firstOrderCard.scrollIntoViewIfNeeded();
  const scrollBeforeDetail = await scrollRegion.evaluate((element) => element.scrollTop);
  await firstOrderCard.getByRole("button", { name: "Xem", exact: true }).click();
  const mobileDrawer = page.locator("[data-order-detail-surface='drawer']");
  await mobileDrawer.waitFor({ state: "visible" });
  assert.match(page.url(), /[?&]detail=/, "opening detail must own a shareable URL");
  await mobileDrawer.getByRole("heading", { name: "Sản phẩm", exact: true }).waitFor({ state: "visible" });
  await mobileDrawer.getByText("Siro Hưng Phát", { exact: true }).first().waitFor({ state: "visible" });
  await mobileDrawer.getByText("Khách hàng và giao hàng", { exact: true }).waitFor({ state: "visible" });
  await mobileDrawer.getByText("12 Đường Browser Smoke", { exact: true }).waitFor({ state: "visible" });
  assert.equal(await mobileDrawer.getByText(/API|Snapshot|ID hệ thống/).count(), 0, "detail copy must stay business-facing");
  const mobileBox = await mobileDrawer.boundingBox();
  assert.ok(mobileBox && mobileBox.width >= 389 && mobileBox.height >= 843, "mobile order detail must be fullscreen");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Đóng chi tiết đơn", "detail must move focus into the dialog");

  await page.goBack();
  await mobileDrawer.waitFor({ state: "hidden" });
  assert.doesNotMatch(page.url(), /[?&]detail=/, "browser Back must close detail without leaving orders");
  await page.getByRole("button", { name: "Khách: UI Existing Customer ×", exact: true }).waitFor({ state: "visible" });
  const scrollAfterDetail = await scrollRegion.evaluate((element) => element.scrollTop);
  assert.ok(Math.abs(scrollAfterDetail - scrollBeforeDetail) <= 2, "closing detail must restore the list scroll position");
  assert.equal(await firstOrderCard.getByRole("button", { name: "Xem", exact: true }).evaluate((element) => element === document.activeElement), true, "closing detail must restore focus to the triggering action");

  await page.getByRole("button", { name: /Xóa 2 bộ lọc/ }).click();
  await page.getByText(/7\/7 đơn/).waitFor({ state: "visible" });

  const attentionSelect = page.locator("label").filter({ hasText: /^Cần chú ý/ }).locator("select");
  await attentionSelect.selectOption("possible_duplicate");
  await page.getByText(/2\/7 đơn/).waitFor({ state: "visible" });
  await page.locator("#orders-result-list").getByText("Nghi trùng", { exact: true }).first().waitFor({ state: "visible" });

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Xuất theo bộ lọc", exact: true }).click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /^don-hang-theo-bo-loc-\d{4}-\d{2}-\d{2}\.csv$/);

  await page.screenshot({ path: `${resultsDir}/00-orders-control-center.png`, fullPage: true });
  await context.close();
  return "PASS";
}

async function desktopOrderDetailFlow(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await installOrderDetailMock(page);
  await page.goto(`${appBase}/orders`, { waitUntil: "networkidle" });
  const firstOrderCard = page.locator("#orders-result-list article").first();
  await firstOrderCard.scrollIntoViewIfNeeded();
  await firstOrderCard.getByRole("button", { name: "Xem", exact: true }).click();

  const drawer = page.locator("[data-order-detail-surface='drawer']");
  await drawer.waitFor({ state: "visible" });
  await drawer.getByText("Trà Lài Hưng Phát", { exact: true }).waitFor({ state: "visible" });
  const box = await drawer.boundingBox();
  const layoutWidth = await page.evaluate(() => document.documentElement.clientWidth);
  assert.ok(box, "desktop order detail drawer must have a bounding box");
  assert.ok(box.width >= 600 && box.width <= 700, "desktop detail must use a bounded right drawer");
  assert.ok(Math.abs((box.x + box.width) - layoutWidth) <= 1, "desktop drawer must attach to the layout viewport right edge");
  assert.ok(box.height >= 799, "desktop drawer must own the viewport height");

  await page.keyboard.press("Escape");
  await drawer.waitFor({ state: "hidden" });
  assert.doesNotMatch(page.url(), /[?&]detail=/, "Escape must close routed detail");
  await page.screenshot({ path: `${resultsDir}/00b-order-detail-desktop.png`, fullPage: true });
  await context.close();
  return "PASS";
}

function boxesOverlap(first, second) {
  return first.x < second.x + second.width && first.x + first.width > second.x && first.y < second.y + second.height && first.y + first.height > second.y;
}

async function shortOrderWorkspaceLayoutFlow(browser, viewport = { width: 496, height: 309 }) {
  await resetMock();
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const dialog = await openOrderSheet(page);
  const sessionSelect = dialog.locator("label").filter({ hasText: "Phiên / tuyến" }).locator("select");
  await sessionSelect.waitFor({ state: "visible" });

  const customerList = dialog.locator("[data-order-customer-list]");
  const customers = customerList.getByRole("radio");
  await customers.nth(1).waitFor({ state: "visible" });
  const listStyle = await customerList.evaluate((element) => {
    const style = getComputedStyle(element);
    return { overflowY: style.overflowY, height: element.clientHeight, scrollHeight: element.scrollHeight };
  });
  assert.match(listStyle.overflowY, /auto|scroll/, "short customer list must own vertical scrolling");
  assert.ok(listStyle.height > 0, "short customer list must retain usable height");

  const pageViewport = page.viewportSize();
  const listBox = await customerList.boundingBox();
  assert.ok(listBox, "short customer list must have a bounding box");
  const fullyVisibleRows = [];
  for (let index = 0; index < await customers.count(); index += 1) {
    const box = await customers.nth(index).boundingBox();
    if (box && pageViewport && box.y >= listBox.y && box.y + box.height <= listBox.y + listBox.height && box.y + box.height <= pageViewport.height) fullyVisibleRows.push(box);
  }
  assert.ok(fullyVisibleRows.length >= 2, "496x309 must show at least two complete customer rows");

  const firstCustomer = customers.first();
  await firstCustomer.click();
  assert.equal(await firstCustomer.getAttribute("aria-checked"), "true", "short layout must retain selected customer state");
  const continueButton = dialog.getByRole("button", { name: "Tiếp tục với UI Existing Customer", exact: true });
  await continueButton.waitFor({ state: "visible" });
  const footer = dialog.locator("[data-order-customer-footer]");
  const footerStyle = await footer.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, opacity: style.opacity, position: style.position };
  });
  assert.notEqual(footerStyle.background, "rgba(0, 0, 0, 0)", "customer CTA footer must be opaque");
  assert.equal(footerStyle.opacity, "1", "customer CTA footer must not create a translucent overlay");
  const footerBox = await footer.boundingBox();
  assert.ok(footerBox, "customer CTA footer must have a bounding box");
  for (const rowBox of fullyVisibleRows) assert.equal(boxesOverlap(footerBox, rowBox), false, "customer CTA footer must not overlap a customer row");
  for (const rowBox of fullyVisibleRows.slice(0, 2)) {
    const rowOwnsPaintPoint = await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest("[role='radio']")), {
      x: rowBox.x + rowBox.width / 2,
      y: rowBox.y + rowBox.height / 2
    });
    assert.equal(rowOwnsPaintPoint, true, "no overlay may intercept the visible customer row paint area");
  }

  await continueButton.click();
  const productList = dialog.locator("[data-order-product-list]");
  await productList.waitFor({ state: "visible" });
  const productCards = productList.locator("article");
  await productCards.first().waitFor({ state: "visible" });
  const productBox = await productList.boundingBox();
  assert.ok(productBox && productBox.height >= 70, "short product list must retain usable viewport height");
  const sheetFooterBox = await dialog.locator(".sheet-footer").boundingBox();
  const visibleProductBoxes = [];
  for (let index = 0; index < await productCards.count(); index += 1) {
    const box = await productCards.nth(index).boundingBox();
    if (!box) continue;
    const visibleTop = Math.max(box.y, productBox.y);
    const visibleBottom = Math.min(box.y + box.height, productBox.y + productBox.height);
    if (visibleBottom > visibleTop) visibleProductBoxes.push({ ...box, y: visibleTop, height: visibleBottom - visibleTop });
  }
  const lastProductBox = visibleProductBoxes.at(-1);
  assert.ok(lastProductBox && sheetFooterBox, "visible product and sheet footer must be measurable");
  assert.equal(boxesOverlap(lastProductBox, sheetFooterBox), false, "sheet footer must not cover the last visible product row");

  await page.screenshot({ path: `${resultsDir}/00c-order-create-${viewport.width}x${viewport.height}.png`, fullPage: true });
  await context.close();
  return "PASS";
}

async function existingSessionCustomerFlow(browser) {
  await resetMock();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const dialog = await openOrderSheet(page);

  const sessionSelect = dialog.locator("label").filter({ hasText: "Phiên / tuyến" }).locator("select");
  await sessionSelect.waitFor({ state: "visible" });
  assert.equal(await sessionSelect.inputValue(), "session-active", "active session must be selected first");
  await dialog.getByText("Tuyến phiên đang chạy", { exact: true }).first().waitFor({ state: "visible" });

  const firstCustomer = dialog.getByRole("radio", { name: /UI Existing Customer/ });
  const secondCustomer = dialog.getByRole("radio", { name: /UI Second Customer/ });
  await firstCustomer.waitFor({ state: "visible" });
  await secondCustomer.waitFor({ state: "visible" });
  assert.equal(await dialog.getByText("UI Other Route Customer", { exact: true }).count(), 0, "customers from another session route must be excluded");

  await firstCustomer.click();
  assert.equal(await firstCustomer.getAttribute("aria-checked"), "true", "selected customer must own the single radio state");
  assert.equal(await secondCustomer.getAttribute("aria-checked"), "false", "second customer must remain unselected");
  await dialog.getByRole("button", { name: "Tiếp tục với UI Existing Customer", exact: true }).click();

  await dialog.getByText("Siro Hưng Phát", { exact: true }).waitFor({ state: "visible" });
  const syrupCard = dialog.locator("article").filter({ hasText: "Siro Hưng Phát" });
  assert.equal(await syrupCard.count(), 1, "one product must render as one card even with multiple variants");
  const strawberry = syrupCard.getByRole("button", { name: /Thêm Siro Hưng Phát, Dâu/ });
  const peach = syrupCard.getByRole("button", { name: /Thêm Siro Hưng Phát, Đào/ });
  await strawberry.waitFor({ state: "visible" });
  await peach.waitFor({ state: "visible" });
  assert.equal(await strawberry.count(), 1, "strawberry variant must live inside the product card");
  assert.equal(await peach.count(), 1, "peach variant must live inside the same product card");

  await strawberry.click();
  await syrupCard.getByText("1 trong đơn", { exact: true }).waitFor({ state: "visible" });
  assert.equal(orderRequests(await mockState()).length, 0, "variant selection must not submit an order");

  await dialog.getByRole("button", { name: "Xem lại đơn", exact: true }).click();
  await dialog.getByText("Đơn đang lên", { exact: true }).waitFor({ state: "visible" });
  assert.equal(orderRequests(await mockState()).length, 0, "first primary action must only open cart review");

  const orderResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "POST" && url.pathname === "/api/backend/orders";
  });
  await dialog.getByRole("button", { name: "Tạo đơn", exact: true }).click();
  const orderResponse = await orderResponsePromise;
  assert.equal(orderResponse.status(), 201, "existing-customer order must be created");
  await dialog.waitFor({ state: "hidden" });
  await page.getByText("Đã tạo DH-UI-0001.", { exact: true }).waitFor({ state: "visible" });

  const state = await mockState();
  const requests = orderRequests(state);
  assert.equal(requests.length, 1, "one click must create exactly one order request");
  assert.ok(requests[0].idempotencyKey, "order request must carry Idempotency-Key");
  assert.equal(requests[0].payload.customerMode, "existing");
  assert.equal(requests[0].payload.routeCustomerId, "rc-existing");
  assert.equal(requests[0].payload.items.length, 1);
  assert.equal(requests[0].payload.items[0].variantId, "variant-strawberry");

  await page.screenshot({ path: `${resultsDir}/01-existing-session-customer-order.png`, fullPage: true });
  await context.close();
  return "PASS";
}

async function manualCustomerFlow(browser) {
  await resetMock();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const dialog = await openOrderSheet(page);

  await dialog.getByRole("button", { name: /Khách nhập tay/ }).click();
  await dialog.getByLabel("Tên khách *", { exact: true }).fill("UI Manual Customer");
  await dialog.getByLabel("Số điện thoại", { exact: true }).fill("0911222333");
  await dialog.getByLabel("Khu vực", { exact: true }).fill("Mỹ Tho");
  await dialog.getByLabel("Địa chỉ giao hàng", { exact: true }).fill("123 Đường Browser Smoke");
  await dialog.getByText("Khách nhập tay được lưu trong đơn như một snapshot độc lập, không tự thêm vào tuyến.", { exact: true }).waitFor({ state: "visible" });
  await dialog.getByRole("button", { name: "Tiếp tục chọn sản phẩm", exact: true }).click();

  const teaVariant = dialog.getByRole("button", { name: /Thêm Trà Lài Hưng Phát, Lài/ });
  await teaVariant.waitFor({ state: "visible" });
  await teaVariant.click();
  await dialog.getByRole("button", { name: "Xem lại đơn", exact: true }).click();

  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "POST" && url.pathname === "/api/backend/orders";
  });
  await dialog.getByRole("button", { name: "Tạo đơn", exact: true }).click();
  const response = await responsePromise;
  assert.equal(response.status(), 201, "manual-customer order must be created");
  await dialog.waitFor({ state: "hidden" });

  const state = await mockState();
  const requests = orderRequests(state);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].payload.customerMode, "manual");
  assert.equal(Object.hasOwn(requests[0].payload, "routeCustomerId"), false);
  assert.equal(requests[0].payload.customer.name, "UI Manual Customer");
  assert.equal(requests[0].payload.customer.phone, "0911222333");
  assert.equal(requests[0].payload.items[0].variantId, "variant-tea-jasmine");

  await page.screenshot({ path: `${resultsDir}/02-manual-customer-order.png`, fullPage: true });
  await context.close();
  return "PASS";
}

await waitForHttp(`${mockBase}/health`);
await waitForHttp(`${appBase}/orders`);

const browser = await chromium.launch({ headless: true });
const evidence = {};
try {
  evidence.orderControlCenterFlow = await orderControlCenterFlow(browser);
  evidence.desktopOrderDetailFlow = await desktopOrderDetailFlow(browser);
  evidence.shortOrderWorkspace496x309 = await shortOrderWorkspaceLayoutFlow(browser);
  evidence.shortOrderWorkspace480x320 = await shortOrderWorkspaceLayoutFlow(browser, { width: 480, height: 320 });
  evidence.existingSessionCustomerFlow = await existingSessionCustomerFlow(browser);
  evidence.manualCustomerFlow = await manualCustomerFlow(browser);
  evidence.result = "PASS";
  console.log("ORDER_CREATE_NORMALIZED_BROWSER_SMOKE=PASS");
} catch (error) {
  evidence.result = "FAIL";
  evidence.error = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ""}` : String(error);
  throw error;
} finally {
  await writeFile(`${resultsDir}/browser-smoke-result.json`, JSON.stringify(evidence, null, 2));
  await browser.close();
}
