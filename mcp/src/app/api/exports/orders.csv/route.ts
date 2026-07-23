import { reportFilename, reportSource, reportStatus } from "@/lib/export/business-report";
import { csvResponse, yyyyMMdd } from "@/lib/export/csv";
import { orderWorkbookResponse } from "@/lib/export/order-workbook-data";
import { errorResponse, restRows } from "@/lib/export/supabase-rest";

type OrderRow = Record<string, string | number | boolean | null>;
type ItemRow = Record<string, string | number | boolean | null>;

type OrderSummaryRow = OrderRow & {
  product_line_count: number;
  total_quantity: number;
  product_summary: string;
  sku_summary: string;
};

type ProductDetailRow = {
  order_id: string;
  order_code: string;
  order_date: string;
  item_id: string;
  product_id: string;
  variant_id: string;
  product_name: string;
  sku: string;
  unit: string;
  quantity: number;
  unit_price: number;
  item_discount: number;
  line_total: number;
  item_note: string;
};

export const dynamic = "force-dynamic";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function itemSummary(item: ItemRow) {
  const productName = text(item.product_name) || text(item.sku) || "Sản phẩm chưa đặt tên";
  const sku = text(item.sku);
  const quantity = number(item.quantity);
  const unit = text(item.unit);
  return [productName, sku ? `[${sku}]` : "", `× ${quantity}${unit ? ` ${unit}` : ""}`].filter(Boolean).join(" ");
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const orderId = params.get("orderId") || params.get("id");
    const orderCode = params.get("orderCode");
    if (orderId || orderCode) return orderWorkbookResponse(orderId, orderCode);

    const view = params.get("view") === "items" ? "items" : "orders";
    const orders = await restRows<OrderRow>("orders", {
      select: "id,order_code,order_date,sales,customer_id,customer_name,customer_phone,area,delivery_address,source_type,source_id,status,subtotal,discount_total,grand_total,note,sync_status,created_at,updated_at",
      order: "order_date.desc,created_at.desc",
      limit: Number(params.get("limit") || 3000),
      filters: { order_date: params.get("date"), sales: params.get("sales"), status: params.get("status") }
    });
    const orderIds = new Set(orders.map((order) => text(order.id)).filter(Boolean));
    const items = await restRows<ItemRow>("order_items", {
      select: "id,order_id,product_id,variant_id,product_name,sku,unit,quantity,unit_price,discount,line_total,note,created_at",
      order: "order_id.asc,created_at.asc",
      limit: 10000
    });
    const scopedItems = items.filter((item) => orderIds.has(text(item.order_id)));
    const byOrder = scopedItems.reduce<Record<string, ItemRow[]>>((acc, item) => {
      const id = text(item.order_id);
      acc[id] = [...(acc[id] || []), item];
      return acc;
    }, {});

    if (view === "items") {
      const rows: ProductDetailRow[] = orders.flatMap((order) => {
        const orderIdValue = text(order.id);
        return (byOrder[orderIdValue] || []).map((item) => ({
          order_id: orderIdValue,
          order_code: text(order.order_code),
          order_date: text(order.order_date),
          item_id: text(item.id),
          product_id: text(item.product_id),
          variant_id: text(item.variant_id),
          product_name: text(item.product_name),
          sku: text(item.sku),
          unit: text(item.unit),
          quantity: number(item.quantity),
          unit_price: number(item.unit_price),
          item_discount: number(item.discount),
          line_total: number(item.line_total),
          item_note: text(item.note)
        }));
      });
      return csvResponse(reportFilename("chi-tiet-san-pham-theo-don", [yyyyMMdd()], "csv"), [
        { key: "order_code", header: "Mã đơn" },
        { key: "order_date", header: "Ngày đặt hàng" },
        { key: "product_name", header: "Sản phẩm" },
        { key: "sku", header: "Mã hàng" },
        { key: "variant_id", header: "Mã quy cách" },
        { key: "unit", header: "Đơn vị bán" },
        { key: "quantity", header: "Số lượng" },
        { key: "unit_price", header: "Đơn giá" },
        { key: "item_discount", header: "Chiết khấu dòng" },
        { key: "line_total", header: "Thành tiền" },
        { key: "item_note", header: "Ghi chú sản phẩm" },
        { key: "product_id", header: "Mã sản phẩm hệ thống" },
        { key: "item_id", header: "Mã dòng hàng" },
        { key: "order_id", header: "Mã đơn hệ thống" }
      ], rows);
    }

    const rows: OrderSummaryRow[] = orders.map((order) => {
      const list = byOrder[text(order.id)] || [];
      return {
        ...order,
        product_line_count: list.length,
        total_quantity: list.reduce((total, item) => total + number(item.quantity), 0),
        product_summary: list.map(itemSummary).join(" | "),
        sku_summary: unique(list.map((item) => text(item.sku))).join(", ")
      };
    });
    return csvResponse(reportFilename("danh-sach-don-hang", [yyyyMMdd()], "csv"), [
      { key: "order_code", header: "Mã đơn" },
      { key: "order_date", header: "Ngày đặt hàng" },
      { key: "sales", header: "Nhân viên phụ trách" },
      { key: "customer_name", header: "Tên khách hàng" },
      { key: "customer_phone", header: "Số điện thoại" },
      { key: "area", header: "Khu vực" },
      { key: "delivery_address", header: "Địa chỉ giao hàng" },
      { key: "status", header: "Trạng thái đơn", value: (row) => reportStatus(row.status) },
      { key: "product_line_count", header: "Số dòng sản phẩm" },
      { key: "total_quantity", header: "Tổng số lượng" },
      { key: "product_summary", header: "Sản phẩm trong đơn" },
      { key: "sku_summary", header: "Mã hàng trong đơn" },
      { key: "subtotal", header: "Tạm tính đơn" },
      { key: "discount_total", header: "Chiết khấu đơn" },
      { key: "grand_total", header: "Tổng giá trị đơn" },
      { key: "note", header: "Ghi chú đơn" },
      { key: "source_type", header: "Nguồn đơn", value: (row) => reportSource(row.source_type) },
      { key: "source_id", header: "Mã nguồn" },
      { key: "sync_status", header: "Trạng thái đồng bộ", value: (row) => reportStatus(row.sync_status) },
      { key: "created_at", header: "Thời điểm tạo" },
      { key: "updated_at", header: "Cập nhật gần nhất" }
    ], rows);
  } catch (error) {
    return errorResponse(error);
  }
}
