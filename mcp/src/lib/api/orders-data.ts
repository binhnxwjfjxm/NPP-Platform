import "server-only";

import { withoutInternalSmokeRows } from "@/lib/data/internal-smoke";
import { backendReadRows } from "@/lib/api/backend-read";
import type { ApiResult, OrderDto } from "@/lib/api/api.types";

type Row = Record<string, unknown>;
type OrderItemAggregate = {
  skuCount: number;
  quantity: number;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numberOr(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dateOnly(value: unknown) {
  const normalized = text(value);
  return /^\d{4}-\d{2}-\d{2}/.test(normalized) ? normalized.slice(0, 10) : "";
}

function objectOrEmpty(value: unknown): Row {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Row;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Row : {};
    } catch {
      return {};
    }
  }
  return {};
}

function aggregateOrderItems(rows: Row[]) {
  const result = new Map<string, OrderItemAggregate>();
  for (const row of rows) {
    const orderId = text(row.order_id);
    if (!orderId) continue;
    const current = result.get(orderId) || { skuCount: 0, quantity: 0 };
    current.skuCount += 1;
    current.quantity += numberOr(row.quantity);
    result.set(orderId, current);
  }
  return result;
}

export async function loadOrdersResult(): Promise<ApiResult<OrderDto[]>> {
  const orderRowsRaw = await backendReadRows<Row>("orders", {
    select: "id,order_code,order_date,created_at,customer_name,raw_payload,area,sales,source_type,subtotal,discount_total,grand_total,status",
    order: "order_date.desc,created_at.desc",
    limit: 5000
  });
  const orderRows = withoutInternalSmokeRows(orderRowsRaw);
  const orderIds = [...new Set(orderRows.map((row) => text(row.id)).filter(Boolean))];
  const itemRows = orderIds.length
    ? await backendReadRows<Row>("order_items", {
        select: "order_id,quantity",
        filters: { order_id: `in.(${orderIds.join(",")})` },
        limit: 50000
      })
    : [];

  const itemTotals = aggregateOrderItems(itemRows);
  const data = orderRows
    .map((row) => {
      const id = text(row.id);
      const rawPayload = objectOrEmpty(row.raw_payload);
      const itemTotal = itemTotals.get(id) || { skuCount: 0, quantity: 0 };
      const subtotal = numberOr(row.subtotal);
      const discountTotal = numberOr(row.discount_total);
      const totalAmount = row.grand_total == null
        ? Math.max(subtotal - discountTotal, 0)
        : numberOr(row.grand_total);

      return {
        id,
        code: text(row.order_code) || id,
        date: dateOnly(row.order_date || row.created_at),
        accountName: text(row.customer_name) || "Khách chưa tên",
        routeName: text(rawPayload.routeName || rawPayload.route_name) || text(row.area) || "-",
        owner: text(row.sales) || "Chưa phân công",
        source: text(row.source_type) || "MCP",
        skuCount: itemTotal.skuCount,
        quantity: itemTotal.quantity,
        totalAmount,
        status: text(row.status) || "confirmed"
      } satisfies OrderDto;
    })
    .filter((order) => order.id);

  return {
    data,
    source: "api",
    receivedAt: new Date().toISOString()
  };
}
