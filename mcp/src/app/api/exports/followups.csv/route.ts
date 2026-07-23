import { reportFilename, reportPriority, reportStatus } from "@/lib/export/business-report";
import { csvResponse, yyyyMMdd } from "@/lib/export/csv";
import { errorResponse, restRows } from "@/lib/export/supabase-rest";

type Row = Record<string, string | number | boolean | null>;

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const rows = await restRows<Row>("mcp_followups", {
      select: "id,session_id,session_customer_id,visit_id,route_id,route_customer_id,customer_id,customer_name,followup_type,title,due_date,status,priority,owner,note,created_at,updated_at",
      order: "due_date.asc,created_at.desc",
      limit: Number(params.get("limit") || 5000),
      filters: { due_date: params.get("date"), owner: params.get("owner"), status: params.get("status"), route_id: params.get("routeId") }
    });
    return csvResponse(reportFilename("viec-can-theo-doi", [yyyyMMdd()], "csv"), [
      { key: "due_date", header: "Ngày hẹn" },
      { key: "owner", header: "Người phụ trách" },
      { key: "customer_name", header: "Tên khách hàng" },
      { key: "followup_type", header: "Loại công việc" },
      { key: "title", header: "Việc cần làm" },
      { key: "status", header: "Trạng thái", value: (row) => reportStatus(row.status) },
      { key: "priority", header: "Mức ưu tiên", value: (row) => reportPriority(row.priority) },
      { key: "note", header: "Ghi chú" },
      { key: "route_id", header: "Mã tuyến" },
      { key: "session_id", header: "Mã phiên" },
      { key: "session_customer_id", header: "Mã điểm bán trong phiên" },
      { key: "visit_id", header: "Mã lượt ghé" },
      { key: "route_customer_id", header: "Mã điểm bán trong tuyến" },
      { key: "customer_id", header: "Mã khách hàng" },
      { key: "created_at", header: "Thời điểm tạo" },
      { key: "updated_at", header: "Cập nhật gần nhất" }
    ], rows);
  } catch (error) {
    return errorResponse(error);
  }
}
