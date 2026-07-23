import { reportFilename, reportSource, reportStatus, reportYesNo } from "@/lib/export/business-report";
import { csvResponse, yyyyMMdd } from "@/lib/export/csv";
import { errorResponse, restRows } from "@/lib/export/supabase-rest";

type Row = Record<string, string | number | boolean | null>;
type McpLine = {
  id?: string;
  sessionCustomerId?: string;
  routeCustomerId?: string;
  customerId?: string;
  accountName?: string;
  phone?: string;
  area?: string;
  address?: string;
  sortOrder?: number;
  source?: string;
  status?: string;
  statusReason?: string;
  hasOrder?: boolean;
  hasTest?: boolean;
  hasReport?: boolean;
  followupCount?: number;
  note?: string;
};
type McpDayPayload = { data?: { run?: Record<string, string>; lines?: McpLine[] } };
type CsvLine = McpLine & {
  sessionId?: string;
  routeId?: string;
  routeName?: string;
  sessionDate?: string;
  owner?: string;
  runStatus?: string;
};

export const dynamic = "force-dynamic";

function backendBaseUrl(origin: string) {
  const value = String(process.env.BACKEND_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "").trim().replace(/\/+$/, "");
  return value || origin;
}

async function findSession(params: URLSearchParams) {
  const filters: Record<string, string | null> = {
    id: params.get("sessionId"),
    route_id: params.get("routeId"),
    session_date: params.get("date")
  };
  const sessions = await restRows<Row>("mcp_route_sessions", {
    select: "*",
    order: "session_date.desc,created_at.desc",
    limit: 1,
    filters
  });
  return sessions[0] || null;
}

async function fetchChecklist(origin: string, routeId: string, date: string) {
  const url = `${backendBaseUrl(origin)}/api/mcp-day/data?routeId=${encodeURIComponent(routeId)}&date=${encodeURIComponent(date)}`;
  const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({})) as McpDayPayload;
  if (!response.ok) throw new Error((payload as { error?: string }).error || `mcp_day_data_${response.status}`);
  return payload.data;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const params = url.searchParams;
    const shouldFindSession = Boolean(params.get("sessionId") || !params.get("routeId") || !params.get("date"));
    const session = shouldFindSession ? await findSession(params) : null;
    const routeId = String(params.get("routeId") || session?.route_id || "");
    const sessionDate = String(params.get("date") || session?.session_date || "").slice(0, 10);

    if (!routeId || !sessionDate) throw new Error("missing_mcp_session_context");

    const checklist = await fetchChecklist(url.origin, routeId, sessionDate);
    const run = checklist?.run || {};
    const rows: CsvLine[] = (checklist?.lines || []).map((line) => ({
      ...line,
      sessionId: run.id || String(session?.id || params.get("sessionId") || ""),
      routeId: run.routeId || routeId,
      routeName: run.routeName || String(session?.route_name || ""),
      sessionDate: run.date || sessionDate,
      owner: run.owner || String(session?.sales || ""),
      runStatus: run.status || String(session?.status || "")
    }));

    return csvResponse(reportFilename("chi-tiet-phien-ban-hang", [sessionDate || yyyyMMdd()], "csv"), [
      { key: "sessionDate", header: "Ngày phiên" },
      { key: "routeName", header: "Tên tuyến" },
      { key: "owner", header: "Nhân viên phụ trách" },
      { key: "runStatus", header: "Trạng thái phiên", value: (row) => reportStatus(row.runStatus) },
      { key: "sortOrder", header: "Thứ tự ghé" },
      { key: "accountName", header: "Tên điểm bán" },
      { key: "phone", header: "Số điện thoại" },
      { key: "area", header: "Khu vực" },
      { key: "address", header: "Địa chỉ" },
      { key: "source", header: "Nguồn điểm bán", value: (row) => reportSource(row.source) },
      { key: "status", header: "Kết quả ghé", value: (row) => reportStatus(row.status) },
      { key: "statusReason", header: "Lý do" },
      { key: "hasOrder", header: "Có đơn hàng", value: (row) => reportYesNo(row.hasOrder) },
      { key: "hasTest", header: "Có thử sản phẩm", value: (row) => reportYesNo(row.hasTest) },
      { key: "hasReport", header: "Có ghi nhận thị trường", value: (row) => reportYesNo(row.hasReport) },
      { key: "followupCount", header: "Số việc cần theo dõi" },
      { key: "note", header: "Ghi chú" },
      { key: "sessionId", header: "Mã phiên" },
      { key: "routeId", header: "Mã tuyến" },
      { key: "sessionCustomerId", header: "Mã điểm bán trong phiên" },
      { key: "routeCustomerId", header: "Mã điểm bán trong tuyến" },
      { key: "customerId", header: "Mã khách hàng" }
    ], rows);
  } catch (error) {
    return errorResponse(error);
  }
}
