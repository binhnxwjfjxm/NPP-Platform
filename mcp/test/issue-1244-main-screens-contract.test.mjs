import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appShell = await readFile("src/ui/shell/AppShell.tsx", "utf8");
const today = await readFile("src/features/dashboard/McpDashboardLocalPage.tsx", "utf8");
const todayCss = await readFile("src/features/dashboard/TodayScreen.module.css", "utf8");
const visits = await readFile("src/features/mcp/McpSessionCompactViewFinal2.tsx", "utf8");
const visitCss = await readFile("src/features/mcp/RouteWorkScreen.module.css", "utf8");
const lineCss = await readFile("src/features/mcp/McpLineCard.module.css", "utf8");
const customers = await readFile("src/features/accounts/OutletsClientPage.tsx", "utf8");
const customerCss = await readFile("src/features/accounts/OutletDirectoryScreen.module.css", "utf8");
const orders = await readFile("src/features/orders/OrdersClientPage.tsx", "utf8");
const orderCss = await readFile("src/features/orders/OrdersClientPage.module.css", "utf8");
const orderTabs = await readFile("src/features/orders/OrdersTabs.module.css", "utf8");
const orderUi = await readFile("src/features/orders/orders-page-ui.tsx", "utf8");
const more = await readFile("src/features/more/MorePage.tsx", "utf8");

test("Lô 3 gives every primary destination one explicit screen owner", () => {
  assert.match(today, /data-primary-screen="today"/);
  assert.match(visits, /data-primary-screen="visits"/);
  assert.match(customers, /data-primary-screen="customers"/);
  assert.match(orders, /data-primary-screen="orders"/);
  assert.match(more, /data-primary-screen="more"/);
  assert.doesNotMatch(appShell, /MobileHomeLaunchpad/);
});

test("Hôm nay is foundation-owned and no longer uses the legacy dashboard presentation components", () => {
  assert.match(today, /McpPageHeader/);
  assert.match(today, /McpCard/);
  assert.match(today, /McpStatePanel/);
  assert.match(today, /href="\/visits"/);
  assert.doesNotMatch(today, /TodaySummaryCard|CompactKpiStrip|FilterBar|className="dashboard-/);
  assert.doesNotMatch(todayCss, /--npp-|--brand|--muted|!important|:global\(/);
});

test("Đi tuyến keeps mutation callers while moving the main screen and card palette to foundation", () => {
  assert.match(visits, /McpPageHeader/);
  assert.match(visits, /McpFilterChip/);
  assert.match(visits, /McpStatusPill/);
  assert.match(visits, /className=\{styles\.lineList\}/);
  assert.doesNotMatch(visits.match(/function LineList[\s\S]*?function CustomerSheet/)?.[0] || "", /empty-inline|page-subtitle|mcp-line-list/);
  for (const operation of [
    "session-customer.test.create",
    "session-customer.report.create",
    "session-customer.followup.create",
    "session-customer.status.update",
    "session-customer.checkin.set"
  ]) assert.match(visits, new RegExp(operation.replaceAll(".", "\\.")));
  assert.doesNotMatch(visitCss, /--npp-|--brand|!important|:global\(/);
  assert.doesNotMatch(lineCss, /--brand-primary|--text-muted|--border,|--surface,/);
  assert.match(lineCss, /--mcp-color-primary/);
});

test("Điểm bán main list uses foundation controls while the detail sheet remains a separate Lô 4 concern", () => {
  for (const primitive of ["McpPageHeader", "McpFilterChip", "McpInput", "McpSelect", "McpStatusPill", "McpCard"]) {
    assert.match(customers, new RegExp(primitive));
  }
  assert.match(customers, /<DataTable columns=\{columns\}/);
  assert.match(customers, /data-outlet-mobile-card/);
  assert.match(customers, /outlet-sheet-content/);
  assert.doesNotMatch(customerCss, /--npp-|--brand|--muted|!important|:global\(/);
});

test("Đơn hàng main screen and cards use foundation tokens without changing create/detail contracts", () => {
  assert.match(orders, /McpPageHeader/);
  assert.match(orders, /McpButton/);
  assert.match(orders, /<OrderCreateSheet/);
  assert.match(orders, /<OrderDetailDrawer/);
  assert.match(orderUi, /data-order-card="true"/);
  assert.doesNotMatch(orderUi, /OperationalListCard/);
  for (const css of [orderCss, orderTabs]) {
    assert.doesNotMatch(css, /--brand-strong|--muted|--line\)|--ink\)|--ring-soft|#754706|#98600f/i);
    assert.match(css, /--mcp-color-/);
  }
});


test("primary-screen copy does not expose implementation wording", () => {
  assert.doesNotMatch(orders, /dữ liệu live|API hiện chưa|accountId/);
});


test("Đơn hàng main screen has no remaining route-level legacy CSS owner", async () => {
  for (const path of [
    "src/app/mcp-compact-ui.css",
    "src/app/mcp-mobile-support-flows.css",
    "src/app/export-menu-fix.css"
  ]) {
    const css = await readFile(path, "utf8");
    assert.doesNotMatch(css, /data-active-href="\/orders"/);
  }
});
