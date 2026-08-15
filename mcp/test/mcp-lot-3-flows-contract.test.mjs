import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const layout = await readFile("src/app/layout.tsx", "utf8");
const styles = await readFile("src/app/mcp-lot-3-flows.css", "utf8");
const sessionOwnerStyles = await readFile("src/app/mcp-sessions-owner-polish.css", "utf8");
const home = await readFile("src/ui/shell/MobileHomeLaunchpad.tsx", "utf8");
const visitsPage = await readFile("src/app/visits/page.tsx", "utf8");
const legacyOrderPage = await readFile("src/app/visits/order-intent/page.tsx", "utf8");
const ordersPage = await readFile("src/features/orders/McpCoreOrdersClient.tsx", "utf8");
const visitSession = await readFile("src/features/mcp/McpSessionCompactViewFinal2.tsx", "utf8");
const lineCard = await readFile("src/features/mcp/McpLineCard.tsx", "utf8");
const sessions = await readFile("src/features/mcp/McpSessionsManagerSafe.tsx", "utf8");
const forbiddenPhase6F = /công nợ|thanh toán|\bCOD\b|payment|receivable|allocation/i;

test("home launchpad goes straight to actions without explanatory hero copy", () => { assert.doesNotMatch(home, /Tổng quan hôm nay/); assert.doesNotMatch(home, /Điều hành gọn trên điện thoại/); assert.doesNotMatch(home, /Mở tuyến trước/); assert.match(home, /Đi tuyến hôm nay/); assert.match(home, /mobile-home-quick-grid/); });
test("legacy order-intent route is retired into the canonical Orders workspace", () => { assert.match(legacyOrderPage, /redirect\("\/orders"\)/); assert.match(ordersPage, /\/api\/backend\/core-sales\/orders/); assert.match(ordersPage, /createIdempotencyKey\("mcp\.sales-order\.create"\)/); assert.match(ordersPage, /Nguồn MCP/); });
test("visit Có đơn stays a reporting-only toggle and cannot open customer/order side effects", () => { assert.match(lineCard, /\/api\/backend\/mcp-day\/session-customer\/result/); assert.match(lineCard, /hasOrder: target/); assert.match(lineCard, /line\.hasOrder \? "Đã có đơn" : "Có đơn"/); assert.doesNotMatch(visitSession, /Ghi nhận nhu cầu mua|Lưu nhu cầu mua|ProductPicker|OrderFields|customer-onboarding\/submit|customer-onboarding\/sync|onContinueOfficialOrder|\/visits\/order-intent/); assert.doesNotMatch(lineCard, /Đơn NPP|\/visits\/order-intent|usePathname|useSearchParams/); });
test("visit flow keeps the current session reachable without changing reporting actions", () => { assert.match(visitsPage, /loadMcpSessions/); assert.match(visitsPage, /activeSessions\.sessions\.length === 1/); assert.match(visitsPage, /activeSessions\.sessions\.length > 1/); assert.match(visitsPage, /redirect\("\/routes"\)/); for (const label of ["Có đơn", "Test", "Quan sát", "Theo dõi", "Bỏ qua"]) assert.match(lineCard, new RegExp(label)); });
test("sessions collapses filters on mobile and keeps one primary action plus a secondary menu", () => { assert.match(sessions, /mcp-session-filter-toggle/); assert.match(sessions, /data-session-card/); assert.match(sessions, /data-session-primary-action/); assert.match(sessions, /mcp-session-more-menu/); assert.match(sessions, />PDF</); assert.match(sessions, />Excel</); assert.match(sessions, />Word</); assert.match(sessions, /route-session\.update/); assert.match(sessions, /route-session\.delete-empty/); assert.doesNotMatch(sessions, forbiddenPhase6F); });
test("sessions owner polish keeps three KPIs in one light row and filter chrome flat", () => { const satinIndex = layout.indexOf('import "./satin-metal-actions.css";'); const ownerPolishIndex = layout.indexOf('import "./mcp-sessions-owner-polish.css";'); assert.ok(satinIndex >= 0); assert.ok(ownerPolishIndex > satinIndex); assert.match(sessionOwnerStyles, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/); assert.match(sessionOwnerStyles, /mcp-session-filter-toggle[\s\S]*background:\s*transparent/); });
test("lot 3 CSS keeps warm geometry without introducing a second order workspace", () => { const listIndex = layout.indexOf('import "./mobile-list-summaries.css";'); const lot3Index = layout.indexOf('import "./mcp-lot-3-flows.css";'); assert.ok(listIndex >= 0); assert.ok(lot3Index > listIndex); assert.match(styles, /data-active-href="\/mcp\/sessions"/); assert.match(styles, /min-height:\s*46px/); assert.doesNotMatch(styles, /#6d5dfc|#4f46e5|#06b6d4|#2563eb/i); });
