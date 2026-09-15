import "server-only";

import {
  compareSessionsNewestFirst,
  derivePersistedRouteOverview,
  vietnamBusinessDate,
  type DashboardReportRow,
  type DashboardRouteRow,
  type DashboardSessionRow
} from "@/features/dashboard/persisted-overview";
import type { RouteCustomerItem, RouteCustomersData } from "@/features/mcp/route-customers.types";
import type { RouteItem, RoutesData } from "@/features/routes/routes.types";
import { backendApiBaseUrl, backendApiRequestHeaders } from "@/lib/api/backend-proxy";
import { isInternalSmokeRecord } from "@/lib/data/internal-smoke";
import type { McpShellAction, McpShellCacheRow, McpShellDashboard, McpShellLatestReport, McpShellSessionRow, McpShellSnapshot } from "./mcp-shell-types";

type Row = Record<string, unknown>;
type BackendPayload = { cursor?: unknown; unchanged?: unknown; snapshot?: { generatedAt?: unknown; recentSessionDays?: unknown; routes?: Row[]; routeCustomers?: Row[]; latestSessions?: Row[]; latestReports?: Row[]; recentSessions?: Row[]; recentSessionAggregates?: Row[] } | null };

function text(value: unknown) { return String(value ?? "").trim(); }
function num(value: unknown, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function bool(value: unknown, fallback = false) { if (typeof value === "boolean") return value; const normalized = text(value).toLowerCase(); if (["true", "1", "yes", "on", "active"].includes(normalized)) return true; if (["false", "0", "no", "off", "inactive"].includes(normalized)) return false; return fallback; }
function optionalNumber(value: unknown) { if (value === null || value === undefined || value === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function dateOnly(value: unknown) { const normalized = text(value); return /^\d{4}-\d{2}-\d{2}/.test(normalized) ? normalized.slice(0, 10) : ""; }
function normalizeStatus(value: unknown) { const status = text(value).toLowerCase(); if (status === "completed") return "done"; if (status === "done" || status === "cancelled") return status; return "active"; }
function routeStatus(active: boolean, sessionStatus: unknown): RouteItem["status"] { if (!active) return "paused"; const status = text(sessionStatus).toLowerCase(); if (["cancelled", "paused", "blocked"].includes(status)) return "watch"; return "active"; }
function customerStatus(row: Row): RouteCustomerItem["status"] { if (!bool(row.active, true)) return "hidden"; return optionalNumber(row.geo_lat) == null || optionalNumber(row.geo_lng) == null ? "needs_gps" : "active"; }
function reportOverview(row?: Row) { return row?.overview && typeof row.overview === "object" && !Array.isArray(row.overview) ? row.overview as Row : {}; }
function visibleRows(rows: Row[]) { return rows.filter((row) => !isInternalSmokeRecord(row)); }

function routeData(routeRows: Row[], customerRows: Row[], latestSessions: Row[]): RoutesData {
  const latestByRoute = new Map(latestSessions.map((row) => [text(row.route_id), row] as const).filter(([id]) => Boolean(id)));
  const customerCount = new Map<string, number>();
  for (const row of customerRows) { const routeId = text(row.route_id); if (!routeId || !bool(row.active, true)) continue; customerCount.set(routeId, (customerCount.get(routeId) || 0) + 1); }
  const routes = routeRows.map((row) => {
    const id = text(row.id); const latest = latestByRoute.get(id); const active = bool(row.active, true);
    return { id, name: text(row.route_name) || "Tuyến chưa đặt tên", area: text(row.area) || "Chưa cập nhật khu vực", salesOwner: text(latest?.sales || row.sales) || "Chưa phân công", plannedCustomers: num(latest?.planned_customers, customerCount.get(id) || 0), visitedCustomers: num(latest?.visited_customers), orderCount: num(latest?.order_count), lastVisitDate: dateOnly(latest?.session_date) || "Chưa có", status: routeStatus(active, latest?.status) } satisfies RouteItem;
  }).filter((row) => row.id);
  const activeRoutes = routes.filter((route) => route.status !== "paused").length;
  return { kpis: [{ label: "Tổng tuyến", value: routes.length, hint: "Đang quản lý" }, { label: "Có thể đi", value: activeRoutes, hint: "Đang hoạt động hoặc cần theo dõi" }, { label: "Điểm bán", value: routes.reduce((sum, route) => sum + route.plannedCustomers, 0), hint: "Trong các tuyến" }, { label: "Đã ghé", value: routes.reduce((sum, route) => sum + route.visitedCustomers, 0), hint: "Theo phiên gần nhất" }], routes };
}

function routeCustomerData(routeRows: Row[], customerRows: Row[]): RouteCustomersData {
  const routeNames = new Map(routeRows.map((row) => [text(row.id), text(row.route_name)] as const).filter(([id]) => Boolean(id)));
  const customers = customerRows.map((row) => {
    const id = text(row.id); const routeId = text(row.route_id); const lat = optionalNumber(row.geo_lat); const lng = optionalNumber(row.geo_lng); const accuracy = optionalNumber(row.geo_accuracy);
    const gps = lat == null || lng == null ? undefined : { lat, lng, ...(accuracy == null ? {} : { accuracyMeters: accuracy }), updatedAt: text(row.geo_captured_at || row.updated_at) };
    return { id, routeId, routeName: routeNames.get(routeId) || "Tuyến chưa xác định", accountId: text(row.customer_id) || id, accountName: text(row.customer_name) || "Điểm bán chưa đặt tên", contactName: text(row.phone), area: text(row.area) || "Chưa cập nhật khu vực", sortOrder: num(row.sort_order), status: customerStatus(row), ...(gps ? { gps } : {}), note: [text(row.address), text(row.note)].filter(Boolean).join(" · ") } satisfies RouteCustomerItem;
  }).filter((row) => row.id && row.routeId);
  return { kpis: [{ label: "Tổng điểm bán", value: customers.length, hint: "Trong các tuyến" }, { label: "Đang hoạt động", value: customers.filter((item) => item.status === "active").length, hint: "Đủ vị trí" }, { label: "Cần GPS", value: customers.filter((item) => item.status === "needs_gps").length, hint: "Cần bổ sung vị trí" }, { label: "Đang ẩn", value: customers.filter((item) => item.status === "hidden").length, hint: "Không đưa vào phiên mới" }], customers };
}

function sessionRow(row: Row, aggregate?: Row): McpShellSessionRow { return { id: text(row.id), routeId: text(row.route_id), routeName: text(row.route_name) || "Tuyến chưa xác định", sessionDate: dateOnly(row.session_date), status: normalizeStatus(row.status), note: text(row.note) || undefined, salesOwner: text(row.sales) || "Chưa phân công", plannedCustomers: num(aggregate?.planned, num(row.planned_customers)), visitedCustomers: num(aggregate?.visited, num(row.visited_customers)), orderCount: num(aggregate?.orders, num(row.order_count)), testCount: num(aggregate?.tests, num(row.test_count)), reportCount: num(aggregate?.reports, num(row.report_count)), followupCount: num(aggregate?.followups, num(row.followup_count)) }; }

function dashboardData(routeRows: Row[], latestSessions: Row[], latestReports: Row[]): McpShellDashboard {
  const dashboardRoutes = routeRows.filter((row) => bool(row.active, true)) as DashboardRouteRow[];
  const dashboardSessions = [...latestSessions] as DashboardSessionRow[];
  const dashboardReports = [...latestReports] as DashboardReportRow[];
  const persistedRoutes = derivePersistedRouteOverview(dashboardRoutes, dashboardSessions, dashboardReports);
  const routeHealth = persistedRoutes.map((route) => ({ routeName: route.routeName, area: route.area, planned: route.planned, visited: route.visited, orders: route.orders, followups: route.followups, status: route.health, sessionId: route.sessionId, sessionState: route.sessionState }));
  const totals = routeHealth.reduce((acc, route) => { acc.planned += route.planned; acc.visited += route.visited; acc.orders += route.orders; acc.followups += route.followups; return acc; }, { planned: 0, visited: 0, orders: 0, followups: 0 });
  const rate = totals.planned > 0 ? Math.round(totals.visited / totals.planned * 100) : 0;
  const actions: McpShellAction[] = persistedRoutes.flatMap((route) => route.health === "good" ? [] : [{ title: route.sessionState === "none" ? `Lập phiên cho ${route.routeName}` : route.sessionState === "cancelled" ? `Kiểm tra phiên đã hủy tại ${route.routeName}` : route.health === "risk" ? `Kiểm tra độ phủ ${route.routeName}` : `Hoàn tất khách chưa ghé tại ${route.routeName}`, description: `${route.visited}/${route.planned || "-"} khách đã ghé trong phiên gần nhất.`, priority: route.health === "risk" ? "high" : "medium", owner: "Phụ trách tuyến" } satisfies McpShellAction]);
  const sorted = [...dashboardSessions].sort(compareSessionsNewestFirst); const businessDate = vietnamBusinessDate(); const latestRaw = sorted.find((row) => text(row.status) === "active" && dateOnly(row.session_date) === businessDate) || sorted[0]; const persistedLatest = persistedRoutes.find((route) => route.sessionId === text(latestRaw?.id));
  const latestSession = latestRaw ? { ...sessionRow(latestRaw), plannedCustomers: persistedLatest?.planned ?? num(latestRaw.planned_customers), visitedCustomers: persistedLatest?.visited ?? num(latestRaw.visited_customers), orderCount: persistedLatest?.orders ?? num(latestRaw.order_count), followupCount: persistedLatest?.followups ?? num(latestRaw.followup_count) } : null;
  const reportRaw = latestRaw ? dashboardReports.find((row) => text(row.session_id) === text(latestRaw.id)) : undefined;
  let latestReport: McpShellLatestReport | null = null;
  if (reportRaw) { const overview = reportOverview(reportRaw); latestReport = { id: text(reportRaw.id), routeName: text(reportRaw.route_name) || latestSession?.routeName || "MCP", sessionDate: dateOnly(reportRaw.session_date || reportRaw.snapshot_at), planned: num(overview.planned), visited: num(overview.visited), orders: persistedLatest?.reportId === text(reportRaw.id) ? persistedLatest.orders : num(overview.orders), tests: num(overview.tests), observations: num(overview.observations), followups: persistedLatest?.reportId === text(reportRaw.id) ? persistedLatest.followups : num(overview.followups) }; }
  return { kpis: [{ label: "Tuyến cần điều hành", value: routeHealth.length, hint: "Dữ liệu đã lưu", trend: "Dữ liệu đã lưu" }, { label: "Khách đã ghé", value: totals.visited, hint: "Theo phiên MCP", trend: `${rate}% độ phủ` }, { label: "Đơn đã ghi", value: totals.orders, hint: "Theo phiên MCP", trend: "Theo phiên MCP" }, { label: "Việc theo dõi", value: totals.followups, hint: "Theo phiên MCP", trend: "Theo phiên MCP" }], routeHealth, actions, latestSession, latestReport };
}

function normalizeSnapshot(raw: NonNullable<BackendPayload["snapshot"]>): McpShellSnapshot {
  const routes = visibleRows(Array.isArray(raw.routes) ? raw.routes : []); const routeIds = new Set(routes.map((row) => text(row.id)).filter(Boolean));
  const customers = visibleRows(Array.isArray(raw.routeCustomers) ? raw.routeCustomers : []).filter((row) => routeIds.has(text(row.route_id)));
  const latestSessions = visibleRows(Array.isArray(raw.latestSessions) ? raw.latestSessions : []).filter((row) => routeIds.has(text(row.route_id)));
  const latestSessionIds = new Set(latestSessions.map((row) => text(row.id)).filter(Boolean));
  const latestReports = visibleRows(Array.isArray(raw.latestReports) ? raw.latestReports : []).filter((row) => latestSessionIds.has(text(row.session_id)));
  const recentSessions = visibleRows(Array.isArray(raw.recentSessions) ? raw.recentSessions : []).filter((row) => routeIds.has(text(row.route_id)));
  const aggregateBySession = new Map((Array.isArray(raw.recentSessionAggregates) ? raw.recentSessionAggregates : []).map((row) => [text(row.session_id), row] as const).filter(([id]) => Boolean(id)));
  const routeOptions = routes.map((row) => ({ id: text(row.id), name: text(row.route_name) || text(row.id) })).filter((row) => row.id).sort((a, b) => a.name.localeCompare(b.name));
  return { generatedAt: text(raw.generatedAt) || new Date().toISOString(), routesData: routeData(routes, customers, latestSessions), routeCustomersData: routeCustomerData(routes, customers), dashboard: dashboardData(routes, latestSessions, latestReports), recentSessions: { days: Math.max(1, Math.min(90, Math.trunc(num(raw.recentSessionDays, 45)))), sessions: recentSessions.map((row) => sessionRow(row, aggregateBySession.get(text(row.id)))).filter((row) => row.id && row.routeId).sort((a, b) => `${b.sessionDate}-${b.routeName}`.localeCompare(`${a.sessionDate}-${a.routeName}`)), routes: routeOptions } };
}

export async function loadMcpShellDelta(cursor: string | null): Promise<{ cursor: string; unchanged: boolean; row: McpShellCacheRow | null }> {
  const target = new URL("/api/local-read/mcp-shell", `${backendApiBaseUrl()}/`); if (cursor) target.searchParams.set("cursor", cursor);
  const response = await fetch(target, { method: "GET", cache: "no-store", headers: backendApiRequestHeaders().headers });
  const payload = await response.json().catch(() => null) as { data?: BackendPayload; error?: { code?: string } } | null;
  if (!response.ok || !payload?.data) { const error = new Error(payload?.error?.code || `mcp_local_read_${response.status || 500}`); (error as Error & { statusCode?: number }).statusCode = response.status || 500; throw error; }
  const nextCursor = text(payload.data.cursor); if (!nextCursor) throw new Error("mcp_local_read_cursor_invalid");
  if (payload.data.unchanged === true) return { cursor: nextCursor, unchanged: true, row: null };
  if (!payload.data.snapshot) throw new Error("mcp_local_read_snapshot_invalid");
  return { cursor: nextCursor, unchanged: false, row: { id: "mcp-shell", snapshot: normalizeSnapshot(payload.data.snapshot) } };
}
