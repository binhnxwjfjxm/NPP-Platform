import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const appBase = process.env.F05_UI_APP_BASE || "http://127.0.0.1:3000";
const resultsDir = process.env.F05_UI_RESULTS_DIR || "test-results/f05-ui-smoke";
await mkdir(resultsDir, { recursive: true });

async function waitForHttp(url, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if ((await fetch(url, { cache: "no-store" })).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`timeout_waiting_for_${url}`);
}

await waitForHttp(`${appBase}/mcp-setting`);

let items = [{
  id: "setting-item-1",
  key: "old-competitor",
  label: "Đối thủ cũ",
  value: "Giá thấp",
  category: "Đối thủ",
  brandName: "Nguồn A",
  status: "active",
  sortOrder: 1
}];
const mutations = [];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();

await page.route("**/api/mcp-report-settings**", async (route) => {
  const request = route.request();
  const method = request.method();

  if (method === "GET") {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          groups: [{
            id: "setting-group-1",
            key: "competitor",
            title: "Đối thủ cạnh tranh",
            description: "Nhóm dùng cho browser regression",
            status: "active",
            sortOrder: 1,
            items
          }]
        }
      })
    });
  }

  if (method === "POST") {
    const payload = request.postDataJSON();
    const idempotencyKey = request.headers()["idempotency-key"] || "";
    mutations.push({ method, payload, idempotencyKey });
    items = [...items, {
      id: "setting-item-2",
      key: "new-competitor",
      label: payload.label,
      value: payload.value,
      category: payload.category || "",
      brandName: payload.brandName || "",
      status: "active",
      sortOrder: payload.sortOrder || 0
    }];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { id: "setting-item-2" }, meta: { idempotency: { replayed: false } } })
    });
  }

  if (method === "PATCH") {
    const payload = request.postDataJSON();
    const idempotencyKey = request.headers()["idempotency-key"] || "";
    mutations.push({ method, payload, idempotencyKey });
    items = items.map((item) => item.id === payload.itemId ? {
      ...item,
      label: payload.label ?? item.label,
      value: payload.value ?? item.value,
      category: payload.category ?? item.category,
      brandName: payload.brandName ?? item.brandName,
      sortOrder: payload.sortOrder ?? item.sortOrder,
      status: payload.status ?? item.status
    } : item);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { id: payload.itemId }, meta: { idempotency: { replayed: false } } })
    });
  }

  return route.fulfill({
    status: 405,
    contentType: "application/json",
    body: JSON.stringify({ error: { message: "method_not_allowed" } })
  });
});

const evidence = {};

