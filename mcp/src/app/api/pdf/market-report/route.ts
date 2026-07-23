import { reportDate } from "@/lib/export/business-report";
import { errorResponse, restRows } from "@/lib/export/supabase-rest";
import { esc, htmlResponse, kv, table } from "@/lib/export/print";

type Row = Record<string, string | number | boolean | null | Record<string, unknown>>;

export const dynamic = "force-dynamic";

function asCell(value: Row[string]) {
  return typeof value === "object" ? "" : value;
}

function rawText(row: Row, path: string) {
  const raw = row.raw_payload;
  if (!raw || typeof raw !== "object") return "";
  const value = path.split(".").reduce<unknown>((acc, key) => acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined, raw);
  if (Array.isArray(value)) return value.map((item) => typeof item === "object" && item ? String((item as Record<string, unknown>).label || (item as Record<string, unknown>).value || (item as Record<string, unknown>).id || "") : String(item)).filter(Boolean).join(", ");
  return value == null ? "" : String(value);
}

function countTerms(rows: Row[], getter: (row: Row) => string) {
  const counts = new Map<string, number>();
  rows.forEach((row) => getter(row).split(",").map((item) => item.trim()).filter(Boolean).forEach((item) => counts.set(item, (counts.get(item) || 0) + 1)));
  return Array.from(counts.entries()).sort((left, right) => right[1] - left[1]).slice(0, 10).map(([name, count]) => `${name} (${count})`).join(", ");
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const rows = await restRows<Row>("market_reports", {
      select: "*",
      order: "report_date.desc,updated_at.desc",
      limit: Number(params.get("limit") || 500),
      filters: { report_date: params.get("date"), sales: params.get("sales"), route_name: params.get("routeName") }
    });
    const rawDate = params.get("date") || String(asCell(rows[0]?.report_date) || "");
    const titleDate = rawDate ? reportDate(rawDate) : "Dữ liệu gần nhất";
    const competitorTop = countTerms(rows, (row) => rawText(row, "selected.competitors") || String(row.competitor_summary || ""));
    const productTop = countTerms(rows, (row) => rawText(row, "selected.usedProducts") || String(row.company_product_summary || ""));
    const body = `<div class="head"><div><div class="brand">Báo cáo phục vụ bán hàng</div><h1>Báo cáo thị trường và cơ hội bán hàng</h1><p class="muted">Kỳ báo cáo: ${esc(titleDate)}</p></div><div>${kv([["Số ghi nhận", rows.length], ["Nhân viên phụ trách", params.get("sales") || "Tất cả"], ["Tuyến", params.get("routeName") || "Tất cả"]])}</div></div>
    <div class="grid"><section class="box"><h2>Đối thủ được ghi nhận nhiều</h2><p>${esc(competitorTop || "Chưa ghi nhận đối thủ trong kỳ.")}</p></section><section class="box"><h2>Sản phẩm hoặc nhãn hàng khách đang sử dụng</h2><p>${esc(productTop || "Chưa ghi nhận sản phẩm khách đang sử dụng.")}</p></section></div>
    <h2>Chi tiết ghi nhận thị trường</h2>${table<Row>([
      { header: "Ngày", value: (r) => reportDate(asCell(r.report_date)) },
      { header: "Nhân viên", value: (r) => asCell(r.sales) || "Chưa phân công" },
      { header: "Tuyến", value: (r) => asCell(r.route_name) },
      { header: "Điểm bán", value: (r) => rawText(r, "context.customerName") },
      { header: "Đối thủ", value: (r) => rawText(r, "selected.competitors") || asCell(r.competitor_summary) },
      { header: "Sản phẩm khách đang dùng", value: (r) => rawText(r, "selected.usedProducts") || asCell(r.company_product_summary) },
      { header: "Mức giá", value: (r) => asCell(r.price_summary) },
      { header: "Nhu cầu", value: (r) => asCell(r.demand_summary) },
      { header: "Hành động tiếp theo", value: (r) => asCell(r.next_action) },
      { header: "Ghi chú", value: (r) => asCell(r.note) }
    ], rows)}`;
    return htmlResponse(`Báo cáo thị trường và cơ hội bán hàng - ${titleDate}`, body, { pageSize: "A5", orientation: "landscape", backHref: "/", compact: true });
  } catch (error) {
    return errorResponse(error);
  }
}
