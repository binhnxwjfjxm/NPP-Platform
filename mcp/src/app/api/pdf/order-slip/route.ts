import { reportDate, reportSource, reportStatus } from "@/lib/export/business-report";
import { errorResponse, restRows } from "@/lib/export/supabase-rest";
import { esc, htmlResponse, kv, money, table } from "@/lib/export/print";

type Row = Record<string, string | number | boolean | null>;

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const filters: Record<string, string | null> = { id: params.get("orderId"), order_code: params.get("orderCode") };
    const orders = await restRows<Row>("orders", { select: "*", order: "order_date.desc,created_at.desc", limit: 1, filters });
    const order = orders[0];
    if (!order) return htmlResponse("Không tìm thấy đơn hàng", `<h1>Không tìm thấy đơn hàng</h1><p class="muted">Hãy quay lại danh sách đơn và chọn lại đơn cần xem.</p>`);
    const items = await restRows<Row>("order_items", { select: "*", order: "created_at.asc", limit: 500, filters: { order_id: String(order.id || "") } });
    const body = `<div class="head"><div><div class="brand">Chứng từ bán hàng</div><h1>Phiếu xác nhận đơn hàng</h1><p class="muted">Mã đơn: ${esc(order.order_code || order.id)}</p></div><div>${kv([["Ngày đặt hàng", reportDate(order.order_date)], ["Trạng thái", reportStatus(order.status)], ["Nhân viên phụ trách", order.sales || "Chưa phân công"], ["Nguồn đơn", reportSource(order.source_type)]])}</div></div>
    <div class="grid"><section class="box"><h2>Thông tin khách hàng</h2>${kv([["Tên khách hàng", order.customer_name], ["Số điện thoại", order.customer_phone], ["Khu vực", order.area], ["Địa chỉ giao hàng", order.delivery_address]])}</section><section class="box"><h2>Giá trị đơn hàng</h2>${kv([["Tạm tính", money(order.subtotal)], ["Chiết khấu", money(order.discount_total)], ["Tổng thanh toán", money(order.grand_total)], ["Ghi chú", order.note || "Không có ghi chú"]])}</section></div>
    <h2>Chi tiết sản phẩm</h2>${table<Row>([
      { header: "STT", value: (_row, index) => index + 1, className: "center" },
      { header: "Sản phẩm", value: (row) => row.product_name },
      { header: "Mã hàng", value: (row) => row.sku },
      { header: "Đơn vị", value: (row) => row.unit },
      { header: "Số lượng", value: (row) => row.quantity, className: "right" },
      { header: "Đơn giá", value: (row) => money(row.unit_price), className: "right" },
      { header: "Chiết khấu", value: (row) => money(row.discount), className: "right" },
      { header: "Thành tiền", value: (row) => money(row.line_total), className: "right" },
      { header: "Ghi chú", value: (row) => row.note }
    ], items)}
    <div class="grid" style="margin-top:22px"><div class="box center"><b>Người lập đơn</b><p style="height:48px"></p><span class="muted">Ký và ghi rõ họ tên</span></div><div class="box center"><b>Khách hàng xác nhận</b><p style="height:48px"></p><span class="muted">Ký và ghi rõ họ tên</span></div></div>`;
    return htmlResponse(`Phiếu xác nhận đơn hàng - ${String(order.order_code || "")}`, body);
  } catch (error) {
    return errorResponse(error);
  }
}
