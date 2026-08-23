const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUSINESS_STATUS_CODES = new Set([400, 404, 409, 413, 422]);
const SAFE_ID = /^[A-Za-z0-9._-]{1,240}$/;

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

function boundary(config) {
  const current = config?.coreSales;
  if (!current?.configured || !current.baseUrl || !current.apiToken) {
    throw integrationError('core_management_proposal_not_configured', 503, null, false);
  }
  return current;
}

function employeeId(context) {
  const value = String(context?.principal?.employeeId || '').trim().toLowerCase();
  if (!UUID_PATTERN.test(value)) throw integrationError('core_management_proposal_employee_required', 400, null, false);
  return value;
}

function proposalId(value) {
  const normalized = String(value || '').trim();
  if (!SAFE_ID.test(normalized)) throw integrationError('management_proposal_id_invalid', 400, null, false);
  return normalized;
}

function headersFor(config, context, idempotencyKey) {
  const current = boundary(config);
  return {
    boundary: current,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${current.apiToken}`,
      'X-Request-Id': context.requestId,
      'X-NPP-MCP-Employee-Id': employeeId(context),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
  };
}

async function coreRequest(config, context, path, { method = 'GET', body, idempotencyKey } = {}, { fetchImpl = fetch } = {}) {
  const resolved = headersFor(config, context, idempotencyKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), resolved.boundary.timeoutMs);
  timeout.unref?.();
  let response;
  let payload;
  try {
    const headers = { ...resolved.headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) };
    response = await fetchImpl(`${resolved.boundary.baseUrl}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    payload = await response.json();
  } catch (error) {
    if (error?.code && error?.statusCode) throw error;
    if (error?.name === 'AbortError' || controller.signal.aborted) {
      throw integrationError('core_management_proposal_timeout', 504, null, true);
    }
    throw integrationError('core_management_proposal_unavailable', 502, null, true);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const coreCode = String(payload?.error?.code || '').trim() || 'core_management_proposal_request_failed';
    const publicMessage = String(payload?.error?.message || '').trim() || null;
    const statusCode = BUSINESS_STATUS_CODES.has(response.status) ? response.status : 502;
    throw integrationError(coreCode, statusCode, publicMessage ? { message: publicMessage } : null, response.status >= 500);
  }
  if (!payload || typeof payload !== 'object' || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
    throw integrationError('core_management_proposal_response_invalid', 502, null, true);
  }
  return payload.data;
}

export async function listCoreManagementProposals(context, config, options = {}) {
  return coreRequest(config, context, '/api/management-proposals?source=mcp', { method: 'GET' }, options);
}

export async function readCoreManagementProposal(id, context, config, options = {}) {
  return coreRequest(config, context, `/api/management-proposals/${encodeURIComponent(proposalId(id))}`, { method: 'GET' }, options);
}

export async function createCoreManagementProposal(payload, context, config, options = {}) {
  const idempotencyKey = String(options.idempotencyKey || '').trim();
  if (!idempotencyKey) throw integrationError('management_proposal_idempotency_key_required', 400, null, false);
  return coreRequest(config, context, '/api/management-proposals', {
    method: 'POST',
    idempotencyKey,
    body: { ...payload, source: 'mcp', domain: 'mcp' },
  }, options);
}

export async function resubmitCoreManagementProposal(id, payload, context, config, options = {}) {
  const idempotencyKey = String(options.idempotencyKey || '').trim();
  if (!idempotencyKey) throw integrationError('management_proposal_idempotency_key_required', 400, null, false);
  return coreRequest(config, context, `/api/management-proposals/${encodeURIComponent(proposalId(id))}/resubmit`, {
    method: 'POST',
    idempotencyKey,
    body: payload,
  }, options);
}
