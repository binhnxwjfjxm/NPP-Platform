import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const layout = await readFile("src/app/layout.tsx", "utf8");
const styles = await readFile("src/app/mobile-list-summaries.css", "utf8");
const customers = await readFile("src/features/accounts/OutletsClientPage.tsx", "utf8");
const plans = await readFile("src/features/actions/ActionsClientPage.tsx", "utf8");

const forbiddenPhase6F = /công nợ|thanh toán|\bCOD\b|payment|receivable|allocation/i;

test("route-specific mobile list layer loads after shared mobile styles", () => {
  const sharedIndex = layout.indexOf('import "./mcp-mobile-support-flows.css";');
  const homeIndex = layout.indexOf('import "./mobile-home-dashboard.css";');
  const listIndex = layout.indexOf('import "./mobile-list-summaries.css";');
  assert.ok(sharedIndex >= 0);
  assert.ok(homeIndex > sharedIndex);
  assert.ok(listIndex > homeIndex);
});

test("customers keeps the desktop table and uses a decision-first mobile card", () => {
  assert.match(customers, /<DataTable columns=\{columns\}/);
  assert.match(customers, /data-outlet-mobile-card/);
  assert.match(customers, /Danh sách điểm bán trên điện thoại/);
  assert.match(customers, /item\.routeName} · \{item\.area/);
  assert.match(customers, /Ghé gần nhất/);
  assert.match(customers, /Mở hồ sơ/);
  assert.doesNotMatch(customers.match(/function OutletMobileCard[\s\S]*?function OutletSheet/)?.[0] || "", /Doanh số|Người liên hệ|Đơn gần nhất/);
  assert.match(customers, /outlet-sheet-content[\s\S]*?Người liên hệ[\s\S]*?Đơn gần nhất/);
  assert.doesNotMatch(customers, forbiddenPhase6F);
});

test("plans keeps the desktop table and prioritizes task, outlet, due date, priority and status on mobile", () => {
  assert.match(plans, /<DataTable columns=\{columns\}/);
  assert.match(plans, /data-plan-mobile-card/);
  assert.match(plans, /Danh sách kế hoạch trên điện thoại/);
  assert.match(plans, /item\.accountName/);
  assert.match(plans, /item\.title/);
  assert.match(plans, /Quá hạn/);
  assert.match(plans, /Ưu tiên \{priorityLabel\(item\.priority\)\}/);
  assert.match(plans, /statusLabel\(item\.status\)/);
  assert.doesNotMatch(plans.match(/function ActionMobileCard[\s\S]*?function ActionDetailSheet/)?.[0] || "", /Phụ trách|Nguồn|Ghi chú xử lý/);
  assert.match(plans, /plan-sheet-content[\s\S]*?Phụ trách[\s\S]*?Nguồn[\s\S]*?Ghi chú xử lý/);
  assert.doesNotMatch(plans, forbiddenPhase6F);
});

test("mobile summary CSS is scoped to customers and plans, keeps warm tokens and 44px actions", () => {
  assert.match(styles, /data-active-href="\/customers"/);
  assert.match(styles, /data-active-href="\/plans"/);
  assert.match(styles, /\.route-desktop-table\s*\{[\s\S]*?display:\s*none/);
  assert.match(styles, /\.route-mobile-list\s*\{[\s\S]*?display:\s*grid/);
  assert.match(styles, /\.mobile-summary-action\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(styles, /var\(--npp-color-primary-soft\)/);
  assert.match(styles, /var\(--npp-color-primary-strong\)/);
  assert.doesNotMatch(styles, /#6d5dfc|#4f46e5|#06b6d4|#2563eb/i);
});
