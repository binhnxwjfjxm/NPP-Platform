import { reportFilename, reportStatus, reportYesNo } from "@/lib/export/business-report";
import { csvResponse, yyyyMMdd } from "@/lib/export/csv";
import { errorResponse, restRows } from "@/lib/export/supabase-rest";

type Row = Record<string, string | number | boolean | null>;
type ExportRow = Row & { route_name?: string | null };

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const [rows, routes] = await Promise.all([
      restRows<Row>("mcp_route_customers", {
        select: "id,route_id,customer_id,customer_name,phone,area,address,sort_order,active,note,geo_lat,geo_lng,geo_accuracy,geo_captured_at,geo_source,google_maps_url,sync_status,created_at,updated_at",
        order: "route_id.asc,sort_order.asc,customer_name.asc",
        limit: Number(params.get("limit") || 10000),
        filters: {
          id: params.get("id"),
          route_id: params.get("routeId") || params.get("route_id"),
          active: params.get("active")
        }
      }),
      restRows<Row>("mcp_routes", {
        select: "id,route_name",
        order: "route_name.asc",
        limit: 1000
      })
    ]);
    const routeNames = new Map(routes.map((route) => [String(route.id || ""), String(route.route_name || "")]));
    const data: ExportRow[] = rows.map((row) => ({ ...row, route_name: routeNames.get(String(row.route_id || "")) || "" }));

    return csvResponse(reportFilename("danh-sach-diem-ban", [yyyyMMdd()], "csv"), [
      { key: "route_name", header: "Tên tuyến" },
      { key: "sort_order", header: "Thứ tự ghé" },
      { key: "customer_name", header: "Tên điểm bán" },
      { key: "phone", header: "Số điện thoại" },
      { key: "area", header: "Khu vực" },
      { key: "address", header: "Địa chỉ" },
      { key: "active", header: "Đang hoạt động", value: (row) => reportYesNo(row.active) },
      { key: "google_maps_url", header: "Liên kết Google Maps" },
      { key: "geo_lat", header: "Vĩ độ" },
      { key: "geo_lng", header: "Kinh độ" },
      { key: "geo_accuracy", header: "Độ chính xác vị trí (mét)" },
      { key: "geo_captured_at", header: "Thời điểm cập nhật vị trí" },
      { key: "geo_source", header: "Cách ghi nhận vị trí" },
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
