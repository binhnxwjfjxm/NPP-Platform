import { sendError, sendSuccess } from '../http-utils.js';
import { listInventoryTrackingPolicyCandidates } from '../services/inventory-tracking-policy-candidates.js';

function apiError(code, message, statusCode) {
  return { code, message, details: {}, retryable: false, statusCode };
}

function parseInteger(value, fallback, max) {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
    throw Object.assign(new Error('INVALID_QUERY_PARAMETER'), {
      code: 'INVALID_QUERY_PARAMETER',
      publicMessage: `Query parameter must be an integer between 0 and ${max}`,
      statusCode: 400,
    });
  }
  return parsed;
}

export async function handleInventoryTrackingPolicyCandidateRoutes(req, res, options) {
  const url = new URL(`http://localhost${req.url}`);
  if (url.pathname !== '/api/inventory/tracking-policies/candidates') return false;
  if (String(req.method ?? 'GET').toUpperCase() !== 'GET') {
    sendError(res, apiError('METHOD_NOT_ALLOWED', 'Only GET is supported', 405), options.requestId, options.receivedAt);
    return true;
  }

  const auth = options.authenticate(req, options.config);
  if (!auth.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, apiError('UNAUTHORIZED', 'Authorization required', 401), options.requestId, options.receivedAt);
    return true;
  }
  const requestContext = options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  if (!options.authorize(requestContext, options.PERMISSIONS.coreInventoryTrackingPolicyRead).ok) {
    sendError(res, apiError('FORBIDDEN', 'Permission denied', 403), options.requestId, options.receivedAt);
    return true;
  }

  try {
    const result = await listInventoryTrackingPolicyCandidates(options.getPool(), {
      requestContext,
      search: url.searchParams.get('search'),
      limit: parseInteger(url.searchParams.get('limit'), 500, 2000),
      offset: parseInteger(url.searchParams.get('offset'), 0, 10000),
    });
    if (!result.ok) {
      sendError(res, apiError(result.code, result.message, result.code === 'PERMISSION_DENIED' ? 403 : 400), options.requestId, options.receivedAt);
      return true;
    }
    sendSuccess(res, result.candidates, options.requestId, options.receivedAt);
  } catch (error) {
    sendError(
      res,
      apiError(error.code ?? 'INVENTORY_POLICY_CANDIDATES_FAILED', error.publicMessage ?? 'Không tải được danh sách SKU', error.statusCode ?? 500),
      options.requestId,
      options.receivedAt,
    );
  }
  return true;
}
