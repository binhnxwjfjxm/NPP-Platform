import { reportFilename, reportStatus } from "@/lib/export/business-report";
import { csvResponse, yyyyMMdd } from "@/lib/export/csv";
import { errorResponse, restRows } from "@/lib/export/supabase-rest";

type Row = Record<string, string | number | boolean | null | Record<string, unknown>>;

export const dynamic = "force-dynamic";

function rawText(row: Row, path: string) {
  const raw = row.raw_payload;
  if (!raw || typeof raw !== "object") return "";
  const value = path.split(".").reduce<unknown>((acc, key) => acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined, raw);
  if (Array.isArray(value)) return value.map((item) => typeof item === "object" && item ? String((item as Record<string, unknown>).label || (item as Record<string, unknown>).value || (item as Record<string, unknown>).id || "") : String(item)).filter(Boolean).join(", ");
  return value == null ? "" : String(value);
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const rows = await restRows<Row>("market_reports", {
      select: "id,report_date,sales,market_area,route_name,market_type,total_shops,competitor_summary,price_summary,demand_summary,company_product_summary,opportunity_summary,risk_summary,next_action,note,sync_status,raw_payload,created_at,updated_at,synced_at",
      order: "report_date.desc,updated_at.desc",
      limit: Number(params.get("limit") || 5000),
      filters: { report_date: params.get("date"), sales: params.get("sales"), route_name: params.get("routeName") }
    });
    return csvResponse(reportFilename("du-lieu-thi-truong", [yyyyMMdd()], "csv"), [
      { key: "report_date", header: "Ngày ghi nhận" },
      { key: "sales", header: "Nhân viên phụ trách" },
      { key: "route_name", header: "Tuyến" },
      { key: "market_area", header: "Khu vực" },
      { key: "market_type", header: "Loại ghi nhận" },
      { key: "total_shops", header: "Số điểm bán" },
      { key: "customer_name", header: "Điểm bán", value: (row) => rawText(row, "context.customerName") },
      { key: "competitor_summary", header: "Đối thủ" },
      { key: "selected_competitors", header: "Đối thủ đã chọn", value: (row) => rawText(row, "selected.competitors") },
      { key: "company_product_summary", header: "Sản phẩm khách đang dùng" },
      { key: "selected_used_products", header: "Sản phẩm đã chọn", value: (row) => rawText(row, "selected.usedProducts") },
      { key: "price_summary", header: "Mức giá" },
      { key: "demand_summary", header: "Nhu cầu" },
      { key: "opportunity_summary", header: "Cơ hội bán hàng" },
      { key: "risk_summary", header: "Rủi ro" },
      { key: "next_action", header: "Hành động tiếp theo" },
      { key: "note", header: "Ghi chú" },
      { key: "route_customer_id", header: "Mã điểm bán trong tuyến", value: (row) => rawText(row, "context.routeCustomerId") },
      { key: "sync_status", header: "Trạng thái đồng bộ", value: (row) => reportStatus(row.sync_status as string | null) },
      { key: "created_at", header: "Thời điểm tạo" },
      { key: "updated_at", header: "Cập nhật gần nhất" },
      { key: "synced_at", header: "Thời điểm đồng bộ" }
    ], rows);
  } catch (error) {
    return errorResponse(error);
  }
}
