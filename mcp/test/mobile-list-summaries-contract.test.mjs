import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const customerStyles = await readFile("src/features/accounts/OutletDirectoryScreen.module.css", "utf8");
const plansStyles = await readFile("src/features/actions/ActionsClientPage.module.css", "utf8");
const layout = await readFile("src/app/layout.tsx", "utf8");
const customers = await readFile("src/features/accounts/OutletsClientPage.tsx", "utf8");
const plans = await readFile("src/features/actions/ActionsClientPage.tsx", "utf8");

const forbiddenPhase6F = /công nợ|thanh toán|\bCOD\b|payment|receivable|allocation/i;

test("customers keeps the desktop table and uses a decision-first mobile card", () => {
  assert.match(customers, /<DataTable columns=\{columns\}/);
  assert.match(customers, /data-outlet-mobile-card/);
  assert.match(customers, /Danh sách điểm bán trên điện thoại/);
  assert.match(customers, /item\.routeName} · \{item\.area/);
  assert.match(customers, /Mở hồ sơ/);
  assert.match(customers, /hasContact\(item\.contactName\) \? "Liên hệ" : "Vị trí"/);
  assert.doesNotMatch(customers.match(/function OutletMobileCard[\s\S]*?function OutletSheet/)?.[0] || "", /Doanh số|Đơn gần nhất/);
  assert.match(customers, /outlet-sheet-content[\s\S]*?Người liên hệ[\s\S]*?Cập nhật GPS/);
  assert.doesNotMatch(customers, forbiddenPhase6F);
});

test("customer responsive ownership moved to the feature CSS module and Mobile foundation tokens", () => {
  assert.match(customerStyles, /\.desktopTable\s*\{[\s\S]*?display:\s*none/);
  assert.match(customerStyles, /\.mobileList\s*\{[\s\S]*?display:\s*grid/);
  assert.match(customerStyles, /\.mobileAction[\s\S]*?min-height:\s*40px/);
  assert.match(customerStyles, /var\(--mcp-color-primary\)/);
  assert.match(customerStyles, /var\(--mcp-color-border\)/);
  assert.doesNotMatch(customerStyles, /--npp-|--brand|#754706|#98600f/i);
});

test("plans is owned by the Lô 4 feature module on desktop and mobile", () => {
  assert.match(plans, /<DataTable columns=\{columns\}/);
  assert.match(plans, /data-plan-mobile-card/);
  assert.match(plans, /Kế hoạch & Công việc/);
  assert.match(plans, /item\.accountName/);
  assert.match(plans, /item\.title/);
  assert.match(plans, /Quá hạn/);
  assert.match(plans, /Ưu tiên \{priorityLabel\(item\.priority\)\}/);
  assert.match(plans, /statusLabel\(item\.status\)/);
  assert.match(plansStyles, /var\(--mcp-color-border\)/);
  assert.match(plansStyles, /var\(--mcp-color-primary/);
  assert.doesNotMatch(plansStyles, /--npp-|--brand|!important|:global\(/);
  assert.doesNotMatch(layout, /mobile-list-summaries\.css/);
  assert.doesNotMatch(plans, forbiddenPhase6F);
});
