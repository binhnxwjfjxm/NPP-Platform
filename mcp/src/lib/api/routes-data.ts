import "server-only";

import type {
  RouteCustomerItem,
  RouteCustomerStatus,
  RouteCustomersData
} from "@/features/mcp/route-customers.types";
import type { RouteItem, RouteStatus, RoutesData } from "@/features/routes/routes.types";
import { backendReadRows } from "@/lib/api/backend-read";

type RouteRow = Record<string, unknown> & {
  id?: unknown;
  route_name?: unknown;
  area?: unknown;
  active?: unknown;
};

type RouteCustomerRow = Record<string, unknown> & {
  id?: unknown;
  route_id?: unknown;
  customer_id?: unknown;
  customer_name?: unknown;
  phone?: unknown;
  area?: unknown;
  address?: unknown;
  sort_order?: unknown;
  active?: unknown;
  note?: unknown;
  geo_lat?: unknown;
  geo_lng?: unknown;
  geo_accuracy?: unknown;
  geo_captured_at?: unknown;
  updated_at?: unknown;
};

type RouteSessionRow = Record<string, unknown> & {
  route_id?: unknown;
  session_date?: unknown;
  sales?: unknown;
  planned_customers?: unknown;
  visited_customers?: unknown;
  order_count?: unknown;
  status?: unknown;
  updated_at?: unknown;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numberOr(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanOr(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  const normalized = text(value).toLowerCase();
  if (["1", "true", "yes", "on", "active"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "inactive"].includes(normalized)) return false;
  return fallback;
}

function dateOnly(value: unknown) {
  const normalized = text(value);
  return /^\d{4}-\d{2}-\d{2}/.test(normalized) ? normalized.slice(0, 10) : "";
}

function routeStatus(active: boolean, sessionStatus: unknown): RouteStatus {
  if (!active) return "paused";
  const status = text(sessionStatus).toLowerCase();
  if (["cancelled", "paused", "blocked"].includes(status)) return "watch";
  return "active";
}

function customerStatus(row: RouteCustomerRow): RouteCustomerStatus {
  if (!booleanOr(row.active, true)) return "hidden";
  const lat = optionalNumber(row.geo_lat);
  const lng = optionalNumber(row.geo_lng);
  return lat == null || lng == null ? "needs_gps" : "active";
}

function latestSessionByRoute(rows: RouteSessionRow[]) {
  const latest = new Map<string, RouteSessionRow>();
  for (const row of rows) {
    const routeId = text(row.route_id);
    if (routeId && !latest.has(routeId)) latest.set(routeId, row);
  }
  return latest;
}

export async function loadRoutesData(): Promise<RoutesData> {
  const [routeRows, customerRows, sessionRows] = await Promise.all([
    backendReadRows<RouteRow>("mcp_routes", { order: "route_name.asc" }),
    backendReadRows<RouteCustomerRow>("mcp_route_customers", {
      select: "id,route_id,active,sort_order",
      order: "route_id.asc,sort_order.asc"
    }),
    backendReadRows<RouteSessionRow>("mcp_route_sessions", {
      select: "route_id,session_date,sales,planned_customers,visited_customers,order_count,status,updated_at",
      order: "session_date.desc,updated_at.desc"
    })
  ]);

  const activeCustomersByRoute = new Map<string, number>();
  for (const customer of customerRows) {
    const routeId = text(customer.route_id);
    if (!routeId || !booleanOr(customer.active, true)) continue;
    activeCustomersByRoute.set(routeId, (activeCustomersByRoute.get(routeId) || 0) + 1);
  }

  const latestSessions = latestSessionByRoute(sessionRows);
  const routes: RouteItem[] = routeRows
    .map((row) => {
      const id = text(row.id);
      const latest = latestSessions.get(id);
      const active = booleanOr(row.active, true);
      const activeCustomerCount = activeCustomersByRoute.get(id) || 0;
      return {
        id,
        name: text(row.route_name) || "Tuyến chưa đặt tên",
        area: text(row.area) || "Chưa cập nhật khu vực",
        salesOwner: text(latest?.sales) || "Chưa phân công",
        plannedCustomers: numberOr(latest?.planned_customers, activeCustomerCount),
        visitedCustomers: numberOr(latest?.visited_customers),
        orderCount: numberOr(latest?.order_count),
        lastVisitDate: dateOnly(latest?.session_date) || "Chưa có",
        status: routeStatus(active, latest?.status)
      } satisfies RouteItem;
    })
    .filter((route) => route.id);

  const availableRoutes = routes.filter((route) => route.status !== "paused").length;
  const plannedCustomers = routes.reduce((sum, route) => sum + route.plannedCustomers, 0);
  const visitedCustomers = routes.reduce((sum, route) => sum + route.visitedCustomers, 0);

  return {
    kpis: [
      { label: "Tổng tuyến", value: routes.length, hint: "Đang quản lý" },
      { label: "Có thể đi", value: availableRoutes, hint: "Đang hoạt động hoặc cần theo dõi" },
      { label: "Điểm bán", value: plannedCustomers, hint: "Trong các tuyến" },
      { label: "Đã ghé", value: visitedCustomers, hint: "Theo phiên gần nhất" }
    ],
    routes
  };
}

export async function loadRouteCustomersData(): Promise<RouteCustomersData> {
  const [routeRows, customerRows] = await Promise.all([
    backendReadRows<RouteRow>("mcp_routes", {
      select: "id,route_name",
      order: "route_name.asc"
    }),
    backendReadRows<RouteCustomerRow>("mcp_route_customers", {
      order: "route_id.asc,sort_order.asc"
    })
  ]);

  const routeNames = new Map(
    routeRows
      .map((row) => [text(row.id), text(row.route_name)] as const)
      .filter(([id]) => id)
  );

  const customers: RouteCustomerItem[] = customerRows
    .map((row) => {
      const id = text(row.id);
      const routeId = text(row.route_id);
      const lat = optionalNumber(row.geo_lat);
      const lng = optionalNumber(row.geo_lng);
      const status = customerStatus(row);
      const accuracy = optionalNumber(row.geo_accuracy);
      const gps = lat == null || lng == null
        ? undefined
        : {
            lat,
            lng,
            ...(accuracy == null ? {} : { accuracyMeters: accuracy }),
            updatedAt: text(row.geo_captured_at) || text(row.updated_at)
          };
      const note = [text(row.address), text(row.note)].filter(Boolean).join(" · ");

      return {
        id,
        routeId,
        routeName: routeNames.get(routeId) || "Tuyến chưa xác định",
        accountId: text(row.customer_id) || id,
        accountName: text(row.customer_name) || "Điểm bán chưa đặt tên",
        contactName: text(row.phone),
        area: text(row.area) || "Chưa cập nhật khu vực",
        sortOrder: numberOr(row.sort_order),
        status,
        ...(gps ? { gps } : {}),
        note
      } satisfies RouteCustomerItem;
    })
    .filter((customer) => customer.id && customer.routeId);

  const active = customers.filter((customer) => customer.status === "active").length;
  const needsGps = customers.filter((customer) => customer.status === "needs_gps").length;
  const hidden = customers.filter((customer) => customer.status === "hidden").length;

  return {
    kpis: [
      { label: "Tổng điểm bán", value: customers.length, hint: "Trong các tuyến" },
      { label: "Đang hoạt động", value: active, hint: "Đủ vị trí" },
      { label: "Cần GPS", value: needsGps, hint: "Cần bổ sung vị trí" },
      { label: "Đang ẩn", value: hidden, hint: "Không đưa vào phiên mới" }
    ],
    customers
  };
}
