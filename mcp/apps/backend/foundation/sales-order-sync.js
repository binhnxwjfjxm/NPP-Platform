import { createHash } from "node:crypto";
import { providerPersistence } from "./provider-runtime.js";
import {
  coreSalesOrderProjection,
  createCoreSalesOrder,
  readCoreSalesOrder
} from "./core-sales-client.js";

const ALLOWED_ONBOARDING_STATUSES = new Set(["approved", "linked_existing"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE_DECIMAL_PATTERN = /^(?:0*[1-9]\d{0,13})(?:\.\d{1,6})?$|^0+\.0*[1-9]\d{0,5}$/;

const BUSINESS_MESSAGES = Object.freeze({
  session_customer_id_required: "Thiếu điểm bán trong phiên.",
  order_intent_not_found: "Không tìm thấy nhu cầu mua của điểm bán này.",
  order_intent_reference_mismatch: "Mã nhu cầu mua không khớp với điểm bán.",
  core_customer_not_ready: "Điểm bán chưa được Core duyệt hoặc liên kết khách hàng chính thức.",
  core_customer_reference_missing: "Thiếu khách hàng hoặc địa chỉ chính thức từ Core.",
  source_outlet_id_required: "Điểm bán chưa có mã tham chiếu ổn định.",
  core_sales_order_not_submitted: "Nhu cầu mua này chưa tạo đơn chính thức trong Core.",
  core_sales_order_payload_mismatch: "Nhu cầu mua đã thay đổi sau khi tạo đơn Core. Không thể dùng lại cùng mã nhu cầu.",
  core_sales_order_source_mismatch: "Đơn Core trả về không khớp nguồn nhu cầu MCP.",
  core_sales_order_customer_mismatch: "Đơn Core trả về không khớp khách hàng đã được duyệt.",
  core_product_reference_required: "Nhu cầu mua có sản phẩm không thuộc nguồn NPP Core.",
  invalid_order_quantity: "Số lượng sản phẩm trong nhu cầu mua không hợp lệ."
});

function businessError(code, statusCode = 400) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  error.publicMessage = BUSINESS_MESSAGES[code] || "Không xử lý được đơn bán hàng Core.";
  return error;
}

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function installationId(context) {
  const value = text(context?.installation?.id);
  if (!value) throw businessError("installation_id_required");
  return value;
}

function canonicalQuantity(value) {
  const normalized = String(value ?? "").trim();
  if (!POSITIVE_DECIMAL_PATTERN.test(normalized)) throw businessError("invalid_order_quantity");
  return normalized.replace(/^0+(?=\d)/, "");
}

function localProjection(row) {
  if (!row?.core_sales_order_id) return null;
  return Object.freeze({
    orderId: row.order_id,
    orderCode: row.order_code || null,
    sourceOutletId: text(row.route_customer_id) || row.session_customer_id,
    coreSalesOrderId: row.core_sales_order_id,
    number: row.core_sales_order_number || null,
    status: row.core_sales_order_status,
    currentVersionNumber: Number(row.core_sales_order_version || 1),
    total: String(row.core_sales_order_total ?? "0"),
    currency: row.core_sales_order_currency || "VND",
    submissionFingerprint: row.core_sales_order_fingerprint || null,
    submittedAt: row.core_sales_order_submitted_at || null,
    lastSyncedAt: row.core_sales_order_last_synced_at || null,
    updatedAt: row.order_updated_at || null
  });
}

async function loadOrderIntent(persistence, context, sessionCustomerId, orderId = null) {
  return persistence.withTransaction(async (client) => {
    const header = await client.query(
      `SELECT
         sc.id AS session_customer_id,
         sc.route_customer_id,
         o.id AS order_id,
         o.order_code,
         o.note,
         o.customer_onboarding_status,
         o.core_customer_id,
         o.core_customer_address_id,
         o.core_sales_order_id,
         o.core_sales_order_number,
         o.core_sales_order_status,
         o.core_sales_order_version,
         o.core_sales_order_total,
         o.core_sales_order_currency,
         o.core_sales_order_fingerprint,
         o.core_sales_order_submitted_at,
         o.core_sales_order_last_synced_at,
         o.updated_at AS order_updated_at
       FROM mcp.mcp_session_customers sc
       JOIN mcp.orders o
         ON o.installation_id = sc.installation_id
        AND o.id = sc.order_id
       WHERE sc.installation_id = $1 AND sc.id = $2`,
      [installationId(context), sessionCustomerId]
    );
    const row = header.rows?.[0];
    if (!row) throw businessError("order_intent_not_found", 404);
    if (orderId && row.order_id !== orderId) throw businessError("order_intent_reference_mismatch", 409);
    const items = await client.query(
      `SELECT variant_id, quantity, product_name, sku, note
       FROM mcp.order_items
       WHERE installation_id = $1 AND order_id = $2
       ORDER BY created_at, id`,
      [installationId(context), row.order_id]
    );
    return Object.freeze({ ...row, items: Object.freeze(items.rows || []) });
  });
}

function sourceOutletId(row) {
  const value = text(row.route_customer_id) || text(row.session_customer_id);
  if (!value) throw businessError("source_outlet_id_required");
  return value;
}

function submissionFromOrder(row, config) {
  if (!ALLOWED_ONBOARDING_STATUSES.has(text(row.customer_onboarding_status))) {
    throw businessError("core_customer_not_ready", 409);
  }
  if (!UUID_PATTERN.test(text(row.core_customer_id) || "") || !UUID_PATTERN.test(text(row.core_customer_address_id) || "")) {
    throw businessError("core_customer_reference_missing", 409);
  }
  if (!Array.isArray(row.items) || row.items.length === 0) throw businessError("core_product_reference_required", 409);
  const lines = row.items.map((item) => {
    const variantId = text(item.variant_id);
    if (!variantId || !UUID_PATTERN.test(variantId)) throw businessError("core_product_reference_required", 409);
    return {
      variantId,
      quantity: canonicalQuantity(item.quantity),
      note: text(item.note) || text(item.product_name) || text(item.sku)
    };
  });
  return Object.freeze({
    customerMode: "EXISTING",
    customerId: row.core_customer_id,
    customerAddressId: row.core_customer_address_id,
    warehouseId: config.coreSales.defaultWarehouseId,
    deliveryMode: "DELIVERY",
    collectionPolicy: "COLLECT_ON_DELIVERY",
    currency: "VND",
    sourceType: "MCP",
    sourceId: row.order_id,
    sourceOutletId: sourceOutletId(row),
    note: text(row.note),
    lines
  });
}

function submissionFingerprint(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function verifyCoreProjection(projection, row) {
  if (
    projection.sourceType !== "MCP"
    || projection.sourceId !== row.order_id
    || projection.sourceOutletId !== sourceOutletId(row)
  ) {
    throw businessError("core_sales_order_source_mismatch", 502);
  }
  if (
    projection.customerId !== row.core_customer_id
    || projection.customerAddressId !== row.core_customer_address_id
  ) {
    throw businessError("core_sales_order_customer_mismatch", 502);
  }
  return projection;
}

async function saveProjection(persistence, context, row, coreOrder, { submittedAt = null, fingerprint = null } = {}) {
  const now = new Date().toISOString();
  const coreProjection = verifyCoreProjection(coreSalesOrderProjection(coreOrder), row);
  const previous = localProjection(row);
  const projection = Object.freeze({
    orderId: row.order_id,
    orderCode: text(row.order_code),
    sourceOutletId: sourceOutletId(row),
    coreSalesOrderId: coreProjection.coreSalesOrderId,
    number: coreProjection.number,
    status: coreProjection.status,
    currentVersionNumber: coreProjection.currentVersionNumber,
    total: coreProjection.total,
    currency: coreProjection.currency,
    submissionFingerprint: fingerprint || previous?.submissionFingerprint || null,
    submittedAt: submittedAt || previous?.submittedAt || now,
    lastSyncedAt: now
  });
  await persistence.withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE mcp.orders
       SET core_sales_order_id = $3,
           core_sales_order_number = $4,
           core_sales_order_status = $5,
           core_sales_order_version = $6,
           core_sales_order_total = $7,
           core_sales_order_currency = $8,
           core_sales_order_fingerprint = $9,
           core_sales_order_submitted_at = $10,
           core_sales_order_last_synced_at = $11,
           updated_at = now()
       WHERE installation_id = $1 AND id = $2
       RETURNING id`,
      [
        installationId(context),
        row.order_id,
        projection.coreSalesOrderId,
        projection.number,
        projection.status,
        projection.currentVersionNumber,
        projection.total,
        projection.currency,
        projection.submissionFingerprint,
        projection.submittedAt,
        projection.lastSyncedAt
      ]
    );
    if (!result.rows?.[0]) throw businessError("order_intent_not_found", 404);
  });
  return projection;
}

function clientOptions(options) {
  return options.coreClient || {
    create: createCoreSalesOrder,
    read: readCoreSalesOrder
  };
}

export async function getSalesOrderProjection(body, context, config, options = {}) {
  const sessionCustomerId = text(body.sessionCustomerId || body.session_customer_id);
  if (!sessionCustomerId) throw businessError("session_customer_id_required");
  const persistence = options.persistence || providerPersistence();
  const row = await loadOrderIntent(persistence, context, sessionCustomerId, text(body.orderId || body.order_id));
  return localProjection(row) || Object.freeze({
    orderId: row.order_id,
    orderCode: row.order_code || null,
    sourceOutletId: sourceOutletId(row),
    coreSalesOrderId: null,
    number: null,
    status: null,
    currentVersionNumber: null,
    total: null,
    currency: "VND"
  });
}

export async function submitSalesOrder(body, context, config, options = {}) {
  const sessionCustomerId = text(body.sessionCustomerId || body.session_customer_id);
  if (!sessionCustomerId) throw businessError("session_customer_id_required");
  const persistence = options.persistence || providerPersistence();
  const row = await loadOrderIntent(persistence, context, sessionCustomerId, text(body.orderId || body.order_id));
  const submission = submissionFromOrder(row, config);
  const fingerprint = submissionFingerprint(submission);
  const existing = localProjection(row);
  if (existing?.coreSalesOrderId) {
    if (existing.submissionFingerprint && existing.submissionFingerprint !== fingerprint) {
      throw businessError("core_sales_order_payload_mismatch", 409);
    }
    return syncSalesOrder({ sessionCustomerId, orderId: row.order_id }, context, config, options);
  }
  const client = clientOptions(options);
  const coreOrder = await client.create(submission, context, config, {
    fetchImpl: options.fetchImpl || fetch,
    idempotencyKey: `mcp-sales-order-${row.order_id}`
  });
  return saveProjection(persistence, context, row, coreOrder, {
    submittedAt: new Date().toISOString(),
    fingerprint
  });
}

export async function syncSalesOrder(body, context, config, options = {}) {
  const sessionCustomerId = text(body.sessionCustomerId || body.session_customer_id);
  if (!sessionCustomerId) throw businessError("session_customer_id_required");
  const persistence = options.persistence || providerPersistence();
  const row = await loadOrderIntent(persistence, context, sessionCustomerId, text(body.orderId || body.order_id));
  const existing = localProjection(row);
  if (!existing?.coreSalesOrderId) throw businessError("core_sales_order_not_submitted", 409);
  const client = clientOptions(options);
  const coreOrder = await client.read(existing.coreSalesOrderId, context, config, {
    fetchImpl: options.fetchImpl || fetch
  });
  return saveProjection(persistence, context, row, coreOrder);
}
