import {
  reportDate,
  reportDateTime,
  reportFilename,
  reportMoney,
  reportPriority,
  reportStatus
} from "@/lib/export/business-report";
import { errorResponse } from "@/lib/export/supabase-rest";
import { buildSessionReportExportPayload } from "@/lib/mcp/session-report-export-v2";
import { loadMcpSessionReportSource } from "@/lib/mcp/session-report-source";

export const dynamic = "force-dynamic";

const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function html(value: unknown) {
  return text(value).replace(/[&<>"']/g, (char) => HTML_ENTITIES[char] || char);
}

function list(items: string[], empty: string) {
  const values = items.length ? items : [empty];
  return `<ul>${values.map((item) => `<li>${html(item)}</li>`).join("")}</ul>`;
}

function percent(done: number, total: number) {
  return total > 0 ? `${Math.round((done / total) * 100)}%` : "0%";
}

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const sessionId = text(query.get("sessionId") || query.get("session_id"));
    if (!sessionId) throw new Error("session_id_required");

    const source = await loadMcpSessionReportSource({ sessionId });
    const report = buildSessionReportExportPayload(source);
    const overview = report.overview;
    const customers = report.customerDetails.map((customer) => `
      <tr>
        <td>${customer.sortOrder || ""}</td>
        <td>${html(customer.customerName)}</td>
        <td>${html(customer.phone)}</td>
        <td>${html(customer.area)}</td>
        <td>${html(reportStatus(customer.visitStatus))}</td>
        <td>${customer.orders.length}</td>
        <td>${customer.tests.length}</td>
        <td>${customer.followups.length}</td>
        <td>${html(customer.statusReason || customer.note)}</td>
      </tr>`).join("");
    const orders = report.commerce.orders.map((item) => `
      <tr><td>${html(item.customerName)}</td><td>${html(item.code)}</td><td>${html(reportStatus(item.status))}</td><td>${html(reportMoney(item.total))}</td><td>${html(item.note)}</td></tr>`).join("");
    const tests = report.commerce.tests.map((item) => `
      <tr><td>${html(item.customerName)}</td><td>${html(item.productName)}</td><td>${html(reportStatus(item.status))}</td><td>${html(item.note)}</td></tr>`).join("");
    const actions = report.recommendedActions.map((item) => `${reportPriority(item.priority)}${item.customerName ? ` · ${item.customerName}` : ""}: ${item.action}${item.reason ? ` — ${item.reason}` : ""}`);

    const document = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <title>Báo cáo kết quả phiên bán hàng - ${html(report.session.routeName)}</title>
  <style>
    body{font-family:Arial,sans-serif;font-size:11pt;color:#1f2937;line-height:1.45;margin:32px}
    h1{font-size:20pt;margin:0 0 6px} h2{font-size:14pt;margin:24px 0 8px}
    .muted{color:#6b7280}.summary{border:1px solid #d1d5db;padding:12px;margin:14px 0;background:#f8fafc}
    table{width:100%;border-collapse:collapse;margin:8px 0 18px} th,td{border:1px solid #d1d5db;padding:6px;vertical-align:top} th{background:#eef2f7;text-align:left}
    .metrics td{width:25%;text-align:center}.metrics strong{display:block;font-size:15pt}ul{margin-top:6px}
  </style>
</head>
<body>
  <h1>Báo cáo kết quả phiên bán hàng</h1>
  <div class="muted">${html(report.session.routeName || "Tuyến chưa đặt tên")} · Ngày ${html(reportDate(report.session.sessionDate))} · Nhân viên ${html(report.session.sales || "Chưa phân công")}</div>

  <table class="metrics">
    <tr>
      <td><strong>${overview.planned}</strong>Điểm bán kế hoạch</td>
      <td><strong>${overview.visited}</strong>Đã ghé</td>
      <td><strong>${percent(overview.visited, overview.planned)}</strong>Tỷ lệ hoàn thành</td>
      <td><strong>${overview.orders}</strong>Đơn hàng</td>
    </tr>
    <tr>
      <td><strong>${overview.pending}</strong>Chờ ghé</td>
      <td><strong>${overview.skipped}</strong>Bỏ qua</td>
      <td><strong>${overview.tests}</strong>Lượt thử sản phẩm</td>
      <td><strong>${overview.followups}</strong>Việc cần theo dõi</td>
    </tr>
  </table>

  <div class="summary"><strong>Nhận định chung</strong><br>${html(report.insights.summary || "Chưa có nhận định tổng hợp cho phiên này.")}</div>

  <h2>Cảnh báo cần chú ý</h2>
  ${list(report.warnings, "Không có cảnh báo nổi bật.")}

  <h2>Việc nên thực hiện tiếp theo</h2>
  ${list(actions, "Chưa có việc cần thực hiện thêm.")}

  <h2>Đơn hàng phát sinh</h2>
  <table><thead><tr><th>Khách hàng</th><th>Mã đơn</th><th>Trạng thái</th><th>Giá trị</th><th>Ghi chú</th></tr></thead><tbody>${orders || '<tr><td colspan="5">Phiên này chưa phát sinh đơn hàng.</td></tr>'}</tbody></table>

  <h2>Kết quả thử sản phẩm</h2>
  <table><thead><tr><th>Khách hàng</th><th>Sản phẩm</th><th>Kết quả</th><th>Ghi chú</th></tr></thead><tbody>${tests || '<tr><td colspan="4">Phiên này chưa có kết quả thử sản phẩm.</td></tr>'}</tbody></table>

  <h2>Chi tiết điểm bán (${report.customerDetails.length}/${overview.planned})</h2>
  <table>
    <thead><tr><th>STT</th><th>Điểm bán</th><th>Số điện thoại</th><th>Khu vực</th><th>Kết quả ghé</th><th>Đơn</th><th>Thử SP</th><th>Theo dõi</th><th>Ghi chú</th></tr></thead>
    <tbody>${customers || '<tr><td colspan="9">Chưa có chi tiết điểm bán.</td></tr>'}</tbody>
  </table>

  <p class="muted">Báo cáo được lập lúc ${html(reportDateTime(report.generatedAt))}</p>
</body>
</html>`;

    const filename = reportFilename("bao-cao-phien-ban-hang", [report.session.routeName, report.session.sessionDate], "doc");
    return new Response(`\ufeff${document}`, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/msword; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
