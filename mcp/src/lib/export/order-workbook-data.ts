import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { reportDate, reportFilename, reportSource, reportStatus } from "@/lib/export/business-report";
import { buildOrderWorkbook, type OrderWorkbookData } from "@/lib/export/order-workbook";
import { errorResponse, restRows } from "@/lib/export/supabase-rest";

type Row = Record<string, unknown>;

const COMPANY = {
  name: "CÔNG TY TNHH TM NGUYÊN LIỆU HƯNG PHÁT",
  address: "152 Yersin, Phường Đạo Thạnh, Tỉnh Đồng Tháp",
  phone: "0396 980 168"
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function object(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function pickText(source: Row, keys: string[]) {
  for (const key of keys) {
    const value = text(source[key]);
    if (value) return value;
  }
  return "";
}

function pickNumber(source: Row, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (value == null || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function safeIds(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter((value) => /^[A-Za-z0-9_.:-]+$/.test(value))));
}

function inFilter(values: string[]) {
  const ids = safeIds(values);
  return ids.length ? `in.(${ids.join(",")})` : null;
}

function measure(label: string, units: string[]) {
  if (!label) return "";
  const unitPattern = units.map((unit) => unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const match = label.match(new RegExp(`\\b\\d+(?:[.,]\\d+)?\\s*(?:${unitPattern})\\b`, "i"));
  return match ? match[0].replace(/\s+/g, " ") : "";
}

function locationUrl(latitude: number | null, longitude: number | null, stored: string) {
  if (stored) return stored;
  if (latitude == null || longitude == null) return "";
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

function routeSessionLabel(routeName: string, sessionDate: string) {
  return [routeName, sessionDate ? `Phiên ${reportDate(sessionDate)}` : ""].filter(Boolean).join(" · ");
}

async function firstRow(table: string, select: string, filters: Record<string, string | null>) {
  const rows = await restRows<Row>(table, { select, limit: 1, filters });
  return rows[0] || {};
}

export async function orderWorkbookResponse(orderId: string | null, orderCode: string | null) {
  try {
    if (!orderId && !orderCode) throw new Error("order_not_found");

    const orders = await restRows<Row>("orders", {
      select: "*",
      order: "order_date.desc,created_at.desc",
      limit: 1,
      filters: { id: orderId, order_code: orderCode }
    });
    const order = orders[0];
    if (!order) throw new Error("order_not_found");

    const items = await restRows<Row>("order_items", {
      select: "*",
      order: "created_at.asc",
      limit: 500,
      filters: { order_id: text(order.id) }
    });

    const variantIds = safeIds(items.map((item) => text(item.variant_id)).filter(Boolean));
    const variants = variantIds.length ? await restRows<Row>("product_variants", {
      select: "id,product_id,sku,variant_name,size_label,sell_unit,pack_unit,pack_quantity,raw_options,raw_payload",
      limit: 1000,
      filters: { id: inFilter(variantIds) }
    }) : [];
    const variantsById = new Map(variants.map((variant) => [text(variant.id), variant]));

    const productIds = safeIds([
      ...items.map((item) => text(item.product_id)),
      ...variants.map((variant) => text(variant.product_id))
    ].filter(Boolean));
    const products = productIds.length ? await restRows<Row>("products", {
      select: "id,name,brand_code,brand_name,category,raw_payload",
      limit: 1000,
      filters: { id: inFilter(productIds) }
    }) : [];
    const productsById = new Map(products.map((product) => [text(product.id), product]));

    const orderRaw = object(order.raw_payload);
    const sourceType = text(order.source_type).toLowerCase();
    const sourceId = text(order.source_id);
    let sessionCustomer: Row = {};
    if (sourceType === "mcp_session_customer" && sourceId) {
      sessionCustomer = await firstRow(
        "mcp_session_customers",
        "id,session_id,route_id,route_customer_id,customer_id,customer_name,phone,area,address,note,raw_payload",
        { id: sourceId }
      );
    }

    const routeCustomerId = text(sessionCustomer.route_customer_id)
      || pickText(orderRaw, ["routeCustomerId", "route_customer_id"])
      || (sourceType === "orders_tab" ? sourceId : "");
    let routeCustomer: Row = {};
    if (routeCustomerId) {
      routeCustomer = await firstRow(
        "mcp_route_customers",
        "id,route_id,customer_id,customer_name,phone,area,address,note,geo_lat,geo_lng,geo_accuracy,geo_captured_at,geo_source,google_maps_url,raw_payload",
        { id: routeCustomerId }
      );
    } else if (text(order.customer_id)) {
      routeCustomer = await firstRow(
        "mcp_route_customers",
        "id,route_id,customer_id,customer_name,phone,area,address,note,geo_lat,geo_lng,geo_accuracy,geo_captured_at,geo_source,google_maps_url,raw_payload",
        { customer_id: text(order.customer_id) }
      );
    }

    const routeId = text(routeCustomer.route_id)
      || text(sessionCustomer.route_id)
      || pickText(orderRaw, ["routeId", "route_id"]);
    const sessionId = text(sessionCustomer.session_id)
      || pickText(orderRaw, ["sessionId", "session_id"]);
    const route = routeId ? await firstRow("mcp_routes", "id,route_name,area,note", { id: routeId }) : {};
    const session = sessionId ? await firstRow("mcp_route_sessions", "id,route_id,session_date,status,sales,area,note", { id: sessionId }) : {};

    const routeName = text(route.route_name)
      || pickText(orderRaw, ["routeName", "route_name"])
      || text(order.area);
    const sessionDate = text(session.session_date).slice(0, 10);
    const latitude = nullableNumber(routeCustomer.geo_lat);
    const longitude = nullableNumber(routeCustomer.geo_lng);
    const googleMapsUrl = locationUrl(latitude, longitude, text(routeCustomer.google_maps_url));

    const workbookItems: OrderWorkbookData["items"] = items.map((item) => {
      const raw = object(item.raw_payload);
      const variantId = text(item.variant_id);
      const variant = variantsById.get(variantId) || {};
      const variantRaw = { ...object(variant.raw_payload), ...object(variant.raw_options) };
      const productId = text(item.product_id) || text(variant.product_id);
      const product = productsById.get(productId) || {};
      const productRaw = object(product.raw_payload);
      const sizeLabel = pickText(raw, ["sizeLabel", "size_label", "size", "capacity", "weight"])
        || text(variant.size_label)
        || pickText(variantRaw, ["sizeLabel", "size_label", "size", "capacity", "weight"]);
      const volume = pickText(raw, ["volume", "capacity", "dungTich", "dung_tich"])
        || pickText(variantRaw, ["volume", "capacity", "dungTich", "dung_tich"])
        || measure(sizeLabel, ["ml", "l", "lit", "lít"]);
      const weight = pickText(raw, ["weight", "netWeight", "net_weight", "khoiLuong", "khoi_luong"])
        || pickText(variantRaw, ["weight", "netWeight", "net_weight", "khoiLuong", "khoi_luong"])
        || measure(sizeLabel, ["mg", "g", "gr", "kg"]);
      return {
        sku: text(item.sku) || text(variant.sku),
        productName: text(item.product_name) || text(product.name),
        brand: pickText(raw, ["brandName", "brand_name", "brand"])
          || pickText(product, ["brand_name", "brand_code"])
          || pickText(productRaw, ["brandName", "brand_name", "brand"]),
        volume,
        weight,
        unit: text(item.unit) || text(variant.sell_unit),
        quantity: number(item.quantity),
        unitPrice: number(item.unit_price),
        discount: number(item.discount),
        lineTotal: number(item.line_total),
        note: text(item.note),
        productId,
        variantId
      };
    });

    const shippingFee = pickNumber(orderRaw, ["shippingFee", "shipping_fee", "deliveryFee", "delivery_fee"]);
    const paidAmount = pickNumber(orderRaw, ["paidAmount", "paid_amount", "amountPaid", "amount_paid"]);
    const data: OrderWorkbookData = {
      company: COMPANY,
      order: {
        id: text(order.id),
        code: text(order.order_code) || text(order.id),
        date: text(order.order_date).slice(0, 10),
        source: reportSource(text(order.source_type)),
        sales: text(order.sales),
        status: reportStatus(text(order.status)),
        paymentMethod: pickText(orderRaw, ["paymentMethod", "payment_method", "paymentType", "payment_type"]) || "Chưa xác định",
        routeSession: routeSessionLabel(routeName, sessionDate),
        note: text(order.note),
        deliveryNote: pickText(orderRaw, ["deliveryNote", "delivery_note", "shippingNote", "shipping_note"]),
        customerId: text(order.customer_id) || text(routeCustomer.customer_id),
        customerName: text(order.customer_name) || text(routeCustomer.customer_name),
        customerPhone: text(order.customer_phone) || text(routeCustomer.phone),
        area: text(order.area) || text(routeCustomer.area),
        deliveryAddress: text(order.delivery_address) || text(routeCustomer.address),
        subtotal: number(order.subtotal),
        discountTotal: number(order.discount_total),
        shippingFee,
        grandTotal: number(order.grand_total),
        paidAmount
      },
      location: {
        latitude,
        longitude,
        source: text(routeCustomer.geo_source),
        capturedAt: text(routeCustomer.geo_captured_at),
        googleMapsUrl
      },
      route: {
        id: routeId,
        name: routeName,
        sessionId,
        sessionDate
      },
      items: workbookItems
    };

    const logoPng = await readFile(join(process.cwd(), "logo-transparent.png"));
    const workbook = buildOrderWorkbook(data, logoPng);
    const filename = reportFilename("don-hang-hung-phat", [data.order.code], "xlsx");
    const encodedFilename = encodeURIComponent(filename);
    const responseBody = new ArrayBuffer(workbook.byteLength);
    new Uint8Array(responseBody).set(workbook);
    return new Response(responseBody, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodedFilename}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
