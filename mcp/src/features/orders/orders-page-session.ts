import type { RouteCustomerItem } from "@/features/mcp/route-customers.types";
import type { OrderSessionOption } from "./order-create.types";

type SessionStatusRow = {
  id?: unknown;
  routeId?: unknown;
  routeName?: unknown;
  sessionDate?: unknown;
  status?: unknown;
  plannedCustomers?: unknown;
  visitedCustomers?: unknown;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function count(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeSession(row: SessionStatusRow): OrderSessionOption | null {
  const id = text(row.id);
  const routeId = text(row.routeId);
  const routeName = text(row.routeName) || routeId;
  const sessionDate = text(row.sessionDate).slice(0, 10);
  const rawStatus = text(row.status).toLowerCase();
  const status = rawStatus === "active" ? "active" : rawStatus === "done" || rawStatus === "completed" ? "done" : null;
  if (!id || !routeId || !sessionDate || !status) return null;
  return {
    id,
    routeId,
    routeName,
    sessionDate,
    status,
    plannedCustomers: count(row.plannedCustomers),
    visitedCustomers: count(row.visitedCustomers)
  };
}

export async function loadOrderSessions(customers: RouteCustomerItem[]): Promise<OrderSessionOption[]> {
  const routeIds = Array.from(new Set(customers.map((customer) => customer.routeId).filter(Boolean)));
  const responses = await Promise.all(routeIds.map(async (routeId) => {
    const query = new URLSearchParams({ routeId });
    const response = await fetch(`/api/backend/mcp-settings/session-status?${query.toString()}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000)
    });
    const payload = await response.json().catch(() => ({})) as {
      data?: { sessions?: SessionStatusRow[] };
      error?: string | { message?: string };
      detail?: string;
    };
    if (!response.ok) {
      const error = typeof payload.error === "string" ? payload.error : payload.error?.message;
      throw new Error(error || payload.detail || `Không tải được phiên của tuyến ${routeId}`);
    }
    return Array.isArray(payload.data?.sessions) ? payload.data.sessions : [];
  }));

  const sessions = new Map<string, OrderSessionOption>();
  responses.flat().forEach((row) => {
    const session = normalizeSession(row);
    if (session) sessions.set(session.id, session);
  });
  return Array.from(sessions.values()).sort((left, right) => {
    if (left.status !== right.status) return left.status === "active" ? -1 : 1;
    return `${right.sessionDate}-${right.routeName}`.localeCompare(`${left.sessionDate}-${left.routeName}`, "vi");
  });
}
