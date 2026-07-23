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

function jsonBody(data) {
  return JSON.stringify({
    data,
    requestId: "route-customer-photo-browser-smoke",
    receivedAt: new Date().toISOString()
  });
}

function deferredGate(fail = false) {
  let markStarted;
  let release;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const released = new Promise((resolve) => { release = resolve; });
  return { fail, started, released, markStarted, release };
}

async function waitForDisabled(locator, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await locator.isDisabled().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timeout_waiting_for_disabled_control");
}

await waitForHttp(`${appBase}/routes`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const events = [];
let profileFetchCount = 0;
let putGate = null;
let deleteGate = null;
let sequence = 3;
const uploadIds = new Map();
let media = [
  {
    id: "media-1",
    status: "ready",
    capturedAt: "2026-07-18T08:00:00.000Z",
    viewUrl: `${appBase}/__signed-photo/media-1.jpg?token=private-one`,
    viewExpiresAt: "2026-07-20T08:05:00.000Z"
  },
  {
    id: "media-2",
    status: "ready",
    capturedAt: "2026-07-19T09:00:00.000Z",
    viewUrl: `${appBase}/__signed-photo/media-2.jpg?token=private-two`,
    viewExpiresAt: "2026-07-20T08:05:00.000Z"
  }
];

function profilePayload() {
  return {
    customer: {
      id: "rc-existing",
      routeId: "route-active",
      customerId: "customer-existing",
      customerName: "UI Existing Customer",
      phone: "0900000000",
      area: "API Smoke",
      address: "1 Browser Smoke",
      sortOrder: 1,
      active: true,
      note: "Browser smoke seed",
      geo: { lat: 10.762622, lng: 106.660172, accuracy: 8 },
      updatedAt: "2026-07-19T09:00:00.000Z"
    },
    media,
    mediaLimit: 3,
    mediaCount: media.length
  };
}

await page.route("**/__signed-photo/**", async (route) => {
  await route.fulfill({ status: 200, contentType: "image/png", body: png });
});

await page.route("https://signed-upload.example.test/**", async (route) => {
  events.push({ type: "put", url: route.request().url() });
  const gate = putGate;
  putGate = null;
  if (gate) {
    gate.markStarted();
    await gate.released;
    if (gate.fail) {
      await route.fulfill({ status: 503, body: "retry" });
      return;
    }
  }
  await route.fulfill({ status: 200, body: "" });
});

await page.route("**/api/backend/outlet-media/**", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const payload = request.postData() ? JSON.parse(request.postData()) : {};

  if (request.method() === "GET" && url.pathname.endsWith("/customer-profile")) {
    profileFetchCount += 1;
    events.push({ type: "profile", routeCustomerId: url.searchParams.get("routeCustomerId") });
    await route.fulfill({ status: 200, contentType: "application/json", body: jsonBody(profilePayload()) });
    return;
  }

  if (request.method() === "POST" && url.pathname.endsWith("/upload-init")) {
    const clientUploadId = String(payload.clientUploadId || "");
    const mediaId = uploadIds.get(clientUploadId) || `media-${sequence++}`;
    uploadIds.set(clientUploadId, mediaId);
    events.push({ type: "init", mediaId, clientUploadId, sessionId: payload.sessionId ?? null });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: jsonBody({
        mediaId,
        mimeType: payload.mimeType,
        status: "pending",
        putUrl: `https://signed-upload.example.test/${mediaId}?signature=private-put`,
        expiresAt: "2026-07-20T08:05:00.000Z"
      })
    });
    return;
  }

  if (request.method() === "POST" && url.pathname.endsWith("/upload-finalize")) {
    const mediaId = String(payload.mediaId || "");
    events.push({ type: "finalize", mediaId });
    if (!media.some((item) => item.id === mediaId)) {
      media = [
        ...media,
        {
          id: mediaId,
          status: "ready",
          capturedAt: "2026-07-20T08:00:00.000Z",
          viewUrl: `${appBase}/__signed-photo/${mediaId}.jpg?token=private-final`,
          viewExpiresAt: "2026-07-20T08:05:00.000Z"
        }
      ];
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: jsonBody({ mediaId, status: "ready" }) });
    return;
  }

  if (request.method() === "POST" && url.pathname.endsWith("/delete")) {
    events.push({ type: "delete", mediaId: payload.mediaId });
    const gate = deleteGate;
    deleteGate = null;
    if (gate) {
      gate.markStarted();
      await gate.released;
    }
    media = media.filter((item) => item.id !== payload.mediaId);
    await route.fulfill({ status: 200, contentType: "application/json", body: jsonBody({ mediaId: payload.mediaId, deleted: true }) });
    return;
  }

  await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "unexpected_outlet_media_route" }) });
});

