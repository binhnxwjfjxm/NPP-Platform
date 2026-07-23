import { reportDate, reportFilename, reportStatus } from "@/lib/export/business-report";
import { errorResponse } from "@/lib/export/supabase-rest";
import { loadMcpSessionReportSource } from "@/lib/mcp/session-report-source";

export const dynamic = "force-dynamic";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function csvCell(value: unknown) {
  const normalized = String(value ?? "").replace(/\r?\n/g, " ");
  return `"${normalized.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const sessionId = text(query.get("sessionId") || query.get("session_id"));
    if (!sessionId) throw new Error("session_id_required");

    const source = await loadMcpSessionReportSource({ sessionId });
    const summary = source.summary;
    const header = [
      "STT", "Điểm bán", "Số điện thoại", "Khu vực", "Kết quả ghé", "Lý do",
      "Số đơn", "Mã đơn", "Doanh số đặt hàng", "Lượt thử sản phẩm", "Sản phẩm đã thử", "Kết quả thử",
      "Ghi nhận thị trường", "Việc cần theo dõi", "Ghi chú"
    ];
    const rows = source.customerDetails.map((customer, index) => {
      const orderCodes = customer.orders.map((item) => item.code || item.id).filter(Boolean).join(" | ");
      const orderTotal = customer.orders.reduce((sum, item) => sum + Number(item.total || 0), 0);
      const testProducts = customer.tests.map((item) => item.productName).filter(Boolean).join(" | ");
      const testStatuses = customer.tests.map((item) => reportStatus(item.status)).filter(Boolean).join(" | ");
      return [
        customer.sortOrder || index + 1,
        customer.customerName,
        customer.phone,
        customer.area,
        reportStatus(customer.visitStatus),
        customer.statusReason,
        customer.orders.length,
        orderCodes,
        orderTotal,
        customer.tests.length,
        testProducts,
        testStatuses,
        customer.observations.length,
        customer.followups.length,
        customer.note
      ];
    });

    const meta = [
      ["Báo cáo", "Chi tiết phiên bán hàng"],
      ["Tuyến", summary.session.routeName || "Tuyến chưa đặt tên"],
      ["Ngày phiên", reportDate(summary.session.sessionDate)],
      ["Nhân viên phụ trách", summary.session.sales || "Chưa phân công"],
      ["Trạng thái phiên", reportStatus(summary.session.status)]
    ];
    const csv = [
      ...meta.map((row) => row.map(csvCell).join(",")),
      "",
      header.map(csvCell).join(","),
      ...rows.map((row) => row.map(csvCell).join(","))
    ].join("\r\n");
    const filename = reportFilename("chi-tiet-phien-ban-hang", [summary.session.routeName, summary.session.sessionDate], "csv");

    return new Response(`\ufeff${csv}`, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
