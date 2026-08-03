const CORE_ORDER_STATUSES = new Set(["draft", "confirmed", "cancelled", "closed"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUSINESS_STATUS_CODES = new Set([400, 404, 409, 422]);

function integrationError(code, statusCode = 502, details = null, retryable = false) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  error.publicRetryable = retryable;
  if (details) {
    error.publicDetails = details;
    if (details.message) error.publicMessage = details.message;
  }
  return error;
}

function configured(config) {
  const boundary = config?.coreSales;
  if (!boundary?.configured || !boundary.baseUrl || !boundary.apiToken || !boundary.defaultWarehouseId) {
    throw integrationError("core_sales_not_configured", 503, null, false);
  }
  return boundary;
}

function requestHeaders(boundary, requestContext, { idempotencyKey = null } = {}) {
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${boundary.apiToken}`,
    "X-Request-Id": requestContext.requestId
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return headers;
}

async function coreRequest(config, requestContext, path, init, { fetchImpl = fetch } = {}) {
  const boundary = configured(config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), boundary.timeoutMs);
  timeout.unref?.();
  let response;
  let payload;
  try {
    const { idempotencyKey, body, ...requestInit } = init;
    const headers = requestHeaders(boundary, requestContext, { idempotencyKey });
    if (body !== undefined) headers["Content-Type"] = "application/json";
    response = await fetchImpl(`${boundary.baseUrl}${path}`, {
      ...requestInit,
      headers,
      body,
      signal: controller.signal
    });
    try {
      payload = await response.json();
    } catch (error) {
      if (error?.name === "AbortError" || controller.signal.aborted) {
        throw integrationError("core_sales_timeout", 504, null, true);
      }
      throw integrationError("core_sales_response_invalid", 502, null, true);
    }
  } catch (error) {
    if (error?.code && error?.statusCode) throw error;
    if (error?.name === "AbortError" || controller.signal.aborted) {
      throw integrationError("core_sales_timeout", 504, null, true);
    }
    throw integrationError("core_sales_unavailable", 502, null, true);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const coreCode = String(payload?.error?.code || "").trim() || null;
    const publicMessage = String(payload?.error?.message || "").trim() || null;
    const statusCode = BUSINESS_STATUS_CODES.has(response.status) ? response.status : 502;
    throw integrationError(
      coreCode || "core_sales_request_failed",
      statusCode,
      publicMessage ? { message: publicMessage } : null,
      response.status >= 500
    );
  }
  return payload?.data;
}

function currentVersion(order) {
  const versions = Array.isArray(order?.versions) ? order.versions : [];
  const current = String(order?.currentVersionNumber || "");
  return versions.find((version) => String(version?.versionNumber || "") === current) || versions.at(-1) || null;
}

function assertCoreOrder(order) {
  if (!order || typeof order !== "object" || !UUID_PATTERN.test(String(order.id || "")) || !CORE_ORDER_STATUSES.has(String(order.status || ""))) {
    throw integrationError("core_sales_response_invalid", 502, null, true);
  }
  return order;
}

function requiredUuid(value, missingCode, invalidCode) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) throw integrationError(missingCode, 400);
  if (!UUID_PATTERN.test(normalized)) throw integrationError(invalidCode, 400);
  return normalized;
}

export function coreSalesOrderProjection(order) {
  const normalized = assertCoreOrder(order);
  const version = currentVersion(normalized);
  return Object.freeze({
    coreSalesOrderId: normalized.id,
    number: normalized.number || null,
    status: String(normalized.status),
    currentVersionNumber: Number(normalized.currentVersionNumber || version?.versionNumber || 1),
    total: String(version?.total ?? "0"),
    currency: String(normalized.currency || version?.currency || "VND"),
    sourceType: String(normalized.sourceType || ""),
    sourceId: normalized.sourceId || null,
    sourceOutletId: normalized.sourceOutletId || null,
    customerId: normalized.customerId || null,
    customerAddressId: normalized.customerAddressId || version?.customerAddressId || null,
    updatedAt: normalized.updatedAt || null
  });
}

export async function searchCoreSalesSkus(search, requestContext, config, options = {}) {
  const term = String(search || "").trim();
  const limit = Math.max(1, Math.min(50, Number(options.limit) || 50));
  const offset = Math.max(0, Number(options.offset) || 0);
  const params = new URLSearchParams({ search: term, limit: String(limit), offset: String(offset) });
  const data = await coreRequest(
    config,
    requestContext,
    `/api/sales-orders/sku-search?${params.toString()}`,
    { method: "GET" },
    options
  );
  if (!Array.isArray(data)) throw integrationError("core_sales_sku_response_invalid", 502, null, true);
  return data;
}

export async function listCoreProductVariants(productId, requestContext, config, options = {}) {
  const normalized = requiredUuid(productId, "core_sales_product_id_required", "core_sales_product_id_invalid");
  const data = await coreRequest(
    config,
    requestContext,
    `/api/products/${encodeURIComponent(normalized)}/variants`,
    { method: "GET" },
    options
  );
  if (!Array.isArray(data)) throw integrationError("core_sales_variant_response_invalid", 502, null, true);
  return data;
}

export async function createCoreSalesOrder(payload, requestContext, config, options = {}) {
  const idempotencyKey = String(options.idempotencyKey || "").trim();
  if (!idempotencyKey) throw integrationError("core_sales_idempotency_key_required", 400);
  const data = await coreRequest(config, requestContext, "/api/sales-orders", {
    method: "POST",
    idempotencyKey,
    body: JSON.stringify(payload)
  }, options);
  return assertCoreOrder(data);
}

export async function readCoreSalesOrder(orderId, requestContext, config, options = {}) {
  const normalized = requiredUuid(orderId, "core_sales_order_id_required", "core_sales_order_id_invalid");
  const data = await coreRequest(
    config,
    requestContext,
    `/api/sales-orders/${encodeURIComponent(normalized)}`,
    { method: "GET" },
    options
  );
  return assertCoreOrder(data);
}
