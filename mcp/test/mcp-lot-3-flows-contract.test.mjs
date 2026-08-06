import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const layout = await readFile("src/app/layout.tsx", "utf8");
const styles = await readFile("src/app/mcp-lot-3-flows.css", "utf8");
const home = await readFile("src/ui/shell/MobileHomeLaunchpad.tsx", "utf8");
const visitsPage = await readFile("src/app/visits/page.tsx", "utf8");
const orderPage = await readFile("src/app/visits/order-intent/page.tsx", "utf8");
const orderPanel = await readFile("src/features/mcp/McpOfficialOrderPanel.tsx", "utf8");
const lineCard = await readFile("src/features/mcp/McpLineCard.tsx", "utf8");
const sessions = await readFile("src/features/mcp/McpSessionsManagerSafe.tsx", "utf8");

const forbiddenPhase6F = /công nợ|thanh toán|\bCOD\b|payment|receivable|allocation/i;

test("home launchpad goes straight to actions without explanatory hero copy", () => {
  assert.doesNotMatch(home, /Tổng quan hôm nay/);
  assert.doesNotMatch(home, /Điều hành gọn trên điện thoại/);
  assert.doesNotMatch(home, /Mở tuyến trước/);
  assert.match(home, /Đi tuyến hôm nay/);
  assert.match(home, /mobile-home-quick-grid/);
});

test("order intent uses its exact route scope and one state-driven primary action area", () => {
  assert.match(orderPage, /activeHref="\/visits\/order-intent"/);
  for (const step of ["intent", "customer", "eligibility", "sales-order"]) {
    assert.match(orderPanel, new RegExp(`data-order-step="${step}"`));
  }
  assert.match(orderPanel, /data-order-primary-action/);
  assert.match(orderPanel, /Đồng bộ trạng thái khách/);
  assert.match(orderPanel, /Tạo đơn nháp NPP/);
  assert.match(orderPanel, /Đồng bộ đơn NPP/);
  assert.match(orderPanel, /session-customer\.customer-onboarding\.sync/);
  assert.doesNotMatch(orderPanel, forbiddenPhase6F);
});

test("visit flow keeps the current session reachable without changing business actions", () => {
  assert.match(visitsPage, /loadMcpSessions/);
  assert.match(visitsPage, /activeSessions\.sessions\.length === 1/);
  assert.match(visitsPage, /activeSessions\.sessions\.length > 1/);
  assert.match(visitsPage, /redirect\("\/routes"\)/);
  assert.match(lineCard, /returnTo/);
  assert.match(lineCard, /usePathname/);
  assert.match(lineCard, /useSearchParams/);
  assert.match(orderPage, /safeVisitReturnTo/);
  assert.match(orderPage, /returnTo=\{returnTo\}/);
  assert.match(orderPanel, /router\.push\(returnTo\)/);
  assert.doesNotMatch(orderPanel, /router\.back\(\)/);
});

test("sessions collapses filters on mobile and keeps one primary action plus a secondary menu", () => {
  assert.match(sessions, /mcp-session-filter-toggle/);
  assert.match(sessions, /aria-expanded=\{filtersOpen\}/);
  assert.match(sessions, /data-session-card/);
  assert.match(sessions, /data-session-primary-action/);
  assert.match(sessions, /mcp-session-more-menu/);
  assert.match(sessions, />PDF</);
  assert.match(sessions, />Excel</);
  assert.match(sessions, />Word</);
  assert.match(sessions, /Sửa phiên/);
  assert.match(sessions, /Xóa phiên/);
  assert.match(sessions, /Tạo lại báo cáo/);
  assert.match(sessions, /route-session\.update/);
  assert.match(sessions, /route-session\.delete-empty/);
  assert.match(sessions, /session-report\.snapshot\.create/);
  assert.match(sessions, /isClosedSession/);
  assert.match(sessions, /isEditableSession/);
  assert.doesNotMatch(sessions, forbiddenPhase6F);
});

test("lot 3 CSS is last, route-scoped and keeps warm geometry", () => {
  const listIndex = layout.indexOf('import "./mobile-list-summaries.css";');
  const lot3Index = layout.indexOf('import "./mcp-lot-3-flows.css";');
  assert.ok(listIndex >= 0);
  assert.ok(lot3Index > listIndex);
  assert.match(styles, /data-active-href="\/visits\/order-intent"/);
  assert.match(styles, /data-active-href="\/mcp\/sessions"/);
  assert.match(styles, /data-active-href="\/"/);
  assert.match(styles, /min-height:\s*46px/);
  assert.match(styles, /var\(--npp-color-primary-soft\)/);
  assert.match(styles, /var\(--npp-color-primary-strong\)/);
  assert.doesNotMatch(styles, /#6d5dfc|#4f46e5|#06b6d4|#2563eb/i);
});