page.on("dialog", (dialog) => void dialog.accept());
await page.goto(`${appBase}/routes`, { waitUntil: "networkidle" });

const routeCard = page.locator("article.operational-list-card").filter({ hasText: "UI Smoke Active" }).first();
await routeCard.getByRole("button", { name: "Chọn tuyến", exact: true }).click();
const customerCard = page.locator("article.operational-list-card").filter({ hasText: "UI Existing Customer" }).first();
await customerCard.waitFor({ state: "visible" });

await customerCard.getByRole("button", { name: "Xem điểm bán", exact: true }).click();
const viewDialog = page.getByRole("dialog", { name: "UI Existing Customer" });
await viewDialog.waitFor({ state: "visible" });
const gallery = viewDialog.locator('[data-route-customer-media-gallery="true"]');
await gallery.waitFor({ state: "visible" });
assert.equal(await gallery.locator("figure").count(), 2, "view sheet must show the two ready private photos");
const galleryMetrics = await gallery.evaluate((node) => {
  const card = node.querySelector("figure");
  const image = node.querySelector("img");
  const galleryStyle = getComputedStyle(node);
  const cardStyle = card ? getComputedStyle(card) : null;
  const cardBox = card?.getBoundingClientRect();
  const imageBox = image?.getBoundingClientRect();
  return {
    overflowX: galleryStyle.overflowX,
    scrollSnapType: galleryStyle.scrollSnapType,
    scrollWidth: node.scrollWidth,
    clientWidth: node.clientWidth,
    cardWidth: cardBox?.width || 0,
    cardSnap: cardStyle?.scrollSnapAlign || "",
    imageRatio: imageBox?.height ? imageBox.width / imageBox.height : 0,
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth
  };
});
assert.equal(galleryMetrics.overflowX, "auto");
assert.match(galleryMetrics.scrollSnapType, /x mandatory|x proximity/);
assert.equal(galleryMetrics.cardSnap, "start");
assert.ok(galleryMetrics.cardWidth >= 239 && galleryMetrics.cardWidth <= 281, `gallery card width ${galleryMetrics.cardWidth} must stay in the requested mobile range`);
assert.ok(galleryMetrics.scrollWidth > galleryMetrics.clientWidth, "gallery must be horizontally scrollable");
assert.ok(Math.abs(galleryMetrics.imageRatio - 4 / 3) < 0.08, "gallery images must render near 4/3");
assert.ok(galleryMetrics.documentWidth <= galleryMetrics.viewportWidth + 1, "gallery must not overflow the page or sheet");
const largeLink = gallery.getByRole("link", { name: /Mở ảnh 1/ });
assert.equal(await largeLink.getAttribute("target"), "_blank");
assert.match(await largeLink.getAttribute("href"), /token=private-one/);
await viewDialog.getByRole("button", { name: "Đóng", exact: true }).last().click();
await viewDialog.waitFor({ state: "hidden" });

const beforeCreateProfileFetches = profileFetchCount;
await page.getByRole("button", { name: "Thêm điểm bán vào tuyến", exact: true }).click();
const createDialog = page.getByRole("dialog", { name: "Thêm điểm bán vào tuyến" });
await createDialog.waitFor({ state: "visible" });
assert.equal(await createDialog.locator('[data-outlet-photo-manager="true"]').count(), 0, "create mode must not mount the photo manager");
await page.waitForTimeout(150);
assert.equal(profileFetchCount, beforeCreateProfileFetches, "create mode must not call customer-profile before routeCustomerId exists");
await createDialog.getByRole("button", { name: "Đóng", exact: true }).last().click();
await createDialog.waitFor({ state: "hidden" });

await customerCard.getByRole("button", { name: "Sửa", exact: true }).click();
const editDialog = page.getByRole("dialog", { name: "Sửa điểm bán" });
await editDialog.waitFor({ state: "visible" });
const manager = editDialog.locator('[data-outlet-photo-manager="true"]');
await manager.waitFor({ state: "visible" });
await manager.getByText("2 ảnh", { exact: true }).waitFor({ state: "visible" });
assert.ok(profileFetchCount > beforeCreateProfileFetches, "edit mode must load the existing route customer profile");
assert.equal(await manager.getByRole("link", { name: /Mở ảnh điểm bán/ }).count(), 2);
const cameraInput = manager.locator('input[type="file"][capture="environment"]');
const galleryInput = manager.locator('input[type="file"][multiple]');
assert.equal(await cameraInput.getAttribute("accept"), "image/*");
assert.equal(await galleryInput.getAttribute("accept"), "image/*");

