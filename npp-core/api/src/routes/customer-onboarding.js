import { createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson, sendSuccess } from '../http-utils.js';
import { normalizeIdempotencyKey, readJsonBody } from '../idempotency.js';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
  withAuditOutboxTransaction,
} from '../audit-outbox.js';
import * as service from '../services/customer-onboarding.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(code) {
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'FORBIDDEN' || code.endsWith('_FORBIDDEN')) return 403;
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (code.includes('CONFLICT') || code.includes('MISMATCH') || code === 'INVALID_STATUS_TRANSITION') return 409;
  return 400;
}

function sendServiceError(res, result, options) {
  sendError(
    res,
    apiError(result.code, result.message, result.details ?? {}, Boolean(result.retryable), statusFor(result.code)),
    options.requestId,
    options.receivedAt,
  );
}

async function authenticateAndAuthorize(req, res, options, permission) {
  const auth = options.authenticate(req, options.config);
  if (!auth.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, apiError('UNAUTHORIZED', 'Authorization required', {}, false, 401), options.requestId, options.receivedAt);
    return null;
  }
  const requestContext = options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  if (!options.authorize(requestContext, permission).ok) {
    sendError(res, apiError('FORBIDDEN', 'Permission denied', {}, false, 403), options.requestId, options.receivedAt);
    return null;
  }
  return requestContext;
}

async function readPayload(req, res, options) {
  try {
    return await readJsonBody(req);
  } catch (error) {
    sendError(
      res,
      apiError(error.code, error.publicMessage, {}, false, error.statusCode),
      options.requestId,
      options.receivedAt,
    );
    return null;
  }
}

function requireIdempotencyKey(req) {
  try {
    const key = normalizeIdempotencyKey(req.headers['idempotency-key']);
    if (!key) return { ok: false, code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key header is required' };
    return { ok: true, key };
  } catch (error) {
    return { ok: false, code: error.code ?? 'INVALID_IDEMPOTENCY_KEY', message: 'Idempotency-Key must use 1-128 safe characters' };
  }
}

function canReview(options, requestContext) {
  return options.authorize(requestContext, options.PERMISSIONS.coreCustomerOnboardingReview).ok;
}

function eventTypeFor(action) {
  return `sales.customer_onboarding.${action}`;
}

async function writeAuditOutbox(client, { requestContext, action, result }) {
  const request = result.request;
  await insertAuditRecord(client, buildAuditRecord({
    requestContext,
    action: `customer_onboarding.${action}`,
    resourceType: 'customer_onboarding_request',
    resourceId: request.id,
    beforeData: result.beforeData ?? null,
    afterData: request,
    metadata: {
      sourceSystem: request.sourceSystem,
      sourceOutletId: request.sourceOutletId,
      sourceDemandReference: request.sourceDemandReference,
      status: request.status,
      version: request.version,
    },
  }));
  const event = buildOutboxEvent({
    requestContext,
    aggregateType: 'sales.customer_onboarding_request',
    aggregateId: request.id,
    eventType: eventTypeFor(action),
    eventVersion: request.version,
    payload: request,
    metadata: { status: request.status },
  });
  await insertOutboxEvent(client, event);
  return event.eventId;
}

async function executeMutation(req, res, options, {
  requestContext,
  route,
  payload,
  idempotencyKey,
  action,
  statusCode = 200,
  mutate,
}) {
  try {
    const execution = await options.executeRequestWithIdempotency({
      idempotencyStore: options.idempotencyStore,
      req,
      requestContext,
      requestId: options.requestId,
      receivedAt: options.receivedAt,
      route,
      payload,
      onProcess: async () => {
        const transaction = await withAuditOutboxTransaction({
          adapter: options.getPool(),
          mutate: async (client) => {
            const result = await mutate(client, idempotencyKey);
            if (!result.ok) return { failed: true, result };
            if (result.replayed === true) return { request: result.request, replayed: true };
            const eventId = await writeAuditOutbox(client, { requestContext, action, result });
            return { request: result.request, eventId };
          },
        });
        if (transaction.failed) {
          const result = transaction.result;
          return {
            statusCode: statusFor(result.code),
            contentType: 'application/json',
            requestId: options.requestId,
            body: {
              error: {
                code: result.code,
                message: result.message,
                retryable: Boolean(result.retryable),
                details: result.details ?? {},
              },
              requestId: options.requestId,
              receivedAt: options.receivedAt,
            },
          };
        }
        return {
          statusCode,
          contentType: 'application/json',
          requestId: options.requestId,
          body: createSuccessEnvelope({
            customerOnboardingRequest: transaction.request,
            replayed: Boolean(transaction.replayed),
          }, options.requestId, options.receivedAt),
        };
      },
    });
    res.setHeader('Cache-Control', 'no-store');
    sendJson(
      res,
      execution.response.statusCode,
      execution.response.body,
      execution.response.requestId ?? options.requestId,
      execution.response.contentType,
    );
  } catch (error) {
    sendError(
      res,
      apiError(
        error?.code ?? 'CUSTOMER_ONBOARDING_TRANSACTION_FAILED',
        error?.publicMessage ?? 'Customer verification transaction failed',
        error?.details ?? {},
        Boolean(error?.retryable),
        error?.statusCode ?? 503,
      ),
      options.requestId,
      options.receivedAt,
    );
  }
}

function parsePaging(url) {
  const limit = Number(url.searchParams.get('limit') ?? 100);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0 || offset > 1000000) {
    return { ok: false };
  }
  return { ok: true, limit, offset };
}

