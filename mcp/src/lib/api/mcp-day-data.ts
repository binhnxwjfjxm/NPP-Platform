import "server-only";

import type {
  DayLineSource,
  DayLineStatus,
  McpDayData,
  McpDayResult
} from "@/features/mcp-day/mcp-day.types";
import { backendReadRows } from "@/lib/api/backend-read";

type Row = Record<string, unknown>;

type McpDayQuery = {
  routeId: string;
  date?: string;
  request?: Request;
};

const DAY_LINE_STATUSES = new Set<DayLineStatus>([
  "pending",
  "visited",
  "skipped",
  "cancelled"
]);

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numberOr(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanOr(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  const normalized = text(value).toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function dateOnly(value: unknown) {
  const normalized = text(value);
  return /^\d{4}-\d{2}-\d{2}/.test(normalized) ? normalized.slice(0, 10) : "";
}

function timeOnly(value: unknown) {
  const normalized = text(value);
  if (!normalized) return "-";
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return normalized.slice(11, 16) || normalized;
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Ho_Chi_Minh"
  }).format(parsed);
}

function dayLineStatus(value: unknown, hasVisit: boolean): DayLineStatus {
  const normalized = text(value).toLowerCase() as DayLineStatus;
  if (DAY_LINE_STATUSES.has(normalized)) return normalized;
  return hasVisit ? "visited" : "pending";
}

function dayLineSource(value: unknown): DayLineSource {
  const normalized = text(value).toLowerCase();
  if (normalized === "added") return "added";
  if (normalized === "synced") return "synced";
  return "planned";
}

function nextAction(result: {
  hasOrder: boolean;
  hasTest: boolean;
  hasReport: boolean;
  followupCount: number;
}) {
  if (result.followupCount > 0) return "Theo dõi việc đã hẹn";
  if (result.hasOrder) return "Theo dõi đơn hàng";
  if (result.hasTest) return "Theo dõi kết quả test";
  if (result.hasReport) return "Xem lại báo cáo";
  return "Bổ sung kết quả ghé";
}

function emptyMcpDayData(routeId: string, sessionDate: string, routeName: string): McpDayData {
  return {
    sessionOpened: false,
    run: {
      id: "no-open-session",
      routeId,
      routeName: routeName || "Tuyến MCP",
      date: sessionDate || "-",
      owner: "-",
      status: "cancelled",
      openedAt: "-"
    },
    kpis: [
      { label: "Trong phiên", value: 0, hint: "Chưa mở phiên" },
      { label: "Đã ghé", value: 0, hint: "Chưa có kết quả" },
      { label: "Chờ xử lý", value: 0, hint: "Chưa có điểm bán" },
      { label: "Phát sinh", value: 0, hint: "Chưa thêm trong ngày" }
    ],
    lines: [],
    results: []
  };
}

