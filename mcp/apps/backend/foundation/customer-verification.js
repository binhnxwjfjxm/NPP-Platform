import { createHash, randomUUID } from "node:crypto";
import { createIdempotencyKey } from "../../../../packages/contracts/index.js";
import { providerPersistence } from "./provider-runtime.js";
import {
  coreOnboardingProjection,
  readCoreCustomerOnboarding,
  submitCoreCustomerOnboarding
} from "./core-customer-onboarding-client.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELD_PROFILE_VERIFICATION = "FIELD_PROFILE_VERIFICATION";

const BUSINESS_MESSAGES = Object.freeze({
  trusted_employee_required: "Cần đăng nhập bằng tài khoản nhân viên MCP.",
  employee_inactive: "Nhân viên MCP không còn hoạt động.",
  route_customer_id_required: "Thiếu điểm bán cần xác minh.",
  route_customer_not_found: "Không tìm thấy điểm bán thuộc phạm vi của nhân viên này.",
  route_customer_not_owned: "Điểm bán không thuộc nhân viên đang đăng nhập.",
  route_customer_owner_unresolved: "Chưa xác định được nhân viên phụ trách duy nhất cho điểm bán này.",
  customer_name_required: "Điểm bán chưa có tên.",
  customer_address_required: "Cần bổ sung địa chỉ điểm bán trước khi gửi đề nghị xác minh / mở mã.",
  core_onboarding_not_submitted: "Điểm bán này chưa được gửi sang Core để xác minh.",
  field_profile_payload_mismatch: "Thông tin điểm bán đã thay đổi sau khi gửi đề nghị. Hãy xử lý đề nghị hiện tại trước khi gửi lại."
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

function requireEmployee(context) {
  const employeeId = text(context?.principal?.employeeId);
  if (!employeeId || !UUID_PATTERN.test(employeeId)) throw businessError("trusted_employee_required", 401);
  return employeeId;
}

function installationId(context) {
  const value = text(context?.installation?.id);
  if (!value) throw businessError("installation_id_required");
  return value;
}

function fingerprint(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function routeSalesMatchesEmployee(row) {
  const sales = text(row.route_sales)?.toLowerCase();
  if (!sales) return false;
  return sales === text(row.employee_name)?.toLowerCase() || sales === text(row.employee_code)?.toLowerCase();
}

function assertOwnedRow(row, employeeId) {
  if (!row) throw businessError("route_customer_not_found", 404);
  if (row.employee_active !== true) throw businessError("employee_inactive", 403);
  const owner = text(row.responsible_employee_id);
  if (owner && owner !== employeeId) throw businessError("route_customer_not_owned", 403);
  if (!owner && (!routeSalesMatchesEmployee(row) || Number(row.route_employee_matches || 0) !== 1)) {
    throw businessError("route_customer_owner_unresolved", 409);
  }
}

async function loadOwnedRouteCustomer(client, context, routeCustomerId, { forUpdate = false, claim = false } = {}) {
  const employeeId = requireEmployee(context);
  const result = await client.query(
    `SELECT
       rc.*,
       route.route_name,
       route.sales AS route_sales,
       employee.code AS employee_code,
       employee.full_name AS employee_name,
       employee.is_active AS employee_active,
       (
         SELECT count(*)::integer
         FROM shared.employees AS other_employee
         WHERE other_employee.installation_id = rc.installation_id
           AND other_employee.is_active = true
           AND (
             lower(btrim(other_employee.full_name)) = lower(btrim(COALESCE(route.sales, '')))
             OR upper(btrim(other_employee.code)) = upper(btrim(COALESCE(route.sales, '')))
           )
       ) AS route_employee_matches
     FROM mcp.mcp_route_customers AS rc
     JOIN mcp.mcp_routes AS route
       ON route.installation_id = rc.installation_id
      AND route.id = rc.route_id
     JOIN shared.employees AS employee
       ON employee.installation_id = rc.installation_id
      AND employee.id = $3::uuid
     WHERE rc.installation_id = $1
       AND rc.id = $2
       AND rc.active = true
     ${forUpdate ? "FOR UPDATE OF rc" : ""}`,
    [installationId(context), routeCustomerId, employeeId]
  );
  const row = result.rows?.[0];
  assertOwnedRow(row, employeeId);
  if (claim && !row.responsible_employee_id) {
    const claimed = await client.query(
      `UPDATE mcp.mcp_route_customers
       SET responsible_employee_id = $3::uuid,
           updated_at = now()
       WHERE installation_id = $1
         AND id = $2
         AND responsible_employee_id IS NULL
       RETURNING responsible_employee_id`,
      [installationId(context), routeCustomerId, employeeId]
    );
    if (!claimed.rows?.[0]) throw businessError("route_customer_not_owned", 409);
    row.responsible_employee_id = employeeId;
  }
  return row;
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
    customerName: row.customer_name,
    phone: text(row.phone),
    area: text(row.area),
    address: text(row.address),
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
    const row = await loadOwnedRouteCustomer(client, context, routeCustomerId, { forUpdate: true, claim: true });
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
  const employeeId = requireEmployee(context);
  return persistence.withTransaction(async (client) => {
    await loadOwnedRouteCustomer(client, context, routeCustomerId, { forUpdate: true, claim: false });
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
           responsible_employee_id = $9::uuid,
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
        now,
        employeeId
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
  const employeeId = requireEmployee(context);
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
    { fetchImpl: options.fetchImpl || fetch, employeeId: requireEmployee(context) }
  );
  return saveCoreProjection(persistence, context, routeCustomerId, coreRequest);
}

export async function listCustomerVerifications(context, options = {}) {
  const employeeId = requireEmployee(context);
  const persistence = options.persistence || providerPersistence();
  return persistence.withTransaction(async (client) => {
    const result = await client.query(
      `SELECT
         rc.*,
         route.route_name,
         route.sales AS route_sales,
         employee.code AS employee_code,
         employee.full_name AS employee_name,
         employee.is_active AS employee_active,
         (
           SELECT count(*)::integer
           FROM shared.employees AS other_employee
           WHERE other_employee.installation_id = rc.installation_id
             AND other_employee.is_active = true
             AND (
               lower(btrim(other_employee.full_name)) = lower(btrim(COALESCE(route.sales, '')))
               OR upper(btrim(other_employee.code)) = upper(btrim(COALESCE(route.sales, '')))
             )
         ) AS route_employee_matches
       FROM mcp.mcp_route_customers AS rc
       JOIN mcp.mcp_routes AS route
         ON route.installation_id = rc.installation_id
        AND route.id = rc.route_id
       JOIN shared.employees AS employee
         ON employee.installation_id = rc.installation_id
        AND employee.id = $2::uuid
        AND employee.is_active = true
       WHERE rc.installation_id = $1
         AND rc.active = true
         AND (
           rc.responsible_employee_id = $2::uuid
           OR (
             rc.responsible_employee_id IS NULL
             AND (
               lower(btrim(employee.full_name)) = lower(btrim(COALESCE(route.sales, '')))
               OR upper(btrim(employee.code)) = upper(btrim(COALESCE(route.sales, '')))
             )
             AND (
               SELECT count(*)
               FROM shared.employees AS other_employee
               WHERE other_employee.installation_id = rc.installation_id
                 AND other_employee.is_active = true
                 AND (
                   lower(btrim(other_employee.full_name)) = lower(btrim(COALESCE(route.sales, '')))
                   OR upper(btrim(other_employee.code)) = upper(btrim(COALESCE(route.sales, '')))
                 )
             ) = 1
           )
         )
       ORDER BY route.route_name, rc.sort_order, rc.customer_name, rc.id`,
      [installationId(context), employeeId]
    );
    return Object.freeze((result.rows || []).map(localProjection));
  });
}

export async function listOwnedCoreCustomers(context, options = {}) {
  const employeeId = requireEmployee(context);
  const persistence = options.persistence || providerPersistence();
  return persistence.withTransaction(async (client) => {
    const result = await client.query(
      `SELECT id, customer_code, name, account_name, phone, email, status, active, sales_owner, note, updated_at
       FROM mcp.accounts
       WHERE installation_id = $1
         AND active = true
         AND sales_owner = $2
       ORDER BY name, customer_code, id`,
      [installationId(context), employeeId]
    );
    return Object.freeze((result.rows || []).map((row) => Object.freeze({
      id: row.id,
      customerCode: row.customer_code,
      name: row.name || row.account_name,
      phone: text(row.phone),
      email: text(row.email),
      status: row.status,
      updatedAt: row.updated_at || null
    })));
  });
}
