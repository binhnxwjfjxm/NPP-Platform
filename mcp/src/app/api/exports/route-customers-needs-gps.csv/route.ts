import { reportFilename, reportStatus, reportYesNo } from "@/lib/export/business-report";
import { csvResponse, yyyyMMdd } from "@/lib/export/csv";
import { errorResponse, restRows } from "@/lib/export/supabase-rest";

type Row = Record<string, string | number | boolean | null>;
type ExportRow = Row & { route_name?: string | null };

export const dynamic = "force-dynamic";

function needsGps(row: Row) {
  return row.geo_lat === null || row.geo_lng === null || row.geo_lat === "" || row.geo_lng === "";
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const [rows, routes] = await Promise.all([
      restRows<Row>("mcp_route_customers", {
        select: "id,route_id,customer_id,customer_name,phone,area,address,sort_order,active,note,geo_lat,geo_lng,geo_accuracy,geo_captured_at,geo_source,google_maps_url,sync_status,created_at,updated_at",
        order: "route_id.asc,sort_order.asc,customer_name.asc",
        limit: Number(params.get("limit") || 5000),
        filters: { route_id: params.get("routeId"), active: params.get("active") || "true" }
      }),
      restRows<Row>("mcp_routes", {
        select: "id,route_name",
        order: "route_name.asc",
        limit: 1000
      })
    ]);
    const routeNames = new Map(routes.map((route) => [String(route.id || ""), String(route.route_name || "")]));
    const data: ExportRow[] = rows.filter(needsGps).map((row) => ({ ...row, route_name: routeNames.get(String(row.route_id || "")) || "" }));

    return csvResponse(reportFilename("diem-ban-can-cap-nhat-vi-tri", [yyyyMMdd()], "csv"), [
      { key: "route_name", header: "Tên tuyến" },
      { key: "sort_order", header: "Thứ tự ghé" },
      { key: "customer_name", header: "Tên điểm bán" },
      { key: "phone", header: "Số điện thoại" },
      { key: "area", header: "Khu vực" },
      { key: "address", header: "Địa chỉ" },
      { key: "active", header: "Đang hoạt động", value: (row) => reportYesNo(row.active) },
      { key: "note", header: "Ghi chú" },
      { key: "id", header: "Mã điểm bán trong tuyến" },
      { key: "route_id", header: "Mã tuyến" },
      { key: "customer_id", header: "Mã khách hàng" },
      { key: "sync_status", header: "Trạng thái đồng bộ", value: (row) => reportStatus(row.sync_status) },
      { key: "created_at", header: "Thời điểm tạo" },
      { key: "updated_at", header: "Cập nhật gần nhất" }
    ], data);
  } catch (error) {
    return errorResponse(error);
  }
}
