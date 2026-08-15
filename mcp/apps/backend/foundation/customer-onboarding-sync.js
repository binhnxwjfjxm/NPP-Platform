import { createHash } from "node:crypto";
import { createIdempotencyKey } from "../../../../packages/contracts/index.js";
import { providerPersistence } from "./provider-runtime.js";
import {
  coreOnboardingProjection,
  readCoreCustomerOnboarding,
  submitCoreCustomerOnboarding
} from "./core-customer-onboarding-client.js";

const BUSINESS_MESSAGES = Object.freeze({
  session_customer_id_required: "Thiếu điểm bán trong phiên.",
  order_intent_not_found: "Không tìm thấy nhu cầu mua của điểm bán này.",
  order_intent_reference_mismatch: "Mã nhu cầu mua không khớp với điểm bán.",
  source_outlet_id_required: "Điểm bán chưa có mã tham chiếu ổn định.",
  customer_name_required: "Điểm bán chưa có tên.",
  customer_address_required: "Cần bổ sung địa chỉ điểm bán trước khi gửi đề nghị xác minh / mở mã.",
  core_onboarding_not_submitted: "Nhu cầu mua này chưa được gửi sang Core.",
  demand_reference_payload_mismatch: "Thông tin điểm bán đã thay đổi sau khi gửi đề nghị. Không thể dùng lại cùng mã nhu cầu mua."
});

function businessError(code, statusCode = 400) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  error.publicMessage = BUSINESS_MESSAGES[code] || "Không xử lý được đề nghị xác minh khách.";
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

