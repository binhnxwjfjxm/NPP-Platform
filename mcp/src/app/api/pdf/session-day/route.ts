import { reportDate, reportPriority, reportStatus } from "@/lib/export/business-report";
import { errorResponse } from "@/lib/export/supabase-rest";
import { esc, htmlResponse, money, table } from "@/lib/export/print";
import { buildSessionReportExportPayload } from "@/lib/mcp/session-report-export-v2";
import { loadMcpSessionReportSource } from "@/lib/mcp/session-report-source";

export const dynamic = "force-dynamic";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function percent(done: number, total: number) {
  return total > 0 ? `${Math.round((done / total) * 100)}%` : "0%";
}

function list(items: string[], empty: string) {
  return items.length
    ? `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`
    : `<p class="muted">${esc(empty)}</p>`;
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const sessionId = text(params.get("sessionId") || params.get("session_id"));
    const routeId = text(params.get("routeId") || params.get("route_id"));
    const date = text(params.get("date") || params.get("sessionDate") || params.get("session_date")).slice(0, 10);
    if (!sessionId && !(routeId && date)) throw new Error("session_report_source_required");

    const source = await loadMcpSessionReportSource({ sessionId, routeId, date });
    const report = buildSessionReportExportPayload(source);
    const overview = report.overview;
    const title = `Báo cáo kết quả phiên bán hàng - ${report.session.routeName || "Tuyến chưa đặt tên"}`;
    const actions = report.recommendedActions.map((item) =>
      `${reportPriority(item.priority)}${item.customerName ? ` · ${item.customerName}` : ""}: ${item.action}${item.reason ? ` — ${item.reason}` : ""}`
    );

    const body = `<div class="head"><div><div class="brand">Báo cáo điều hành bán hàng</div><h1>Báo cáo kết quả phiên bán hàng</h1><p class="muted">${esc(report.session.routeName || "Tuyến chưa đặt tên")} · ${esc(reportDate(report.session.sessionDate))}</p></div><div>${[
      ["Nhân viên phụ trách", report.session.sales || "Chưa phân công"],
      ["Trạng thái phiên", reportStatus(report.session.status)],
      ["Thời điểm lập báo cáo", reportDate(report.generatedAt)]
    ].map(([label, value]) => `<p><b>${esc(label)}</b><br>${esc(value)}</p>`).join("")}</div></div>
    <div class="metrics"><div class="metric"><span>Điểm bán kế hoạch</span><b>${overview.planned}</b></div><div class="metric"><span>Đã ghé</span><b>${overview.visited}</b></div><div class="metric"><span>Tỷ lệ hoàn thành</span><b>${percent(overview.visited, overview.planned)}</b></div><div class="metric"><span>Đơn hàng</span><b>${overview.orders}</b></div></div>
    <div class="metrics"><div class="metric"><span>Chờ ghé</span><b>${overview.pending}</b></div><div class="metric"><span>Bỏ qua</span><b>${overview.skipped}</b></div><div class="metric"><span>Lượt thử sản phẩm</span><b>${overview.tests}</b></div><div class="metric"><span>Việc cần theo dõi</span><b>${overview.followups}</b></div></div>
    <section class="box"><h2>Nhận định chung</h2><p>${esc(report.insights.summary || "Chưa có nhận định tổng hợp cho phiên này.")}</p></section>
    <div class="grid"><section class="box"><h2>Cảnh báo cần chú ý</h2>${list(report.warnings, "Không có cảnh báo nổi bật.")}</section><section class="box"><h2>Việc nên thực hiện tiếp theo</h2>${list(actions, "Chưa có việc cần thực hiện thêm.")}</section></div>
    <h2>Đơn hàng phát sinh</h2>${table([
      { header: "Khách hàng", value: (row) => row.customerName || "Khách chưa tên" },
      { header: "Mã đơn", value: (row) => row.code || row.id },
      { header: "Trạng thái", value: (row) => reportStatus(row.status) },
      { header: "Giá trị", value: (row) => money(row.total), className: "right" },
      { header: "Ghi chú", value: (row) => row.note || "" }
    ], report.commerce.orders)}
    <h2>Kết quả thử sản phẩm</h2>${table([
      { header: "Khách hàng", value: (row) => row.customerName || "Khách chưa tên" },
      { header: "Sản phẩm", value: (row) => row.productName || "Sản phẩm chưa đặt tên" },
      { header: "Kết quả", value: (row) => reportStatus(row.status) },
      { header: "Ghi chú", value: (row) => row.note || "" }
    ], report.commerce.tests)}
    <h2>Chi tiết điểm bán</h2>${table([
      { header: "STT", value: (row, index) => row.sortOrder || index + 1, className: "center" },
      { header: "Điểm bán", value: (row) => row.customerName },
      { header: "Số điện thoại", value: (row) => row.phone || "" },
      { header: "Khu vực", value: (row) => row.area || "" },
      { header: "Kết quả ghé", value: (row) => reportStatus(row.visitStatus) },
      { header: "Đơn", value: (row) => row.orders.length, className: "right" },
      { header: "Thử SP", value: (row) => row.tests.length, className: "right" },
      { header: "Theo dõi", value: (row) => row.followups.length, className: "right" },
      { header: "Ghi chú", value: (row) => row.statusReason || row.note || "" }
    ], report.customerDetails)}`;

    return htmlResponse(title, body);
  } catch (error) {
    return errorResponse(error);
  }
}