export async function loadMcpDayData({ routeId, date, request }: McpDayQuery): Promise<McpDayData> {
  const normalizedRouteId = text(routeId);
  const sessionDate = dateOnly(date);
  if (!normalizedRouteId) return emptyMcpDayData("", sessionDate, "Tuyến chưa xác định");

  const [routeRows, sessionRows] = await Promise.all([
    backendReadRows<Row>("mcp_routes", {
      filters: { id: normalizedRouteId },
      limit: 1,
      request
    }),
    backendReadRows<Row>("mcp_route_sessions", {
      filters: {
        route_id: normalizedRouteId,
        ...(sessionDate ? { session_date: sessionDate } : {})
      },
      order: "session_date.desc,updated_at.desc",
      limit: 10,
      request
    })
  ]);

  const routeName = text(routeRows[0]?.route_name) || "Tuyến MCP";
  const session = sessionRows.find((row) => text(row.status).toLowerCase() === "active") || sessionRows[0];
  if (!session) return emptyMcpDayData(normalizedRouteId, sessionDate, routeName);

  const sessionId = text(session.id);
  const [snapshots, visits] = await Promise.all([
    backendReadRows<Row>("mcp_session_customers", {
      filters: { session_id: sessionId },
      order: "sort_order.asc,created_at.asc",
      limit: 2000,
      request
    }),
    backendReadRows<Row>("mcp_visits", {
      filters: { session_id: sessionId },
      order: "checkin_at.asc,created_at.asc",
      limit: 1000,
      request
    })
  ]);

  const visitById = new Map<string, Row>();
  const visitByRouteCustomer = new Map<string, Row>();
  for (const visit of visits) {
    const visitId = text(visit.id);
    const routeCustomerId = text(visit.route_customer_id);
    if (visitId) visitById.set(visitId, visit);
    if (routeCustomerId && !visitByRouteCustomer.has(routeCustomerId)) {
      visitByRouteCustomer.set(routeCustomerId, visit);
    }
  }

  const snapshotByVisitId = new Map<string, Row>();
  const snapshotByRouteCustomerId = new Map<string, Row>();
  const lines = snapshots.map((snapshot) => {
    const snapshotVisitId = text(snapshot.visit_id);
    const routeCustomerId = text(snapshot.route_customer_id);
    const visit = visitById.get(snapshotVisitId) || visitByRouteCustomer.get(routeCustomerId);
    const orderId = text(snapshot.order_id) || text(visit?.order_id);
    const testId = text(snapshot.test_id) || text(visit?.test_id);
    const reportId = text(snapshot.report_id) || text(visit?.report_id);
    const followupCount = numberOr(snapshot.followup_count);
    const status = dayLineStatus(snapshot.visit_status || snapshot.status, Boolean(visit));
    const visitId = text(visit?.id) || snapshotVisitId;

    if (visitId) snapshotByVisitId.set(visitId, snapshot);
    if (routeCustomerId) snapshotByRouteCustomerId.set(routeCustomerId, snapshot);

    return {
      id: text(snapshot.id),
      sessionCustomerId: text(snapshot.id),
      routeCustomerId: routeCustomerId || null,
      sortOrder: numberOr(snapshot.sort_order),
      accountName: text(snapshot.customer_name || snapshot.account_name) || "Khách chưa tên",
      phone: text(snapshot.phone) || undefined,
      address: text(snapshot.address) || undefined,
      area: text(snapshot.area) || "-",
      source: dayLineSource(snapshot.source),
      status,
      note: text(snapshot.note) || text(snapshot.address) || "Từ snapshot ngày",
      result: text(visit?.note) || text(snapshot.status_reason) || undefined,
      orderId: orderId || undefined,
      testId: testId || undefined,
      reportId: reportId || undefined,
      hasOrder: booleanOr(visit?.has_order, Boolean(orderId)),
      hasTest: booleanOr(visit?.has_test, Boolean(testId)),
      hasReport: booleanOr(visit?.has_report, Boolean(reportId)),
      followupCount,
      visitId: visitId || undefined,
      checkedIn: Boolean(text(snapshot.checkin_at)),
      checkinAt: text(snapshot.checkin_at) || undefined,
      checkinLat: optionalNumber(snapshot.checkin_lat),
      checkinLng: optionalNumber(snapshot.checkin_lng),
      checkinAccuracy: optionalNumber(snapshot.checkin_accuracy),
      checkinSource: text(snapshot.checkin_source) || undefined
    };
  }).filter((line) => line.id);

  const results: McpDayResult[] = visits.map((visit) => {
    const visitId = text(visit.id);
    const routeCustomerId = text(visit.route_customer_id);
    const snapshot = snapshotByVisitId.get(visitId) || snapshotByRouteCustomerId.get(routeCustomerId);
    const orderId = text(snapshot?.order_id) || text(visit.order_id);
    const testId = text(snapshot?.test_id) || text(visit.test_id);
    const reportId = text(snapshot?.report_id) || text(visit.report_id);
    const hasOrder = booleanOr(visit.has_order, Boolean(orderId));
    const hasTest = booleanOr(visit.has_test, Boolean(testId));
    const hasReport = booleanOr(visit.has_report, Boolean(reportId));
    const followupCount = numberOr(snapshot?.followup_count);
    const checkin = visit.checkin_at || visit.created_at;

    return {
      id: visitId,
      lineId: text(snapshot?.id) || routeCustomerId || visitId,
      sessionCustomerId: text(snapshot?.id) || undefined,
      routeCustomerId: routeCustomerId || null,
      accountName: text(snapshot?.customer_name || snapshot?.account_name) || "Điểm bán",
      startTime: timeOnly(checkin),
      endTime: timeOnly(checkin),
      result: text(visit.note) || text(visit.status) || "Đã ghé",
      orderId: orderId || undefined,
      testId: testId || undefined,
      reportId: reportId || undefined,
      hasOrder,
      hasTest,
      hasReport,
      followupCount,
      nextAction: nextAction({ hasOrder, hasTest, hasReport, followupCount })
    };
  }).filter((result) => result.id);

  const visited = lines.filter((line) => line.status === "visited").length;
  const pending = lines.filter((line) => line.status === "pending").length;
  const added = lines.filter((line) => line.source === "added").length;
  const rawStatus = text(session.status).toLowerCase();
  const runStatus = rawStatus === "cancelled"
    ? "cancelled"
    : ["done", "completed"].includes(rawStatus)
      ? "completed"
      : "opened";

  return {
    sessionOpened: true,
    run: {
      id: sessionId,
      routeId: text(session.route_id) || normalizedRouteId,
      routeName: text(session.route_name) || routeName,
      date: dateOnly(session.session_date) || sessionDate || "-",
      owner: text(session.sales) || "Sale",
      status: runStatus,
      openedAt: timeOnly(session.opened_at || session.created_at)
    },
    kpis: [
      { label: "Trong phiên", value: lines.length, hint: "Snapshot ngày" },
      { label: "Đã ghé", value: visited, hint: "Có kết quả" },
      { label: "Chờ xử lý", value: pending, hint: "Chưa ghé" },
      { label: "Phát sinh", value: added, hint: "Thêm trong ngày" }
    ],
    lines,
    results
  };
}
