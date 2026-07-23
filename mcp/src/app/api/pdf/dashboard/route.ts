import { reportDate, reportStatus } from "@/lib/export/business-report";
import { errorResponse, restRows } from "@/lib/export/supabase-rest";
import { htmlResponse, money, table } from "@/lib/export/print";

type Row = Record<string, string | number | boolean | null>;

export const dynamic = "force-dynamic";

function sum(rows: Row[], key: string) {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const date = params.get("date");
    const sessions = await restRows<Row>("mcp_route_sessions", { select: "*", order: "session_date.desc,created_at.desc", limit: 100, filters: { session_date: date } });
    const orders = await restRows<Row>("orders", { select: "*", order: "order_date.desc,created_at.desc", limit: 300, filters: { order_date: date } });
    const reports = await restRows<Row>("market_reports", { select: "*", order: "report_date.desc,created_at.desc", limit: 300, filters: { report_date: date } });
    const followups = await restRows<Row>("mcp_followups", { select: "*", order: "due_date.asc,created_at.desc", limit: 300, filters: { due_date: date } });
    const period = date ? reportDate(date) : "Dữ liệu gần nhất";
    const body = `<div class="head"><div><div class="brand">Báo cáo dành cho quản lý</div><h1>Báo cáo điều hành bán hàng</h1><p class="muted">Kỳ báo cáo: ${period}</p></div></div>
    <div class="metrics"><div class="metric"><span>Phiên bán hàng</span><b>${sessions.length}</b></div><div class="metric"><span>Điểm bán kế hoạch</span><b>${sum(sessions, "planned_customers")}</b></div><div class="metric"><span>Điểm bán đã ghé</span><b>${sum(sessions, "visited_customers")}</b></div><div class="metric"><span>Đơn hàng phát sinh</span><b>${orders.length}</b></div></div>
    <div class="metrics"><div class="metric"><span>Doanh số đặt hàng</span><b>${money(sum(orders, "grand_total"))}</b></div><div class="metric"><span>Ghi nhận thị trường</span><b>${reports.length}</b></div><div class="metric"><span>Việc cần theo dõi</span><b>${followups.length}</b></div><div class="metric"><span>Lượt thử sản phẩm</span><b>${sum(sessions, "test_count")}</b></div></div>
    <h2>Kết quả theo phiên bán hàng</h2>${table<Row>([
      { header: "Ngày", value: (r) => reportDate(r.session_date) },
      { header: "Tuyến", value: (r) => r.route_name },
      { header: "Nhân viên", value: (r) => r.sales || "Chưa phân công" },
      { header: "Điểm bán", value: (r) => r.planned_customers, className: "right" },
      { header: "Đã ghé", value: (r) => r.visited_customers, className: "right" },
      { header: "Đơn hàng", value: (r) => r.order_count, className: "right" },
      { header: "Lượt thử SP", value: (r) => r.test_count, className: "right" },
      { header: "Ghi nhận", value: (r) => r.report_count, className: "right" },
      { header: "Trạng thái", value: (r) => reportStatus(r.status) }
    ], sessions)}
    <h2>Đơn hàng gần nhất</h2>${table<Row>([
      { header: "Ngày", value: (r) => reportDate(r.order_date) },
      { header: "Mã đơn", value: (r) => r.order_code },
      { header: "Khách hàng", value: (r) => r.customer_name },
      { header: "Nhân viên", value: (r) => r.sales || "Chưa phân công" },
      { header: "Giá trị", value: (r) => money(r.grand_total), className: "right" },
      { header: "Trạng thái", value: (r) => reportStatus(r.status) }
    ], orders.slice(0, 30))}
    <h2>Việc cần theo dõi</h2>${table<Row>([
      { header: "Ngày hẹn", value: (r) => reportDate(r.due_date) },
      { header: "Khách hàng", value: (r) => r.customer_name },
      { header: "Việc cần làm", value: (r) => r.title },
      { header: "Người phụ trách", value: (r) => r.owner || "Chưa phân công" },
      { header: "Trạng thái", value: (r) => reportStatus(r.status) }
    ], followups.slice(0, 30))}`;
    return htmlResponse(`Báo cáo điều hành bán hàng - ${period}`, body, { pageSize: "A5", orientation: "landscape", backHref: "/", compact: true });
  } catch (error) {
    return errorResponse(error);
  }
}