try {
  await page.goto(`${appBase}/mcp-setting`, { waitUntil: "networkidle" });
  await page.getByText("Đối thủ cũ", { exact: true }).waitFor({ state: "visible" });

  const main = page.locator("[data-app-scroll-region]");
  await page.addStyleTag({
    content: `[data-app-scroll-region]::after { content: ""; display: block; height: 700px; flex: 0 0 700px; }`
  });

  const createButton = page.getByRole("button", { name: "Thêm mẫu", exact: true });
  await createButton.evaluate((node) => node.scrollIntoView({ block: "center" }));
  evidence.createScrollBefore = await main.evaluate((node) => node.scrollTop);

  await createButton.click();
  const createDialog = page.getByRole("dialog", { name: "Thêm mẫu" });
  await createDialog.waitFor({ state: "visible" });
  evidence.createScrollOpen = await main.evaluate((node) => node.scrollTop);
  assert.ok(
    Math.abs(evidence.createScrollOpen - evidence.createScrollBefore) <= 1,
    "opening create dialog must preserve the current MCP settings scroll position"
  );

  const createBox = await createDialog.boundingBox();
  assert.ok(createBox && createBox.width <= 460, "create dialog must stay compact");
  assert.ok(createBox && createBox.y > 20, "create dialog must be centered instead of becoming a bottom sheet");
  assert.ok(createBox && createBox.y + createBox.height < 824, "create dialog must stay inside the mobile viewport");

  const createName = createDialog.getByLabel("Tên mẫu");
  assert.equal(await createName.evaluate((node) => document.activeElement === node), true, "create dialog must focus the first field");
  await createName.fill("Đối thủ mới");
  await createDialog.getByRole("button", { name: "Thêm mẫu", exact: true }).click();
  await createDialog.waitFor({ state: "hidden" });
  await page.getByText("Đối thủ mới", { exact: true }).waitFor({ state: "visible" });
  evidence.createScrollAfter = await main.evaluate((node) => node.scrollTop);
  assert.ok(
    Math.abs(evidence.createScrollAfter - evidence.createScrollBefore) <= 1,
    "creating must not jump the MCP settings page"
  );

  assert.equal(mutations.filter((item) => item.method === "POST").length, 1, "create dialog must issue exactly one POST mutation");
  assert.equal(mutations[0].payload.label, "Đối thủ mới");
  assert.ok(mutations[0].idempotencyKey.length >= 16, "POST mutation must include a stable idempotency key");

  const oldCard = page.locator("[data-setting-item]").filter({ hasText: "Đối thủ cũ" });
  const editButton = oldCard.getByRole("button", { name: "Sửa", exact: true });
  await editButton.evaluate((node) => node.scrollIntoView({ block: "center" }));
  evidence.editScrollBefore = await main.evaluate((node) => node.scrollTop);

  await editButton.click();
  const editDialog = page.getByRole("dialog", { name: "Sửa lựa chọn" });
  await editDialog.waitFor({ state: "visible" });
  evidence.editScrollOpen = await main.evaluate((node) => node.scrollTop);
  assert.ok(
    Math.abs(evidence.editScrollOpen - evidence.editScrollBefore) <= 1,
    "opening edit dialog must preserve the current MCP settings scroll position"
  );

  const editBox = await editDialog.boundingBox();
  assert.ok(editBox && editBox.width <= 460, "edit dialog must stay compact");
  assert.ok(editBox && editBox.y > 20, "edit dialog must be centered instead of becoming a bottom sheet");
  assert.ok(editBox && editBox.y + editBox.height < 824, "edit dialog must stay inside the mobile viewport");

  const editName = editDialog.getByLabel("Tên mẫu");
  assert.equal(await editName.evaluate((node) => document.activeElement === node), true, "edit dialog must focus the first field");
  await editName.fill("Đối thủ đã sửa");
  await editDialog.getByRole("button", { name: "Cập nhật", exact: true }).click();
  await editDialog.waitFor({ state: "hidden" });
  await page.getByText("Đối thủ đã sửa", { exact: true }).waitFor({ state: "visible" });
  evidence.editScrollAfter = await main.evaluate((node) => node.scrollTop);
  assert.ok(
    Math.abs(evidence.editScrollAfter - evidence.editScrollBefore) <= 1,
    "editing must not jump the MCP settings page to the create form"
  );

  assert.equal(mutations.filter((item) => item.method === "PATCH").length, 1, "edit dialog must issue exactly one PATCH mutation");
  assert.equal(mutations[1].payload.itemId, "setting-item-1");
  assert.equal(mutations[1].payload.label, "Đối thủ đã sửa");
  assert.ok(mutations[1].idempotencyKey.length >= 16, "PATCH mutation must include a stable idempotency key");

  const cards = page.locator("[data-setting-item]");
  assert.equal(await cards.count(), 2, "create and edit must not duplicate unrelated settings");
  const cardBox = await cards.first().boundingBox();
  assert.ok(cardBox && cardBox.height <= 76, "setting cards must stay compact in two rows");

  await page.screenshot({ path: `${resultsDir}/18-mcp-settings-compact-dialogs.png`, fullPage: false });
  evidence.mutations = mutations;
  evidence.cardBox = cardBox;
  await writeFile(`${resultsDir}/mcp-settings-dialog.json`, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ status: "PASS", mutations: mutations.length, cardHeight: cardBox?.height }, null, 2));
} catch (error) {
  const detail = {
    status: "FAIL",
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : null,
    evidence,
    mutations
  };
  await writeFile(`${resultsDir}/mcp-settings-dialog-error.json`, JSON.stringify(detail, null, 2));
  console.error(JSON.stringify(detail, null, 2));
  throw error;
} finally {
  await context.close();
  await browser.close();
}
