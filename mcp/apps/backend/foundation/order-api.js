import { unwrapIdempotentMutationResult } from "./idempotency.js";
import { createOrder } from "./order-mutations.js";
import { supabaseRest } from "./supabase-adapter.js";

const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;

function badRequest(code) {
  const error = new Error(code);
  error.statusCode = 400;
  throw error;
}

function notFound(code) {
  const error = new Error(code);
  error.statusCode = 404;
  throw error;
}

function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateOnly(value) {
  const normalized = text(value);
  return normalized ? normalized.slice(0, 10) : "";
}

function decodeOrderId(value) {
  try {
    const orderId = decodeURIComponent(value).trim();
    if (!orderId) badRequest("order_id_required");
    return orderId;
  } catch {
    badRequest("invalid_order_id");
  }
}

function orderDetailPath(pathname) {
  const match = pathname.match(/^\/api\/orders\/([^/]+)$/);
  return match ? decodeOrderId(match[1]) : null;
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_JSON_BODY_BYTES) {
      const error = new Error("request_body_too_large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    badRequest("invalid_json_body");
  }
}

function normalizeOrderItem(row) {
  const quantity = number(row.quantity);
  const unitPrice = number(row.unit_price);
  const discount = number(row.discount);
  const calculatedTotal = Math.max(quantity * unitPrice - discount, 0);
  return {
    id: text(row.id),
    productId: text(row.product_id) || null,
    variantId: text(row.variant_id) || null,
    productName: text(row.product_name) || "Sản phẩm chưa đặt tên",
    sku: text(row.sku) || null,
    unit: text(row.unit) || null,
    quantity,
    unitPrice,
    discount,
    lineTotal: row.line_total == null ? calculatedTotal : number(row.line_total),
    note: text(row.note) || null
  };
}

async function loadOrderDetail(orderId, config, fetchImpl) {
  const encodedOrderId = encodeURIComponent(orderId);
  const orderRows = await supabaseRest(
    config,
    `orders?select=id,order_code,order_date,sales,customer_id,customer_name,customer_phone,area,delivery_address,source_type,source_id,status,subtotal,discount_total,grand_total,note,raw_payload,created_at,updated_at&id=eq.${encodedOrderId}&limit=1`,
    { fetchImpl }
  );
  const order = Array.isArray(orderRows) ? orderRows[0] : null;
  if (!order) notFound("order_not_found");

  const itemRows = await supabaseRest(
    config,
    `order_items?select=id,order_id,product_id,variant_id,product_name,sku,unit,quantity,unit_price,discount,line_total,note,created_at&order_id=eq.${encodedOrderId}&order=created_at.asc,id.asc`,
    { fetchImpl }
  );
  const items = (Array.isArray(itemRows) ? itemRows : []).map(normalizeOrderItem);
  const rawPayload = order.raw_payload && typeof order.raw_payload === "object" && !Array.isArray(order.raw_payload)
    ? order.raw_payload
    : {};
  const subtotal = order.subtotal == null
    ? items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
    : number(order.subtotal);
  const discountTotal = order.discount_total == null
    ? items.reduce((sum, item) => sum + item.discount, 0)
    : number(order.discount_total);
  const totalAmount = order.grand_total == null
    ? Math.max(subtotal - discountTotal, 0)
    : number(order.grand_total);

  return {
    id: text(order.id),
    code: text(order.order_code) || text(order.id),
    date: dateOnly(order.order_date || order.created_at),
    accountName: text(order.customer_name) || "Khách chưa tên",
    customerPhone: text(order.customer_phone) || null,
    routeName: text(rawPayload.routeName) || text(order.area) || "-",
    area: text(order.area) || null,
    deliveryAddress: text(order.delivery_address) || null,
    owner: text(order.sales) || "Sale",
    source: text(order.source_type) || "order",
    status: text(order.status) || "confirmed",
    subtotal,
    discountTotal,
    totalAmount,
    note: text(order.note) || null,
    skuCount: items.length,
    quantity: items.reduce((sum, item) => sum + item.quantity, 0),
    items
  };
}

export async function handleOrderApi(req, url, context, config, { fetchImpl = fetch } = {}) {
  const method = String(req.method || "GET").toUpperCase();

  if (method === "GET") {
    const orderId = orderDetailPath(url.pathname);
    if (!orderId) return null;
    return {
      statusCode: 200,
      payload: {
        data: await loadOrderDetail(orderId, config, fetchImpl),
        receivedAt: new Date().toISOString()
      }
    };
  }

  if (method !== "POST" || url.pathname !== "/api/orders") return null;

  const result = await createOrder(await readJsonBody(req), context, config, { fetchImpl });
  const { data, meta } = unwrapIdempotentMutationResult(result);
  return {
    statusCode: 201,
    payload: {
      data,
      ...(meta ? { meta } : {}),
      receivedAt: new Date().toISOString()
    }
  };
}
