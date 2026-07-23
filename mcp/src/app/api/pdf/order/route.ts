import type { OrderDetailDto } from "@/lib/api/api.types";
import { backendApiBaseUrl, backendApiRequestHeaders } from "@/lib/api/backend-proxy";
import { reportDate, reportSource, reportStatus } from "@/lib/export/business-report";
import { errorResponse } from "@/lib/export/supabase-rest";
import { esc, htmlResponse, kv, money } from "@/lib/export/print";

export const dynamic = "force-dynamic";

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function orderItemsTable(order: OrderDetailDto) {
  const rows = order.items.length
    ? order.items.map((item, index) => {
      const itemMeta = [item.sku, item.unit, item.note].map((value) => String(value || "").trim()).filter(Boolean).join(" · ");
      return `<tr>
        <td class="center">${index + 1}</td>
        <td><b>${esc(item.productName)}</b>${itemMeta ? `<span class="item-sub">${esc(itemMeta)}</span>` : ""}</td>
        <td class="right">${esc(number(item.quantity))}</td>
        <td class="right">${esc(money(item.unitPrice))}</td>
        <td class="right">${item.discount > 0 ? esc(money(item.discount)) : "-"}</td>
        <td class="right"><b>${esc(money(item.lineTotal))}</b></td>
      </tr>`;
    }).join("")
    : `<tr><td colspan="6" class="center muted">Đơn hàng chưa có sản phẩm</td></tr>`;

  return `<table aria-label="Sản phẩm trong đơn">
    <colgroup><col style="width:7%"/><col style="width:37%"/><col style="width:10%"/><col style="width:16%"/><col style="width:13%"/><col style="width:17%"/></colgroup>
    <thead><tr><th class="center">STT</th><th>Sản phẩm</th><th class="right">SL</th><th class="right">Đơn giá</th><th class="right">Giảm</th><th class="right">Thành tiền</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

async function loadOrderDetail(request: Request, orderId: string) {
  const targetUrl = new URL(`/api/orders/${encodeURIComponent(orderId)}`, `${backendApiBaseUrl()}/`);
  const { headers } = backendApiRequestHeaders(request);
  const response = await fetch(targetUrl, { cache: "no-store", headers });
  const payload = await response.json().catch(() => ({})) as { data?: OrderDetailDto; error?: unknown; detail?: string };
  if (!response.ok || !payload.data) {
    const message = typeof payload.detail === "string" && payload.detail ? payload.detail : `order_detail_${response.status}`;
    throw new Error(message);
  }
  return payload.data;
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const orderId = String(params.get("orderId") || "").trim();
    if (!orderId) throw new Error("order_id_required");

    const order = await loadOrderDetail(request, orderId);
    const xlsxHref = `/api/backend/exports/orders.csv?orderId=${encodeURIComponent(order.id)}`;
    const backHref = `/orders?detail=${encodeURIComponent(order.id)}`;
    const body = `<div class="head">
      <div><div class="brand">CÔNG TY TNHH TM NGUYÊN LIỆU HƯNG PHÁT</div><h1>PHIẾU ĐƠN HÀNG</h1><p class="muted">152 Yersin, Phường Đạo Thạnh, Tỉnh Đồng Tháp · 0396 980 168</p></div>
      <div>${kv([["Mã đơn", order.code], ["Ngày đơn", reportDate(order.date)], ["Trạng thái", reportStatus(order.status)]])}</div>
    </div>
    <div class="summary-grid">
      <section class="box"><h3>Thông tin khách hàng</h3>${kv([["Khách hàng", order.accountName], ["Điện thoại", order.customerPhone || "Chưa có"], ["Khu vực / tuyến", order.routeName || order.area || "Chưa có"], ["Địa chỉ giao", order.deliveryAddress || "Chưa có"]])}</section>
      <section class="box"><h3>Thông tin đơn</h3>${kv([["Nhân viên", order.owner || "Chưa phân công"], ["Nguồn đơn", reportSource(order.source)], ["Số dòng hàng", order.items.length], ["Tổng số lượng", order.quantity]])}</section>
    </div>
    <h2>Sản phẩm</h2>${orderItemsTable(order)}
    <section class="box totals">${kv([["Tạm tính", money(order.subtotal)], ["Giảm giá", order.discountTotal > 0 ? `-${money(order.discountTotal)}` : "-"], ["Tổng cộng", money(order.totalAmount)]])}</section>
    ${order.note ? `<section class="box"><h3>Ghi chú đơn</h3><p>${esc(order.note)}</p></section>` : ""}
    <div class="signatures"><div class="signature"><b>Khách hàng</b><span>Ký và ghi rõ họ tên</span></div><div class="signature"><b>Nhân viên lập đơn</b><span>Ký và ghi rõ họ tên</span></div><div class="signature"><b>Kho / giao hàng</b><span>Ký và ghi rõ họ tên</span></div></div>`;

    return htmlResponse(`Phiếu đơn hàng ${order.code}`, body, {
      pageSize: "A5",
      orientation: "portrait",
      backHref,
      downloadHref: xlsxHref,
      downloadLabel: "Tải XLSX",
      compact: true
    });
  } catch (error) {
    return errorResponse(error);
  }
}
