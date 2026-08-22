import { isValidIdempotencyKey, normalizeIdempotencyKey } from "../../../../packages/contracts/index.js";
import { providerPersistence } from "./provider-runtime.js";
import {
  listAccessibleCoreCustomerLinks,
  listAccessibleCoreCustomers
} from "./customer-route-access.js";
import {
  createCoreSalesOrder,
  listCoreSalesOrders,
  readCoreSalesOrder
} from "./core-sales-client.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE_DECIMAL_PATTERN = /^(?:0*[1-9]\d{0,13})(?:\.\d{1,6})?$|^0+\.0*[1-9]\d{0,5}$/;
const ALLOWED_BODY_KEYS = new Set(["customerId", "customerAddressId", "lines", "note"]);
const ALLOWED_LINE_KEYS = new Set(["variantId", "quantity", "note"]);
const ORDER_DETAIL_CONCURRENCY = 6;

const BUSINESS_MESSAGES = Object.freeze({
  trusted_employee_required: "Cần đăng nhập bằng tài khoản nhân viên MCP.",
  idempotency_key_required: "Thiếu Idempotency-Key cho thao tác tạo đơn.",
  invalid_idempotency_key: "Idempotency-Key không đúng canonical contract.",
  invalid_order_payload: "Dữ liệu tạo đơn MCP không hợp lệ.",
  browser_commercial_authority_forbidden: "MCP chỉ được gửi khách, địa chỉ, sản phẩm, số lượng và ghi chú; giá và chính sách bán hàng do Công Ty quyết định.",
  core_customer_reference_required: "Chọn khách Công Ty và địa chỉ hợp lệ.",
  core_customer_not_owned: "Khách hàng không thuộc phạm vi phụ trách trên Công Ty.",
  order_lines_required: "Đơn phải có ít nhất một sản phẩm.",
  invalid_order_quantity: "Số lượng sản phẩm không hợp lệ."
});

function businessError(code, statusCode = 400) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  error.publicMessage = BUSINESS_MESSAGES[code] || "Không xử lý được đơn MCP.";
  return error;
}

function text(value, maxLength = null) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  if (maxLength !== null && normalized.length > maxLength) throw businessError("invalid_order_payload");
  return normalized;
}

function requireUuid(value, code) {
  const normalized = text(value)?.toLowerCase();
  if (!normalized || !UUID_PATTERN.test(normalized)) throw businessError(code);
  return normalized;
}

function canonicalIdempotencyKey(value) {
  const key = normalizeIdempotencyKey(value);
  if (!key) throw businessError("idempotency_key_required");
  if (!isValidIdempotencyKey(key)) throw businessError("invalid_idempotency_key");
  return key;
}

function assertOnlyKeys(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw businessError("invalid_order_payload");
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw businessError("browser_commercial_authority_forbidden");
  }
}

function canonicalQuantity(value) {
  const normalized = String(value ?? "").trim();
  if (!POSITIVE_DECIMAL_PATTERN.test(normalized)) throw businessError("invalid_order_quantity");
  return normalized.replace(/^0+(?=\d)/, "");
}

function normalizeSubmission(body) {
  assertOnlyKeys(body, ALLOWED_BODY_KEYS);
  const customerId = requireUuid(body.customerId, "core_customer_reference_required");
  const customerAddressId = requireUuid(body.customerAddressId, "core_customer_reference_required");
  if (!Array.isArray(body.lines) || body.lines.length === 0 || body.lines.length > 200) {
    throw businessError("order_lines_required");
  }
  const lines = body.lines.map((line) => {
    assertOnlyKeys(line, ALLOWED_LINE_KEYS);
    return Object.freeze({
      variantId: requireUuid(line.variantId, "invalid_order_payload"),
      quantity: canonicalQuantity(line.quantity),
      note: text(line.note, 2000)
    });
  });
  return Object.freeze({
    customerId,
    customerAddressId,
    note: text(body.note, 4000),
    lines: Object.freeze(lines)
  });
}

async function accessibleCustomers(client, context) {
  try {
    return await listAccessibleCoreCustomers(client, context);
  } catch (error) {
    if (error?.code === "trusted_employee_required") throw businessError("trusted_employee_required", 401);
    throw error;
  }
}

async function accessibleRouteLinks(client, context) {
  try {
    return await listAccessibleCoreCustomerLinks(client, context);
  } catch (error) {
    if (error?.code === "trusted_employee_required") throw businessError("trusted_employee_required", 401);
    throw error;
  }
}

async function resolveOrderCustomer(persistence, context, customerId, customerAddressId) {
  return persistence.withTransaction(async (client) => {
    const customers = await accessibleCustomers(client, context);
    const customer = customers.find((row) => (
      String(row.id).toLowerCase() === customerId
      && String(row.customer_address_id || "").toLowerCase() === customerAddressId
    ));
    if (!customer) throw businessError("core_customer_not_owned", 403);

    const links = await accessibleRouteLinks(client, context);
    const matchingLinks = links.filter((row) => (
      String(row.core_customer_id || "").toLowerCase() === customerId
      && String(row.core_customer_address_id || "").toLowerCase() === customerAddressId
    ));
    return Object.freeze({
      customer,
      routeCustomerId: matchingLinks.length === 1 ? String(matchingLinks[0].route_customer_id) : null
    });
  });
}

async function mapWithConcurrency(items, limit, worker) {
  if (items.length === 0) return [];
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function coreClient(options) {
  return options.coreClient || {
    create: createCoreSalesOrder,
    list: listCoreSalesOrders,
    read: readCoreSalesOrder
  };
}

export async function createDirectMcpSalesOrder(body, context, config, options = {}) {
  const submission = normalizeSubmission(body);
  const idempotencyKey = canonicalIdempotencyKey(options.idempotencyKey);
  const persistence = options.persistence || providerPersistence();
  const source = await resolveOrderCustomer(
    persistence,
    context,
    submission.customerId,
    submission.customerAddressId
  );
  const payload = Object.freeze({
    customerMode: "EXISTING",
    customerId: submission.customerId,
    customerAddressId: submission.customerAddressId,
    warehouseId: config.coreSales.defaultWarehouseId,
    deliveryMode: "DELIVERY",
    collectionPolicy: "PREPAID",
    currency: "VND",
    sourceType: "MCP",
    sourceId: idempotencyKey,
    ...(source.routeCustomerId ? { sourceOutletId: source.routeCustomerId } : {}),
    note: submission.note,
    lines: submission.lines
  });
  return coreClient(options).create(payload, context, config, {
    fetchImpl: options.fetchImpl || fetch,
    idempotencyKey
  });
}

export async function listDirectMcpSalesOrders(context, config, options = {}) {
  const persistence = options.persistence || providerPersistence();
  const customerIds = new Set(
    await persistence.withTransaction(async (client) => (
      (await accessibleCustomers(client, context)).map((row) => String(row.id).toLowerCase())
    ))
  );
  if (customerIds.size === 0) return Object.freeze([]);

  const client = coreClient(options);
  const orders = await client.list(context, config, {
    fetchImpl: options.fetchImpl || fetch,
    limit: 1000
  });
  const accessibleOrders = orders.filter((order) => (
    order?.sourceType === "MCP"
    && order?.customerId
    && customerIds.has(String(order.customerId).toLowerCase())
  ));
  const detailed = await mapWithConcurrency(
    accessibleOrders,
    ORDER_DETAIL_CONCURRENCY,
    (order) => client.read(order.id, context, config, { fetchImpl: options.fetchImpl || fetch })
  );
  return Object.freeze(detailed);
}