const firstFile = { name: "storefront-one.png", mimeType: "image/png", buffer: png };
const secondFile = { name: "storefront-two.png", mimeType: "image/png", buffer: png };
await galleryInput.setInputFiles([firstFile, secondFile]);
const draftImages = manager.getByAltText("Ảnh điểm bán đang chờ tải");
await assert.doesNotReject(() => draftImages.first().waitFor({ state: "visible" }));
assert.equal(await draftImages.count(), 1, "stored photos plus drafts must never exceed three");
assert.equal(await manager.getByRole("button", { name: "📷 Chụp", exact: true }).isDisabled(), true);
assert.equal(await manager.getByRole("button", { name: "▧ Thư viện", exact: true }).isDisabled(), true);
await manager.getByRole("button", { name: "Bỏ", exact: true }).click();
await draftImages.first().waitFor({ state: "detached" });

await galleryInput.setInputFiles(firstFile);
await manager.getByRole("button", { name: "Lưu 1 ảnh", exact: true }).waitFor({ state: "visible" });
const failingPutGate = deferredGate(true);
putGate = failingPutGate;
await manager.getByRole("button", { name: "Lưu 1 ảnh", exact: true }).click();
await failingPutGate.started;
assert.equal(await manager.getByRole("button", { name: "📷 Chụp", exact: true }).isDisabled(), true, "camera must lock during upload");
assert.equal(await manager.getByRole("button", { name: "▧ Thư viện", exact: true }).isDisabled(), true, "gallery must lock during upload");
failingPutGate.release();
await manager.getByRole("button", { name: "Thử lại", exact: true }).waitFor({ state: "visible" });
await manager.getByText("Lỗi tải", { exact: true }).waitFor({ state: "visible" });

const retryPutGate = deferredGate(false);
putGate = retryPutGate;
await manager.getByRole("button", { name: "Thử lại", exact: true }).click();
await retryPutGate.started;
assert.equal(await manager.getByRole("button", { name: "Thử lại", exact: true }).isDisabled(), true, "retry must lock duplicate submissions");
retryPutGate.release();
await manager.getByText("Đã bổ sung 1 ảnh cho điểm bán.", { exact: true }).waitFor({ state: "visible" });
assert.equal(await manager.getByRole("link", { name: /Mở ảnh điểm bán/ }).count(), 3);

const lifecycle = events.filter((event) => ["init", "put", "finalize"].includes(event.type)).map((event) => event.type);
assert.deepEqual(lifecycle.slice(-3), ["init", "put", "finalize"], "successful retry must keep upload-init -> signed PUT -> upload-finalize order");
const finalInit = [...events].reverse().find((event) => event.type === "init");
assert.equal(finalInit.sessionId, null, "fixed-route profile upload must not invent a session id");

const deletingLinkCount = await manager.getByRole("link", { name: /Mở ảnh điểm bán/ }).count();
const activeDeleteGate = deferredGate(false);
deleteGate = activeDeleteGate;
await manager.getByRole("button", { name: "Xóa ảnh điểm bán 1", exact: true }).click();
await activeDeleteGate.started;
assert.equal(await manager.getByRole("button", { name: "📷 Chụp", exact: true }).isDisabled(), true, "camera must lock during delete");
const editSubmitButton = editDialog.getByRole("button", { name: "Lưu điểm bán", exact: true });
await waitForDisabled(editSubmitButton);
assert.equal(await editSubmitButton.isDisabled(), true, "edit submit must lock during media deletion");
activeDeleteGate.release();
await manager.getByText("Đã xóa ảnh điểm bán.", { exact: true }).waitFor({ state: "visible" });
assert.equal(await manager.getByRole("link", { name: /Mở ảnh điểm bán/ }).count(), deletingLinkCount - 1);
assert.ok(events.some((event) => event.type === "delete"), "delete must go through outlet-media/delete");

await page.screenshot({ path: `${resultsDir}/18-route-customer-photo-management.png`, fullPage: true });
await writeFile(`${resultsDir}/route-customer-photo-management.json`, JSON.stringify({ profileFetchCount, events, galleryMetrics }, null, 2));
await context.close();
await browser.close();

console.log(JSON.stringify({ ok: true, profileFetchCount, eventTypes: events.map((event) => event.type), galleryMetrics }, null, 2));