export async function handleCustomerOnboardingRoutes(req, res, options) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const collectionPath = '/api/customer-onboarding-requests';
  const itemMatch = url.pathname.match(/^\/api\/customer-onboarding-requests\/([^/]+)$/);
  const actionMatch = url.pathname.match(/^\/api\/customer-onboarding-requests\/([^/]+)\/(review|need-more-info|approve|link-existing|reject|cancel)$/);
  if (url.pathname !== collectionPath && !itemMatch && !actionMatch) return false;

  if (url.pathname === collectionPath && req.method === 'POST') {
    const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreCustomerOnboardingSubmit);
    if (!requestContext) return true;
    const key = requireIdempotencyKey(req);
    if (!key.ok) {
      sendError(res, apiError(key.code, key.message, {}, false, 400), options.requestId, options.receivedAt);
      return true;
    }
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    await executeMutation(req, res, options, {
      requestContext,
      route: collectionPath,
      payload,
      idempotencyKey: key.key,
      action: 'submitted',
      statusCode: 201,
      mutate: (client) => service.submitRequest(client, {
        requestContext,
        payload,
        idempotencyKey: key.key,
      }),
    });
    return true;
  }

  if (url.pathname === collectionPath && req.method === 'GET') {
    const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreCustomerOnboardingRead);
    if (!requestContext) return true;
    const paging = parsePaging(url);
    if (!paging.ok) {
      sendError(res, apiError('INVALID_QUERY_PARAMETER', 'Invalid limit or offset', {}, false, 400), options.requestId, options.receivedAt);
      return true;
    }
    const result = await service.listRequests(options.getPool(), {
      requestContext,
      status: url.searchParams.get('status'),
      sourceOutletId: url.searchParams.get('sourceOutletId'),
      limit: paging.limit,
      offset: paging.offset,
      restrictToRequester: !canReview(options, requestContext),
    });
    if (!result.ok) sendServiceError(res, result, options);
    else sendSuccess(res, { customerOnboardingRequests: result.requests }, options.requestId, options.receivedAt);
    return true;
  }

  if (itemMatch && req.method === 'GET') {
    const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreCustomerOnboardingRead);
    if (!requestContext) return true;
    const result = await service.getRequest(options.getPool(), {
      requestContext,
      id: itemMatch[1],
      restrictToRequester: !canReview(options, requestContext),
    });
    if (!result.ok) sendServiceError(res, result, options);
    else sendSuccess(res, { customerOnboardingRequest: result.request }, options.requestId, options.receivedAt);
    return true;
  }

  if (actionMatch && req.method === 'POST') {
    const [, id, action] = actionMatch;
    const permission = {
      review: options.PERMISSIONS.coreCustomerOnboardingReview,
      'need-more-info': options.PERMISSIONS.coreCustomerOnboardingReview,
      approve: options.PERMISSIONS.coreCustomerOnboardingApprove,
      'link-existing': options.PERMISSIONS.coreCustomerOnboardingLinkExisting,
      reject: options.PERMISSIONS.coreCustomerOnboardingReject,
      cancel: options.PERMISSIONS.coreCustomerOnboardingReview,
    }[action];
    const requestContext = await authenticateAndAuthorize(req, res, options, permission);
    if (!requestContext) return true;
    const key = requireIdempotencyKey(req);
    if (!key.ok) {
      sendError(res, apiError(key.code, key.message, {}, false, 400), options.requestId, options.receivedAt);
      return true;
    }
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    const mutation = {
      review: service.startReview,
      'need-more-info': service.requestMoreInfo,
      approve: service.approveNewCustomer,
      'link-existing': service.linkExistingCustomer,
      reject: service.rejectRequest,
      cancel: service.cancelRequest,
    }[action];
    await executeMutation(req, res, options, {
      requestContext,
      route: `${collectionPath}/:id/${action}`,
      payload,
      idempotencyKey: key.key,
      action: action.replaceAll('-', '_'),
      mutate: (client) => mutation(client, { requestContext, id, payload }),
    });
    return true;
  }

  sendError(res, apiError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), options.requestId, options.receivedAt);
  return true;
}
