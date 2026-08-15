const CORE_REQUEST_STATUSES = new Set([
  "submitted",
  "under_review",
  "need_more_info",
  "approved",
  "linked_existing",
  "rejected",
  "cancelled"
]);

function integrationError(code, statusCode = 502, details = null, retryable = false) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  error.publicRetryable = retryable;
  if (details) { error.publicDetails = details; if (details.message) error.publicMessage = details.message; }
  return error;
}

function configured(config) {
  const boundary = config?.coreOnboarding;
  if (!boundary?.configured || !boundary.baseUrl || !boundary.apiToken) {
    throw integrationError("core_onboarding_not_configured", 503, null, false);
  }
  return boundary;
}

function requestHeaders(boundary, requestContext, { idempotencyKey = null, employeeId = null } = {}) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${boundary.apiToken}`,
    "X-Request-Id": requestContext.requestId
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const trustedEmployeeId = String(employeeId || requestContext?.principal?.employeeId || "").trim();
  if (trustedEmployeeId) headers["X-NPP-MCP-Employee-Id"] = trustedEmployeeId;
  return headers;
}

async function coreRequest(config, requestContext, path, init, { fetchImpl = fetch, employeeId = null } = {}) {
  const boundary = configured(config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), boundary.timeoutMs);
  timeout.unref?.();
  let response;
  try {
    const { idempotencyKey, ...requestInit } = init;
    response = await fetchImpl(`${boundary.baseUrl}${path}`, {
      ...requestInit,
      headers: requestHeaders(boundary, requestContext, { idempotencyKey, employeeId }),
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw integrationError("core_onboarding_timeout", 504, null, true);
    }
    throw integrationError("core_onboarding_unavailable", 502, null, true);
  } finally {
    clearTimeout(timeout);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const coreCode = String(payload?.error?.code || "").trim() || null;
    const publicMessage = String(payload?.error?.message || "").trim() || null;
    throw integrationError(
      coreCode || "core_onboarding_request_failed",
      response.status,
      publicMessage ? { message: publicMessage } : null,
      response.status >= 500
    );
  }

  const request = payload?.data?.customerOnboardingRequest;
  if (!request || !request.id || !CORE_REQUEST_STATUSES.has(request.status)) {
    throw integrationError("core_onboarding_response_invalid", 502, null, true);
  }
  return request;
}

export async function submitCoreCustomerOnboarding(payload, requestContext, config, options = {}) {
  const idempotencyKey = String(options.idempotencyKey || "").trim();
  if (!idempotencyKey) throw integrationError("core_onboarding_idempotency_key_required", 400);
  return coreRequest(config, requestContext, "/api/customer-onboarding-requests", {
    method: "POST",
    idempotencyKey,
    body: JSON.stringify(payload)
  }, options);
}

export async function readCoreCustomerOnboarding(requestId, requestContext, config, options = {}) {
  const normalized = String(requestId || "").trim();
  if (!normalized) throw integrationError("core_onboarding_request_id_required", 400);
  return coreRequest(
    config,
    requestContext,
    `/api/customer-onboarding-requests/${encodeURIComponent(normalized)}`,
    { method: "GET" },
    options
  );
}

export function coreOnboardingProjection(request) {
  const status = String(request.status || "");
  return Object.freeze({
    coreRequestId: request.id,
    status,
    version: Number(request.version || 0),
    coreCustomerId: request.approvedCustomerId || null,
    coreCustomerAddressId: request.approvedCustomerAddressId || null,
    reviewReason: request.reviewReason || null,
    officialOrderAllowed: status === "approved" || status === "linked_existing",
    updatedAt: request.updatedAt || null
  });
}
