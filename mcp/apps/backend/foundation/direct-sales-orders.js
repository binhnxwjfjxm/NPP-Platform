import { isValidIdempotencyKey, normalizeIdempotencyKey } from "../../../../packages/contracts/index.js";
import { providerPersistence } from "./provider-runtime.js";
import {
  createCoreSalesOrder,
  listCoreSalesOrders
} from "./core-sales-client.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE_DECIMAL_PATTERN = /^(?:0*[1-9]\d{0,13})(?:\.\d{1,6})?$|^0+\.0*[1-9]\d{0,5}$/;
const ALLOWED_BODY_KEYS = new Set(["customerId", "customerAddressId", "lines", "note"]);
const ALLOWED_LINE_KEYS = new Set(["variantId", "quantity", "note"]);

const BUSINESS_MESSAGES = Object.freeze({
  trusted_employee_required: "Cần đăng nhập bằng tài khoản nhân viên MCP.",
  idempotency_key_required: "Thiếu Idempotency-Key cho thao tác tạo đơn.",
  invalid_idempotency_key: "Idempotency-Key không đúng canonical contract.",
  invalid_order_payload: "Dữ liệu tạo đơn MCP không hợp lệ.",
  browser_commercial_authority_forbidden: "MCP chỉ được gửi khách, địa chỉ, sản phẩm, số lượng và ghi chú; giá và chính sách thương mại do Core quyết định.",
  core_customer_reference_required: "Chỉ được tạo đơn cho khách đã mở / liên kết mã Core.",
  core_customer_not_owned: "Khách hàng không thuộc phạm vi phụ trách của nhân viên đang đăng nhập.",
  core_customer_link_ambiguous: "Khách hàng đang liên kết với nhiều điểm bán MCP; cần làm rõ liên kết trước khi tạo đơn.",
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

function requireEmployee(context) {
  const employeeId = text(context?.principal?.employeeId)?.toLowerCase();
  if (!employeeId || !UUID_PATTERN.test(employeeId)) throw businessError("trusted_employee_required", 401);
  return employeeId;
}

function installationId(context) {
  const value = text(context?.installation?.id);
  if (!value) throw businessError("installation_id_required");
  return value;
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

async function ownedRouteCustomers(client, context) {
  const employeeId = requireEmployee(context);
  const result = await client.query(
    `SELECT rc.id AS route_customer_id,
            rc.core_customer_id,
            rc.core_customer_address_id
       FROM mcp.mcp_route_customers AS rc
       JOIN shared.customers AS customer
         ON customer.installation_id = rc.installation_id
        AND customer.id::text = rc.core_customer_id
        AND customer.is_active = true
        AND customer.responsible_employee_id = $2::uuid
       JOIN shared.customer_addresses AS address
         ON address.installation_id = customer.installation_id
        AND address.customer_id = customer.id
        AND address.id::text = rc.core_customer_address_id
        AND address.is_active = true
      WHERE rc.installation_id = $1
        AND rc.active = true
        AND rc.responsible_employee_id = $2::uuid
        AND rc.core_onboarding_status IN ('approved', 'linked_existing')
        AND rc.core_customer_id IS NOT NULL
        AND rc.core_customer_address_id IS NOT NULL
      ORDER BY rc.id`,
    [installationId(context), employeeId]
  );
  return result.rows || [];
}

async function resolveOwnedLink(persistence, context, customerId, customerAddressId) {
  const rows = await persistence.withTransaction(async (client) => {
    const owned = await ownedRouteCustomers(client, context);
    return owned.filter((row) => (
      String(row.core_customer_id).toLowerCase() === customerId
      && String(row.core_customer_address_id).toLowerCase() === customerAddressId
    ));
  });
  if (rows.length === 0) throw businessError("core_customer_not_owned", 403);
  if (rows.length > 1) throw businessError("core_customer_link_ambiguous", 409);
  return rows[0];
}

function coreClient(options) {
  return options.coreClient || {
    create: createCoreSalesOrder,
    list: listCoreSalesOrders
  };
}

export async function createDirectMcpSalesOrder(body, context, config, options = {}) {
  const submission = normalizeSubmission(body);
  const idempotencyKey = canonicalIdempotencyKey(options.idempotencyKey);
  const persistence = options.persistence || providerPersistence();
  const link = await resolveOwnedLink(
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
    sourceOutletId: String(link.route_customer_id),
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
  const ownedOutletIds = new Set(
    await persistence.withTransaction(async (client) => (
      (await ownedRouteCustomers(client, context)).map((row) => String(row.route_customer_id))
    ))
  );
  if (ownedOutletIds.size === 0) return Object.freeze([]);
  const orders = await coreClient(options).list(context, config, {
    fetchImpl: options.fetchImpl || fetch,
    limit: 1000
  });
  return Object.freeze(orders.filter((order) => (
    order?.sourceType === "MCP"
    && order?.sourceOutletId
    && ownedOutletIds.has(String(order.sourceOutletId))
  )));
}
