import assert from "node:assert/strict";
import { chromium } from "playwright";

const app = process.env.DASHBOARD_APP_BASE || "http://127.0.0.1:3000";
const mock = process.env.DASHBOARD_MOCK_BASE || "http://127.0.0.1:3112";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

await page.goto(app, { waitUntil: "networkidle" });
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
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("alert").getByText("Không tải được dữ liệu", { exact: true }).waitFor();
assert.equal(await page.getByText("0 đơn", { exact: false }).count(), 0);
await browser.close();
console.log("dashboard_persisted_browser_smoke_passed planned=12 visited=9 orders=2 followups=3 health=watch error=visible");