function stableOperationUuid(value) {
  const hex = createHash("sha256").update(String(value)).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

function localProjection(row) {
  if (!row?.customer_onboarding_request_id) return null;
  const status = text(row.customer_onboarding_status);
  return {
    orderId: row.order_id,
    orderCode: row.order_code || null,
    sourceOutletId: text(row.route_customer_id) || row.session_customer_id,
    sourceDemandReference: row.order_id,
    coreRequestId: row.customer_onboarding_request_id,
    status,
    version: Number(row.customer_onboarding_version || 0),
    coreCustomerId: row.core_customer_id || null,
    coreCustomerAddressId: row.core_customer_address_id || null,
    reviewReason: row.customer_onboarding_review_reason || null,
    submissionFingerprint: row.customer_onboarding_fingerprint || null,
    officialOrderAllowed: status === "approved" || status === "linked_existing",
    submittedAt: row.customer_onboarding_submitted_at || null,
    lastSyncedAt: row.customer_onboarding_last_synced_at || null,
    updatedAt: row.order_updated_at || null
  };
}

async function loadOrderIntent(persistence, context, sessionCustomerId, orderId = null) {
  return persistence.withTransaction(async (client) => {
    const result = await client.query(
      `SELECT
         sc.id AS session_customer_id,
         sc.session_id,
         sc.route_id,
         sc.route_customer_id,
         sc.customer_id,
         sc.customer_name,
         sc.phone,
         sc.area,
         sc.address,
         sc.source,
         s.sales AS session_sales,
         o.id AS order_id,
         o.order_code,
         o.status AS order_status,
         o.customer_onboarding_request_id,
         o.customer_onboarding_status,
         o.customer_onboarding_version,
         o.customer_onboarding_fingerprint,
         o.core_customer_id,
         o.core_customer_address_id,
         o.customer_onboarding_review_reason,
         o.customer_onboarding_submitted_at,
         o.customer_onboarding_last_synced_at,
         o.updated_at AS order_updated_at
       FROM mcp.mcp_session_customers sc
       JOIN mcp.mcp_route_sessions s
         ON s.installation_id = sc.installation_id
        AND s.id = sc.session_id
       JOIN mcp.orders o
         ON o.installation_id = sc.installation_id
        AND o.id = sc.order_id
       WHERE sc.installation_id = $1 AND sc.id = $2`,
      [installationId(context), sessionCustomerId]
    );
    const row = result.rows?.[0];
    if (!row) throw businessError("order_intent_not_found", 404);
    if (orderId && row.order_id !== orderId) throw businessError("order_intent_reference_mismatch", 409);
    return row;
  });
}

function submissionFromOrder(row) {
  const sourceOutletId = text(row.route_customer_id) || text(row.session_customer_id);
  const addressLine1 = text(row.address);
  if (!sourceOutletId) throw businessError("source_outlet_id_required");
  if (!text(row.customer_name)) throw businessError("customer_name_required");
  if (!addressLine1) throw businessError("customer_address_required");
  return {
    sourceSystem: "MCP",
    sourceOutletId,
    sourceDemandReference: row.order_id,
    orderRequired: true,
    proposedCustomer: {
      name: row.customer_name,
      phone: text(row.phone),
      address: {
        label: "Điểm bán MCP",
        addressLine1,
        province: text(row.area),
        countryCode: "VN"
      }
    },
    sourceMetadata: {
      mcpOrderId: row.order_id,
      mcpOrderCode: text(row.order_code),
      sessionCustomerId: row.session_customer_id,
      sessionId: row.session_id,
      routeId: text(row.route_id),
      routeCustomerId: text(row.route_customer_id),
      source: text(row.source),
      area: text(row.area),
      sessionOwner: text(row.session_sales)
    }
  };
}

function submissionFingerprint(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function saveProjection(persistence, context, row, coreRequest, { submittedAt = null, fingerprint = null } = {}) {
  const now = new Date().toISOString();
  const coreProjection = coreOnboardingProjection(coreRequest);
  const projection = {
    orderId: row.order_id,
    orderCode: text(row.order_code),
    sourceOutletId: text(row.route_customer_id) || row.session_customer_id,
    sourceDemandReference: row.order_id,
    ...coreProjection,
    submissionFingerprint: fingerprint || localProjection(row)?.submissionFingerprint || null,
    submittedAt: submittedAt || localProjection(row)?.submittedAt || now,
    lastSyncedAt: now
  };
  await persistence.withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE mcp.orders
       SET customer_onboarding_request_id = $3,
           customer_onboarding_status = $4,
           customer_onboarding_version = $5,
           customer_onboarding_fingerprint = $6,
           core_customer_id = $7,
           core_customer_address_id = $8,
           customer_onboarding_review_reason = $9,
           customer_onboarding_submitted_at = $10,
           customer_onboarding_last_synced_at = $11,
           updated_at = now()
       WHERE installation_id = $1 AND id = $2
       RETURNING id`,
      [
        installationId(context),
        row.order_id,
        projection.coreRequestId,
        projection.status,
        projection.version,
        projection.submissionFingerprint,
        projection.coreCustomerId,
        projection.coreCustomerAddressId,
        projection.reviewReason,
        projection.submittedAt,
        projection.lastSyncedAt
      ]
    );
    if (!result.rows?.[0]) throw businessError("order_intent_not_found", 404);
  });
  return projection;
}

export async function getCustomerOnboardingProjection(body, context, config, options = {}) {
  const sessionCustomerId = text(body.sessionCustomerId || body.session_customer_id);
  if (!sessionCustomerId) throw businessError("session_customer_id_required");
  const persistence = options.persistence || providerPersistence();
  const row = await loadOrderIntent(persistence, context, sessionCustomerId, text(body.orderId || body.order_id));
  return localProjection(row) || {
    orderId: row.order_id,
    orderCode: row.order_code || null,
    sourceOutletId: text(row.route_customer_id) || row.session_customer_id,
    sourceDemandReference: row.order_id,
    coreRequestId: null,
    status: null,
    officialOrderAllowed: false
  };
}

export async function submitCustomerOnboarding(body, context, config, options = {}) {
  const sessionCustomerId = text(body.sessionCustomerId || body.session_customer_id);
  if (!sessionCustomerId) throw businessError("session_customer_id_required");
  const persistence = options.persistence || providerPersistence();
  const row = await loadOrderIntent(persistence, context, sessionCustomerId, text(body.orderId || body.order_id));
  const submission = submissionFromOrder(row);
  const fingerprint = submissionFingerprint(submission);
  const existing = localProjection(row);
  if (existing?.coreRequestId) {
    if (existing.submissionFingerprint && existing.submissionFingerprint !== fingerprint) {
      throw businessError("demand_reference_payload_mismatch", 409);
    }
    return syncCustomerOnboarding({ sessionCustomerId, orderId: row.order_id }, context, config, options);
  }
  const coreRequest = await submitCoreCustomerOnboarding(
    submission,
    context,
    config,
    {
      fetchImpl: options.fetchImpl || fetch,
      idempotencyKey: createIdempotencyKey(
        "mcp.customer-onboarding.submit",
        stableOperationUuid(row.order_id)
      )
    }
  );
  return saveProjection(persistence, context, row, coreRequest, { submittedAt: new Date().toISOString(), fingerprint });
}

export async function syncCustomerOnboarding(body, context, config, options = {}) {
  const sessionCustomerId = text(body.sessionCustomerId || body.session_customer_id);
  if (!sessionCustomerId) throw businessError("session_customer_id_required");
  const persistence = options.persistence || providerPersistence();
  const row = await loadOrderIntent(persistence, context, sessionCustomerId, text(body.orderId || body.order_id));
  const existing = localProjection(row);
  if (!existing?.coreRequestId) throw businessError("core_onboarding_not_submitted", 409);
  const coreRequest = await readCoreCustomerOnboarding(
    existing.coreRequestId,
    context,
    config,
    { fetchImpl: options.fetchImpl || fetch }
  );
  return saveProjection(persistence, context, row, coreRequest);
}
