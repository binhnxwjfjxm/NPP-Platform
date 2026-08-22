import { createHash, randomUUID } from "node:crypto";
import { createIdempotencyKey } from "../../../../packages/contracts/index.js";
import { providerPersistence } from "./provider-runtime.js";
import {
  coreOnboardingProjection,
  readCoreCustomerOnboarding,
  submitCoreCustomerOnboarding
} from "./core-customer-onboarding-client.js";
import {
  listAccessibleCoreCustomers,
  listAccessibleRouteCustomers,
  loadAccessibleRouteCustomer,
  requireWorkforceEmployee
} from "./customer-route-access.js";

const FIELD_PROFILE_VERIFICATION = "FIELD_PROFILE_VERIFICATION";

const BUSINESS_MESSAGES = Object.freeze({
  trusted_employee_required: "Cần đăng nhập bằng tài khoản nhân viên MCP.",
  employee_inactive: "Nhân viên MCP không còn hoạt động.",
  route_customer_id_required: "Thiếu điểm bán cần xác minh.",
  route_customer_not_found: "Điểm bán không còn tồn tại hoặc đã được gỡ khỏi installation.",
  route_customer_not_owned: "Phân công tuyến đã thay đổi; điểm bán không còn thuộc phạm vi phụ trách.",
  route_sales_unassigned: "Tuyến của điểm bán chưa được phân công nhân viên phụ trách.",
  route_sales_ambiguous: "Phân công tuyến đang trùng hoặc chưa xác định được duy nhất một nhân viên.",
  customer_name_required: "Điểm bán chưa có tên.",
  customer_address_required: "Cần bổ sung địa chỉ điểm bán trước khi gửi đề nghị xác minh / mở mã.",
  core_onboarding_not_submitted: "Điểm bán này chưa được gửi sang Công Ty để xác minh.",
  field_profile_payload_mismatch: "Thông tin điểm bán đã thay đổi sau khi gửi đề nghị. Hãy xử lý đề nghị hiện tại trước khi gửi lại."
});

function businessError(code, statusCode = 400) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  error.publicMessage = BUSINESS_MESSAGES[code] || "Không xử lý được đề nghị xác minh khách.";
  return error;
}

