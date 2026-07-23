import { isInternalSmokeRecord } from "@/lib/data/internal-smoke";

export type DashboardRouteRow = {
  id: string;
  route_name?: unknown;
  area?: unknown;
  active?: unknown;
};

export type DashboardSessionRow = Record<string, unknown> & { id: string; route_id: string };
export type DashboardReportRow = Record<string, unknown> & { id: string; session_id?: unknown };

export type DashboardSessionState = "active" | "done" | "completed" | "cancelled" | "none" | "unknown";

export type PersistedRouteOverview = {
  routeId: string;
  routeName: string;
  area: string;
  sessionId: string | null;
  sessionState: DashboardSessionState;
  sessionDate: string | null;
  planned: number;
  visited: number;
  orders: number;
  followups: number;
  health: "good" | "watch" | "risk";
  reportId: string | null;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function array(value: unknown) {
  return Array.isArray(value) ? value as Record<string, unknown>[] : [];
}

function reportOverview(report: DashboardReportRow) {
  const direct = object(report.overview);
  if (Object.keys(direct).length) return direct;
  return object(object(report.sections).overview);
}

function uniqueCount(rows: Record<string, unknown>[]) {
  const ids = new Set<string>();
  let anonymous = 0;
  for (const row of rows) {
    const id = text(row.id);
    if (id) ids.add(id);
    else anonymous += 1;
  }
  return ids.size + anonymous;
}

function reportDetailCount(report: DashboardReportRow, key: "orders" | "followups") {
  const commerce = object(report.commerce);
  const overview = reportOverview(report);
  const candidates = [report[key], commerce[key], object(report.sections)[key], overview[key]];
  const details = candidates.find(Array.isArray);
  return details ? uniqueCount(array(details)) : number(overview[key]);
}

function timestamp(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function compareSessionsNewestFirst(left: DashboardSessionRow, right: DashboardSessionRow) {
  const leftSmoke = isInternalSmokeRecord(left);
  const rightSmoke = isInternalSmokeRecord(right);
  if (leftSmoke !== rightSmoke) return leftSmoke ? 1 : -1;
  const date = text(right.session_date).localeCompare(text(left.session_date));
  if (date) return date;
  const rightTime = timestamp(right.closed_at) || timestamp(right.updated_at) || timestamp(right.created_at);
  const leftTime = timestamp(left.closed_at) || timestamp(left.updated_at) || timestamp(left.created_at);
  if (rightTime !== leftTime) return rightTime - leftTime;
  return text(right.id).localeCompare(text(left.id));
}

function sessionState(value: unknown): DashboardSessionState {
  const status = text(value).toLowerCase();
  if (status === "active" || status === "done" || status === "completed" || status === "cancelled") return status;
  return "unknown";
}

export function vietnamBusinessDate(now: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function derivePersistedRouteOverview(
  routes: DashboardRouteRow[],
  sessions: DashboardSessionRow[],
  reports: DashboardReportRow[]
): PersistedRouteOverview[] {
  const visibleRoutes = routes.filter((route) => !isInternalSmokeRecord(route));
  const visibleRouteIds = new Set(visibleRoutes.map((route) => text(route.id)).filter(Boolean));
  const visibleSessions = sessions.filter((session) => (
    !isInternalSmokeRecord(session) && visibleRouteIds.has(text(session.route_id))
  ));
  const visibleSessionIds = new Set(visibleSessions.map((session) => text(session.id)).filter(Boolean));
  const visibleReports = reports.filter((report) => (
    !isInternalSmokeRecord(report) && visibleSessionIds.has(text(report.session_id))
  ));

  // DashboardPage continues using the same facts arrays after deriving route health.
  // Replace their contents so latest-session/report selection and visible counters
  // cannot fall back to smoke fixtures even when no business rows exist.
  routes.splice(0, routes.length, ...visibleRoutes);
  sessions.splice(0, sessions.length, ...visibleSessions);
  reports.splice(0, reports.length, ...visibleReports);

  const sessionsByRoute = new Map<string, DashboardSessionRow[]>();
  for (const session of visibleSessions) {
    const routeId = text(session.route_id);
    if (!routeId) continue;
    sessionsByRoute.set(routeId, [...(sessionsByRoute.get(routeId) || []), session]);
  }
  const reportsBySession = new Map<string, DashboardReportRow[]>();
  for (const report of visibleReports) {
    const sessionId = text(report.session_id);
    if (!sessionId) continue;
    reportsBySession.set(sessionId, [...(reportsBySession.get(sessionId) || []), report]);
  }

  return visibleRoutes.map((route) => {
    const latest = [...(sessionsByRoute.get(text(route.id)) || [])].sort(compareSessionsNewestFirst)[0];
    if (!latest) {
      return {
        routeId: text(route.id), routeName: text(route.route_name) || "Tuyến chưa đặt tên", area: text(route.area),
        sessionId: null, sessionState: "none", sessionDate: null, planned: 0, visited: 0,
        orders: 0, followups: 0, health: "watch", reportId: null
      };
    }
    const matchingReport = [...(reportsBySession.get(text(latest.id)) || [])].sort((a, b) => {
      const time = (timestamp(b.snapshot_at) || timestamp(b.updated_at) || timestamp(b.created_at)) -
        (timestamp(a.snapshot_at) || timestamp(a.updated_at) || timestamp(a.created_at));
      return time || text(b.id).localeCompare(text(a.id));
    })[0];
    const overview = matchingReport ? reportOverview(matchingReport) : {};
    const planned = matchingReport ? number(overview.planned) : number(latest.planned_customers);
    const visited = matchingReport ? number(overview.visited) : number(latest.visited_customers);
    const orders = matchingReport ? reportDetailCount(matchingReport, "orders") : number(latest.order_count);
    const followups = matchingReport ? reportDetailCount(matchingReport, "followups") : number(latest.followup_count);
    const state = sessionState(latest.status);
    const rate = planned > 0 ? Math.round(visited / planned * 100) : 0;
    const health = state === "cancelled" || state === "unknown" ? "watch" : planned > 0 && rate < 50 ? "risk" : visited < planned ? "watch" : "good";
    return {
      routeId: text(route.id), routeName: text(route.route_name) || "Tuyến chưa đặt tên", area: text(route.area),
      sessionId: text(latest.id), sessionState: state, sessionDate: text(latest.session_date) || null,
      planned, visited, orders, followups, health,
      reportId: matchingReport ? text(matchingReport.id) : null
    };
  });
}
