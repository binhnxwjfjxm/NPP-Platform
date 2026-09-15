import assert from "node:assert/strict";
import { chromium } from "playwright";

const app = process.env.DASHBOARD_APP_BASE || "http://127.0.0.1:3000";
const mock = process.env.DASHBOARD_MOCK_BASE || "http://127.0.0.1:3112";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
await context.addCookies([{ name: "hp_mcp_session", value: "dashboard-smoke-session", url: app }]);
const page = await context.newPage();

await page.goto(app, { waitUntil: "domcontentloaded" });
const routeA = page.getByRole("article").filter({ hasText: "Tuyến Browser A" });
await routeA.getByText("session-latest-a", { exact: false }).waitFor();
await routeA.getByText("9/12", { exact: true }).waitFor();
await routeA.getByText("2", { exact: true }).first().waitFor();
await routeA.getByText("3", { exact: true }).waitFor();
await routeA.getByText("Theo dõi", { exact: true }).first().waitFor();
await page.getByText("Kiểm tra phiên đã hủy tại Tuyến Browser B", { exact: true }).waitFor();
await page.getByText("Lập phiên cho Tuyến chưa có phiên", { exact: true }).waitFor();
assert.equal(await routeA.getByText("Tuyến Browser A", { exact: true }).count(), 1);

await fetch(`${mock}/__fail`, { method: "POST" });
await page.reload({ waitUntil: "domcontentloaded" });
await page.getByText("Đang dùng dữ liệu đã lưu; lần cập nhật gần nhất chưa thành công.", { exact: true }).waitFor();
await routeA.getByText("9/12", { exact: true }).waitFor();
await routeA.getByText("2", { exact: true }).first().waitFor();
await routeA.getByText("3", { exact: true }).waitFor();
assert.equal(await page.getByText("0 đơn", { exact: false }).count(), 0);
await context.close();
await browser.close();
console.log("dashboard_persisted_browser_smoke_passed planned=12 visited=9 orders=2 followups=3 health=watch cached_error=visible");
