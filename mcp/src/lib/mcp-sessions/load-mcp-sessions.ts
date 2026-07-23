import "server-only";

import { restRows } from "@/lib/export/supabase-rest";
import { isInternalSmokeRecord, withoutInternalSmokeRows } from "@/lib/data/internal-smoke";

type RouteRow = Record<string, string | number | boolean | null>;
type SessionTableRow = Record<string, string | number | boolean | null>;
type SessionCustomerRow = Record<string, string | number | boolean | null>;

export type McpSessionRow = {
  id: string;
  routeId: string;
  routeName: string;
  sessionDate: string;
  status: string;
  note?: string;
  plannedCustomers: number;
  visitedCustomers: number;
  orderCount: number;
  testCount: number;
  reportCount: number;
  followupCount: number;
};

export type McpSessionsFilters = {
  dateFrom: string;
  dateTo: string;
  routeId: string;
  status: string;
};

export type McpSessionsPayload = {
  sessions: McpSessionRow[];
  routes: { id: string; name: string }[];
  filters: McpSessionsFilters;
  kpis: { label: string; value: string | number; hint: string }[];
};

type SessionAgg = {
  planned: number;
  visited: number;
  orders: number;
  tests: number;
  reports: number;
  followups: number;
};

function cleanDate(value: string | null) {
  const date = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

function num(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeStatus(value: unknown) {
  const status = text(value).toLowerCase();
  if (status === "completed") return "done";
  if (status === "done" || status === "cancelled") return status;
  return "active";
}

function inFilter(values: string[]) {
  const clean = Array.from(new Set(values.map(text).filter(Boolean)));
  return clean.length ? `in.(${clean.join(",")})` : "";
}

function aggregateCustomers(customers: SessionCustomerRow[]) {
  return customers.reduce<Record<string, SessionAgg>>((acc, customer) => {
    const sessionId = text(customer.session_id);
    if (!sessionId) return acc;
    const current = acc[sessionId] || { planned: 0, visited: 0, orders: 0, tests: 0, reports: 0, followups: 0 };
    current.planned += 1;
    if (text(customer.visit_status) === "visited") current.visited += 1;
    if (text(customer.order_id)) current.orders += 1;
    if (text(customer.test_id)) current.tests += 1;
    if (text(customer.report_id)) current.reports += 1;
    current.followups += num(customer.followup_count);
    acc[sessionId] = current;
    return acc;
  }, {});
}

function toRouteOptions(routeRows: RouteRow[], sessions: SessionTableRow[]) {
  const map = new Map<string, string>();
  routeRows.forEach((route) => {
    const id = text(route.id);
    if (id) map.set(id, text(route.route_name) || id);
  });
  sessions.forEach((session) => {
    const id = text(session.route_id);
    if (id && !map.has(id)) map.set(id, text(session.route_name) || id);
  });
  return Array.from(map.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function toSession(row: SessionTableRow, routes: { id: string; name: string }[], agg: Record<string, SessionAgg>): McpSessionRow {
  const id = text(row.id);
  const customerAgg = agg[id];
  return {
    id,
    routeId: text(row.route_id),
    routeName: text(row.route_name) || routes.find((route) => route.id === text(row.route_id))?.name || text(row.route_id),
    sessionDate: cleanDate(text(row.session_date)),
    status: normalizeStatus(row.status),
    note: text(row.note),
    plannedCustomers: customerAgg?.planned || num(row.planned_customers),
    visitedCustomers: customerAgg?.visited || num(row.visited_customers),
    orderCount: customerAgg?.orders || num(row.order_count),
    testCount: customerAgg?.tests || num(row.test_count),
    reportCount: customerAgg?.reports || num(row.report_count),
    followupCount: customerAgg?.followups || num(row.followup_count)
  };
}

export async function loadMcpSessions(filters: McpSessionsFilters): Promise<McpSessionsPayload> {
  const dateFrom = cleanDate(filters.dateFrom);
  const dateTo = cleanDate(filters.dateTo);
  const routeId = text(filters.routeId);
  const status = text(filters.status);

  const [routesRaw, sessionsRaw] = await Promise.all([
    restRows<RouteRow>("mcp_routes", {
      select: "id,route_name,active,area,weekday",
      order: "route_name.asc",
      limit: 5000
    }),
    restRows<SessionTableRow>("mcp_route_sessions", {
      select: "id,route_id,route_name,session_date,status,planned_customers,visited_customers,order_count,test_count,report_count,followup_count,note,updated_at,created_at",
      order: "session_date.desc,updated_at.desc",
      limit: 5000,
      filters: { route_id: routeId || null }
    })
  ]);

  const visibleRoutes = withoutInternalSmokeRows(routesRaw);
  const visibleRouteIds = new Set(visibleRoutes.map((route) => text(route.id)).filter(Boolean));
  const scopedSessions = sessionsRaw
    .filter((session) => !isInternalSmokeRecord(session))
    .filter((session) => visibleRouteIds.has(text(session.route_id)))
    .filter((session) => !dateFrom || cleanDate(text(session.session_date)) >= dateFrom)
    .filter((session) => !dateTo || cleanDate(text(session.session_date)) <= dateTo)
    .filter((session) => !status || normalizeStatus(session.status) === status);

  const sessionIds = scopedSessions.map((session) => text(session.id)).filter(Boolean);
  const customerRows = sessionIds.length
    ? await restRows<SessionCustomerRow>("mcp_session_customers", {
        select: "session_id,visit_status,order_id,test_id,report_id,followup_count",
        limit: 50000,
        filters: { session_id: inFilter(sessionIds) }
      })
    : [];

  const routes = toRouteOptions(visibleRoutes, scopedSessions);
  const agg = aggregateCustomers(customerRows);
  const sessions = scopedSessions
    .map((session) => toSession(session, routes, agg))
    .sort((a, b) => `${b.sessionDate}-${b.routeName}`.localeCompare(`${a.sessionDate}-${a.routeName}`));

  const active = sessions.filter((session) => session.status === "active").length;
  const done = sessions.filter((session) => session.status === "done").length;
  const cancelled = sessions.filter((session) => session.status === "cancelled").length;
  const planned = sessions.reduce((sum, session) => sum + session.plannedCustomers, 0);
  const visited = sessions.reduce((sum, session) => sum + session.visitedCustomers, 0);

  return {
    sessions,
    routes,
    filters: { dateFrom, dateTo, routeId, status },
    kpis: [
      { label: "Phiên", value: sessions.length, hint: "DB thật" },
      { label: "Đang chạy", value: active, hint: "active" },
      { label: "Đã chốt", value: done, hint: "done" },
      { label: "Đã ghé", value: `${visited}/${planned}`, hint: "Từ session_customers" },
      { label: "Đã hủy", value: cancelled, hint: "cancelled" }
    ]
  };
}
