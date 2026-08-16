import { IDEMPOTENCY_KEY_PATTERN } from '../../../../packages/contracts/index.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUSINESS_STATUS_CODES = new Set([400, 403, 404, 409, 422]);

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
  if (!boundary?.configured || !boundary.baseUrl || !boundary.apiToken) {
    throw integrationError('core_customer_location_not_configured', 503, null, false);
  }
  return boundary;
}

function requiredUuid(value, code) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw integrationError(code, 400);
  return normalized;
}

export async function syncCoreCustomerAddressLocation({ customerId, addressId, locationUrl }, requestContext, config, options = {}) {
  const boundary = configured(config);
  const normalizedCustomerId = requiredUuid(customerId, 'core_customer_id_invalid');
  const normalizedAddressId = requiredUuid(addressId, 'core_customer_address_id_invalid');
  const idempotencyKey = String(options.idempotencyKey ?? requestContext?.idempotencyKey ?? '').trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw integrationError('core_customer_location_idempotency_key_invalid', 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), boundary.timeoutMs);
  timeout.unref?.();
  let response;
  let payload;
  try {
    response = await (options.fetchImpl ?? fetch)(`${boundary.baseUrl}/api/internal/mcp/customer-address-location`, {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${boundary.apiToken}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        'X-Request-Id': requestContext.requestId,
      },
      body: JSON.stringify({
        customerId: normalizedCustomerId,
        addressId: normalizedAddressId,
        locationUrl: locationUrl ?? null,
      }),
      signal: controller.signal,
    });
    try {
      payload = await response.json();
    } catch (error) {
      if (error?.name === 'AbortError' || controller.signal.aborted) {
        throw integrationError('core_customer_location_timeout', 504, null, true);
      }
      throw integrationError('core_customer_location_response_invalid', 502, null, true);
    }
  } catch (error) {
    if (error?.code && error?.statusCode) throw error;
    if (error?.name === 'AbortError' || controller.signal.aborted) {
      throw integrationError('core_customer_location_timeout', 504, null, true);
    }
    throw integrationError('core_customer_location_unavailable', 502, null, true);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const coreCode = String(payload?.error?.code ?? '').trim() || 'core_customer_location_request_failed';
    const message = String(payload?.error?.message ?? '').trim() || null;
    throw integrationError(
      coreCode,
      BUSINESS_STATUS_CODES.has(response.status) ? response.status : 502,
      message ? { message } : null,
      response.status >= 500 || payload?.error?.retryable === true,
    );
  }

  const data = payload?.data;
  if (!data || data.customerId !== normalizedCustomerId || data.addressId !== normalizedAddressId) {
    throw integrationError('core_customer_location_response_invalid', 502, null, true);
  }
  return data;
}