function asBusinessError(error) {
  if (error?.code && BUSINESS_MESSAGES[error.code]) {
    error.publicMessage = BUSINESS_MESSAGES[error.code];
  }
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

function fingerprint(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function loadOwnedRouteCustomer(client, context, routeCustomerId, options = {}) {
  try {
    return await loadAccessibleRouteCustomer(client, context, routeCustomerId, options);
  } catch (error) {
    throw asBusinessError(error);
  }
}

function submissionFromRouteCustomer(row) {
  const addressLine1 = text(row.address);
  if (!text(row.customer_name)) throw businessError("customer_name_required");
  if (!addressLine1) throw businessError("customer_address_required");
  return {
    sourceSystem: "MCP",
    sourceOutletId: row.id,
    sourceDemandReference: FIELD_PROFILE_VERIFICATION,
    orderRequired: false,
    triggerReason: FIELD_PROFILE_VERIFICATION,
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
      channel: "mcp-field",
      routeId: row.route_id,
      routeName: text(row.route_name),
      routeCustomerId: row.id
    }
  };
}

function localProjection(row) {
  return Object.freeze({
    routeCustomerId: row.id,
    routeId: row.route_id,
    routeName: text(row.route_name),
    routeSales: text(row.route_sales),
    customerId: text(row.customer_id),
    customerName: row.customer_name,
    phone: text(row.phone),
    area: text(row.area),
    address: text(row.address),
    note: text(row.note),
    sortOrder: Number(row.sort_order || 0),
    active: row.active !== false,
    geoLat: row.geo_lat == null ? null : Number(row.geo_lat),
    geoLng: row.geo_lng == null ? null : Number(row.geo_lng),
    geoAccuracy: row.geo_accuracy == null ? null : Number(row.geo_accuracy),
    geoCapturedAt: row.geo_captured_at || null,
    status: text(row.core_onboarding_status) || "not_submitted",
    coreRequestId: text(row.core_onboarding_request_id),
    coreCustomerId: text(row.core_customer_id),
    coreCustomerAddressId: text(row.core_customer_address_id),
    coreCustomerCode: text(row.core_customer_code),
    reviewReason: text(row.customer_onboarding_review_reason),
    submittedAt: row.customer_verification_submitted_at || null,
    lastSyncedAt: row.last_core_sync_at || null,
    updatedAt: row.updated_at || null
  });
}

async function prepareSubmission(persistence, context, routeCustomerId) {
  return persistence.withTransaction(async (client) => {
    const row = await loadOwnedRouteCustomer(client, context, routeCustomerId, { forUpdate: true });
    const currentPayload = submissionFromRouteCustomer(row);
    const currentFingerprint = fingerprint(currentPayload);
    const storedFingerprint = text(row.customer_verification_fingerprint);
    if (storedFingerprint && storedFingerprint !== currentFingerprint) {
      throw businessError("field_profile_payload_mismatch", 409);
    }
    if (row.core_onboarding_request_id) {
      return { row, projection: localProjection(row), alreadySubmitted: true };
    }

    let operationId = text(row.customer_verification_operation_id);
    let idempotencyKey = text(row.customer_verification_idempotency_key);
    let payload = row.customer_verification_payload;
    if (!operationId || !idempotencyKey || !payload) {
      operationId = randomUUID();
      idempotencyKey = createIdempotencyKey("mcp.customer-verification.submit", operationId);
      payload = currentPayload;
      const saved = await client.query(
        `UPDATE mcp.mcp_route_customers
         SET customer_verification_operation_id = $3::uuid,
             customer_verification_idempotency_key = $4,
             customer_verification_payload = $5::jsonb,
             customer_verification_fingerprint = $6,
             updated_at = now()
         WHERE installation_id = $1 AND id = $2
         RETURNING *`,
        [installationId(context), routeCustomerId, operationId, idempotencyKey, JSON.stringify(payload), currentFingerprint]
      );
      Object.assign(row, saved.rows?.[0] || {});
    }
    return { row, payload, idempotencyKey, alreadySubmitted: false };
  });
}

async function saveCoreProjection(persistence, context, routeCustomerId, coreRequest) {
  const core = coreOnboardingProjection(coreRequest);
  return persistence.withTransaction(async (client) => {
    await loadOwnedRouteCustomer(client, context, routeCustomerId, { forUpdate: true });
    const now = new Date().toISOString();
    const result = await client.query(
      `UPDATE mcp.mcp_route_customers AS rc
       SET core_onboarding_request_id = $3,
           core_onboarding_status = $4,
           core_customer_id = CASE WHEN $4 IN ('approved', 'linked_existing') THEN $5 ELSE rc.core_customer_id END,
           core_customer_address_id = CASE WHEN $4 IN ('approved', 'linked_existing') THEN $6 ELSE rc.core_customer_address_id END,
           core_customer_code = CASE
             WHEN $4 IN ('approved', 'linked_existing') AND $5 IS NOT NULL
               THEN COALESCE((
                 SELECT customer.code
                 FROM shared.customers AS customer
                 WHERE customer.installation_id = rc.installation_id
                   AND customer.id::text = $5
                 LIMIT 1
               ), rc.core_customer_code)
             ELSE rc.core_customer_code
           END,
           customer_id = CASE WHEN $4 IN ('approved', 'linked_existing') THEN COALESCE($5, rc.customer_id) ELSE rc.customer_id END,
           customer_onboarding_review_reason = $7,
           customer_verification_submitted_at = COALESCE(rc.customer_verification_submitted_at, $8::timestamptz),
           last_core_sync_at = $8::timestamptz,
           updated_at = now()
       WHERE rc.installation_id = $1 AND rc.id = $2
       RETURNING rc.*`,
      [
        installationId(context),
        routeCustomerId,
        core.coreRequestId,
        core.status,
        core.coreCustomerId,
        core.coreCustomerAddressId,
        core.reviewReason,
        now
      ]
    );
    const row = result.rows?.[0];
    if (!row) throw businessError("route_customer_not_found", 404);
    if (core.status === "approved" || core.status === "linked_existing") {
      await client.query("SELECT mcp.sync_route_customer_media_to_shared($1)", [routeCustomerId]);
    }
    row.route_name = null;
    return localProjection(row);
  });
}

export async function submitCustomerVerification(body, context, config, options = {}) {
  const routeCustomerId = text(body?.routeCustomerId || body?.route_customer_id);
  if (!routeCustomerId) throw businessError("route_customer_id_required");
  const persistence = options.persistence || providerPersistence();
  const prepared = await prepareSubmission(persistence, context, routeCustomerId);
  if (prepared.alreadySubmitted) {
    return syncCustomerVerification({ routeCustomerId }, context, config, options);
  }
  const employeeId = requireWorkforceEmployee(context);
  const coreRequest = await submitCoreCustomerOnboarding(
    prepared.payload,
    context,
    config,
    {
      fetchImpl: options.fetchImpl || fetch,
      idempotencyKey: prepared.idempotencyKey,
      employeeId
    }
  );
  return saveCoreProjection(persistence, context, routeCustomerId, coreRequest);
}

export async function syncCustomerVerification(body, context, config, options = {}) {
  const routeCustomerId = text(body?.routeCustomerId || body?.route_customer_id);
  if (!routeCustomerId) throw businessError("route_customer_id_required");
  const persistence = options.persistence || providerPersistence();
  const row = await persistence.withTransaction((client) => loadOwnedRouteCustomer(client, context, routeCustomerId));
  const coreRequestId = text(row.core_onboarding_request_id);
  if (!coreRequestId) throw businessError("core_onboarding_not_submitted", 409);
  const coreRequest = await readCoreCustomerOnboarding(
    coreRequestId,
    context,
    config,
    { fetchImpl: options.fetchImpl || fetch, employeeId: requireWorkforceEmployee(context) }
  );
  return saveCoreProjection(persistence, context, routeCustomerId, coreRequest);
}

export async function listCustomerVerifications(context, options = {}) {
  const persistence = options.persistence || providerPersistence();
  return persistence.withTransaction(async (client) => {
    try {
      const rows = await listAccessibleRouteCustomers(client, context);
      return Object.freeze(rows.map(localProjection));
    } catch (error) {
      throw asBusinessError(error);
    }
  });
}

export async function listOwnedCoreCustomers(context, options = {}) {
  const persistence = options.persistence || providerPersistence();
  return persistence.withTransaction(async (client) => {
    let rows;
    try {
      rows = await listAccessibleCoreCustomers(client, context);
    } catch (error) {
      throw asBusinessError(error);
    }
    return Object.freeze(rows.map((row) => Object.freeze({
      id: row.id,
      customerCode: row.customer_code,
      customerAddressId: text(row.customer_address_id),
      name: row.name,
      phone: text(row.phone),
      email: text(row.email),
      status: row.is_active === false ? "inactive" : "active",
      updatedAt: row.updated_at || null
    })));
  });
}
