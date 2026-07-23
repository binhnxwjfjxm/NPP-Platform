import { normalizeIdempotencyProviderError } from "./idempotency.js";
import { supabaseRpc } from "./supabase-adapter.js";

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function badRequest(code) {
  const error = new Error(code);
  error.statusCode = 400;
  throw error;
}

function foundationContext(context) {
  return {
    requestId: context.requestId,
    idempotencyKey: context.idempotencyKey || null,
    receivedAt: context.receivedAt || null,
    installationId: context.installation.id,
    nppCode: context.installation.nppCode,
    actorId: context.actor.id,
    actorType: context.actor.type,
    actorAuthentication: context.actor.authentication || null
  };
}

function providerBusinessCode(error) {
  const normalized = String(error?.providerMessage || "").trim().toLowerCase();
  return /^[a-z][a-z0-9_]{2,127}$/.test(normalized) ? normalized : null;
}

function normalizeMutationError(error) {
  if (normalizeIdempotencyProviderError(error)) return error;
  const code = providerBusinessCode(error);
  if (!code) return error;
  error.code = code;
  if (code.endsWith("_not_found")) error.statusCode = 404;
  else if (code.includes("already_exists") || code.includes("closed") || code.includes("read_only")) error.statusCode = 409;
  else if (code.includes("required") || code.startsWith("invalid_") || code.includes("inactive")) error.statusCode = 400;
  return error;
}

function normalizedOrderItems(value) {
  if (!Array.isArray(value) || value.length === 0) badRequest("order_items_required");
  return value.map((item) => {
    const row = object(item);
    const productName = text(row.productName || row.product_name);
    const quantity = Number(row.quantity || 0);
    const unitPrice = Number(row.unitPrice ?? row.unit_price ?? 0);
    const discount = Number(row.discount || 0);
    if (!productName) badRequest("product_name_required");
    if (!Number.isFinite(quantity) || quantity <= 0) badRequest("quantity_required");
    if (!Number.isFinite(unitPrice) || unitPrice < 0) badRequest("invalid_unit_price");
    if (!Number.isFinite(discount) || discount < 0 || discount > quantity * unitPrice) badRequest("invalid_discount");
    return {
      productId: text(row.productId || row.product_id),
      variantId: text(row.variantId || row.variant_id),
      productName,
      sku: text(row.sku),
      unit: text(row.unit),
      quantity,
      unitPrice,
      discount,
      note: text(row.note)
    };
  });
}

function normalizedCustomer(body) {
  const customerMode = String(body.customerMode || body.customer_mode || "").trim().toLowerCase();
  if (!new Set(["existing", "manual"]).has(customerMode)) badRequest("invalid_customer_mode");

  const routeCustomerId = text(body.routeCustomerId || body.route_customer_id);
  const customer = object(body.customer);
  const customerName = text(body.customerName || body.customer_name || customer.name || customer.customerName);
  const customerPhone = text(body.customerPhone || body.customer_phone || customer.phone);
  const area = text(body.area || customer.area);
  const deliveryAddress = text(body.deliveryAddress || body.delivery_address || customer.address || customer.deliveryAddress);

  if (customerMode === "existing" && !routeCustomerId) badRequest("route_customer_id_required");
  if (customerMode === "manual" && !customerName) badRequest("customer_name_required");

  return { customerMode, routeCustomerId, customerName, customerPhone, area, deliveryAddress };
}

export async function createOrder(body, context, config, options) {
  const customer = normalizedCustomer(object(body));
  const status = String(body.status || "confirmed").trim().toLowerCase();
  if (!new Set(["draft", "confirmed"]).has(status)) badRequest("invalid_order_status");

  try {
    return await supabaseRpc(config, "mcp_idempotent_create_order", {
      p_customer_mode: customer.customerMode,
      p_route_customer_id: customer.routeCustomerId,
      p_customer_name: customer.customerName,
      p_customer_phone: customer.customerPhone,
      p_area: customer.area,
      p_delivery_address: customer.deliveryAddress,
      p_sales: text(body.sales || body.owner),
      p_items: normalizedOrderItems(body.items),
      p_note: text(body.note),
      p_status: status,
      p_context: foundationContext(context)
    }, { fetchImpl: options?.fetchImpl || fetch });
  } catch (error) {
    throw normalizeMutationError(error);
  }
}
