import { createErrorEnvelope, createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson, sendSuccess } from '../http-utils.js';
import { normalizeIdempotencyKey, readJsonBody } from '../idempotency.js';
import {
  buildAuditRecord,
  buildOutboxEvent,
  insertAuditRecord,
  insertOutboxEvent,
  withAuditOutboxTransaction,
} from '../audit-outbox.js';
import * as onboardingService from '../services/customer-onboarding.js';
import * as profileService from '../services/customer-portal-profile.js';
import * as registrationService from '../services/customer-portal-registration.js';
import * as service from '../services/customer-portal.js';

const ORDER_PATH = /^\/api\/customer-portal\/orders\/([0-9a-f-]{36})$/i;
const CANCEL_PATH = /^\/api\/customer-portal\/orders\/([0-9a-f-]{36})\/cancel$/i;
const REGISTRATION_COLLECTION = '/api/customer-portal/registrations';
const REGISTRATION_CURRENT = '/api/customer-portal/registrations/current';
const REGISTRATION_RESUBMIT_PATH = /^\/api\/customer-portal\/registrations\/([0-9a-f-]{36})\/resubmit$/i;
const STATIC_PATHS = new Set([
  '/api/customer-portal/me',
  '/api/customer-portal/addresses',
  '/api/customer-portal/catalog',
  '/api/customer-portal/orders',
  REGISTRATION_COLLECTION,
  REGISTRATION_CURRENT,
]);
const RETRYABLE_ERROR_CODES = new Set(['40001', '40P01', '57P01', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE']);

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(code, fallback = 400) {
  if (code === 'CUSTOMER_PORTAL_AUTH_REQUIRED' || code.includes('TOKEN_')) return 401;
  if (code === 'INVALID_IDEMPOTENCY_KEY' || code === 'MISSING_IDEMPOTENCY_KEY') return 400;
  if (code.includes('CONFLICT') || code.includes('DUPLICATE') || code.includes('IDEMPOTENCY') || code === 'INVALID_STATUS_TRANSITION' || code === 'SALES_ORDER_HAS_EXECUTION_FACTS' || code === 'CUSTOMER_PORTAL_ALREADY_ACTIVE') return 409;
  if (code.includes('MEMBERSHIP') || code.includes('SUSPENDED') || code.endsWith('_FORBIDDEN') || code === 'DELIVERY_ADDRESS_NOT_FOUND') return 403;
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (code.includes('UNAVAILABLE') || code.includes('NOT_CONFIGURED')) return 503;
  return fallback;
}

function isKnownPath(pathname) {
  return STATIC_PATHS.has(pathname)
    || ORDER_PATH.test(pathname)
    || CANCEL_PATH.test(pathname)
    || REGISTRATION_RESUBMIT_PATH.test(pathname);
}

function sendServiceError(res, result, options) {
  sendError(
    res,
    apiError(result.code, result.message ?? 'Yêu cầu Customer Portal không thành công.', result.details ?? {}, Boolean(result.retryable), result.statusCode ?? statusFor(result.code)),
    options.requestId,
    options.receivedAt,
  );
}

async function readPayload(req, res, options) {
  try {
    return await readJsonBody(req);
  } catch (error) {
    sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), options.requestId, options.receivedAt);
    return null;
  }
}

function idempotencyKey(req) {
  try {
    const key = normalizeIdempotencyKey(req.headers['idempotency-key']);
    return key ? { ok: true, key } : { ok: false, code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key header is required' };
  } catch (error) {
    return { ok: false, code: error.code ?? 'INVALID_IDEMPOTENCY_KEY', message: 'Idempotency-Key is invalid' };
  }
}

async function authenticateIdentity(req, res, options) {
  const auth = await options.customerPortalAuth.authenticate(req);
  if (!auth.ok) {
    if (auth.statusCode === 401) res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, apiError(auth.code, auth.statusCode === 503 ? 'Customer Portal authentication is unavailable.' : 'Authorization required.', {}, auth.statusCode === 503, auth.statusCode), options.requestId, options.receivedAt);
    return null;
  }
  const requestContext = registrationService.createPortalRegistrationRequestContext(
    options.createContext,
    options.config,
    auth.subject,
    { requestId: options.requestId, receivedAt: options.receivedAt },
  );
  return Object.freeze({ ...auth, requestContext });
}

async function authenticateMembership(identityAuth, req, res, options) {
  const membershipResult = await service.resolvePortalMembership(options.getPool(), {
    installationId: options.config.installationId,
    subject: identityAuth.subject,
  });
  if (!membershipResult.ok) {
    sendServiceError(res, membershipResult, options);
    return null;
  }
  const requestContext = service.createPortalRequestContext(
    options.createContext,
    options.config,
    membershipResult.membership,
    { requestId: options.requestId, receivedAt: options.receivedAt },
  );
  req.requestContext = requestContext;
  return Object.freeze({ requestContext, membership: membershipResult.membership, claims: identityAuth.claims });
}

async function auditMutation(client, { requestContext, action, eventType, order }) {
  await insertAuditRecord(client, buildAuditRecord({
    requestContext,
    action,
    resourceType: 'sales_order',
    resourceId: order.id,
    afterData: order,
    metadata: { source: 'CUSTOMER_PORTAL' },
  }));
  await insertOutboxEvent(client, buildOutboxEvent({
    requestContext,
    aggregateType: 'sales_order',
    aggregateId: order.id,
    eventType,
    eventVersion: 1,
    payload: order,
    metadata: { source: 'CUSTOMER_PORTAL' },
  }));
}

async function auditRegistrationMutation(client, { requestContext, action, request, portalUserId }) {
  await insertAuditRecord(client, buildAuditRecord({
    requestContext,
    action: `customer_portal.registration.${action}`,
    resourceType: 'customer_onboarding_request',
    resourceId: request.id,
    afterData: request,
    metadata: { source: 'CUSTOMER_PORTAL', portalUserId },
  }));
  await insertOutboxEvent(client, buildOutboxEvent({
    requestContext,
    aggregateType: 'sales.customer_onboarding_request',
    aggregateId: request.id,
    eventType: `sales.customer_onboarding.customer_portal_${action}`,
    eventVersion: request.version,
    payload: request,
    metadata: { source: 'CUSTOMER_PORTAL', portalUserId },
  }));
}

async function auditProfileMutation(client, { requestContext, membership, beforeProfile, profile }) {
  await insertAuditRecord(client, buildAuditRecord({
    requestContext,
    action: 'customer_portal.profile.update',
    resourceType: 'customer',
    resourceId: membership.customer_id,
    beforeData: beforeProfile,
    afterData: profile,
    metadata: { source: 'CUSTOMER_PORTAL', portalUserId: membership.portal_user_id },
  }));
  await insertOutboxEvent(client, buildOutboxEvent({
    requestContext,
    aggregateType: 'shared.customer',
    aggregateId: membership.customer_id,
    eventType: 'shared.customer.customer_portal_profile_updated',
    eventVersion: 1,
    payload: profile,
    metadata: { source: 'CUSTOMER_PORTAL', portalUserId: membership.portal_user_id },
  }));
}

function rollbackBusinessFailure(result) {
  return Object.freeze({ ...result, failed: true });
}

function auditedBusinessSuccess(result) {
  return Object.freeze({ ...result, expectedAuditCount: 1, expectedOutboxCount: 1 });
}

function idempotentSuccess(data, options, statusCode = 200) {
  return { statusCode, contentType: 'application/json', requestId: options.requestId, body: createSuccessEnvelope(data, options.requestId, options.receivedAt) };
}

function idempotentFailure(result, options) {
  const error = apiError(result.code, result.message ?? 'Yêu cầu Customer Portal không thành công.', result.details ?? {}, Boolean(result.retryable), result.statusCode ?? statusFor(result.code));
  return { statusCode: error.statusCode, contentType: 'application/json', requestId: options.requestId, body: createErrorEnvelope(error, options.requestId, options.receivedAt) };
}

function parseCatalogQuery(url) {
  const limit = Number(url.searchParams.get('limit') ?? 50);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  return {
    search: (url.searchParams.get('search') ?? '').slice(0, 256),
    limit: Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.trunc(limit))) : 50,
    offset: Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0,
  };
}

function unexpectedMutationError(error, operation, options) {
  const code = typeof error?.code === 'string' ? error.code : null;
  const retryable = error?.retryable === true || (code ? RETRYABLE_ERROR_CODES.has(code) : false);
  console.error(JSON.stringify({
    event: 'customer_portal_mutation_error',
    operation,
    requestId: options.requestId,
    error: {
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error ?? 'unknown'),
      code,
    },
  }));
  const isRegistration = operation.startsWith('registration');
  const isProfileUpdate = operation === 'profile-update';
  const isCreate = operation === 'create';
  return apiError(
    isRegistration ? 'CUSTOMER_PORTAL_REGISTRATION_FAILED' : isProfileUpdate ? 'CUSTOMER_PORTAL_PROFILE_UPDATE_FAILED' : isCreate ? 'CUSTOMER_PORTAL_ORDER_CREATE_FAILED' : 'CUSTOMER_PORTAL_ORDER_CANCEL_FAILED',
    isRegistration ? 'Không thể xử lý đăng ký điểm bán.' : isProfileUpdate ? 'Không thể cập nhật thông tin điểm bán.' : isCreate ? 'Không thể tạo đơn hàng.' : 'Không thể hủy đơn hàng.',
    {},
    retryable,
    retryable ? 503 : 500,
  );
}

async function handleRegistrationRoutes(req, res, options, url, identityAuth) {
  const resubmitMatch = REGISTRATION_RESUBMIT_PATH.exec(url.pathname);
  const requestContext = identityAuth.requestContext;

  if (req.method === 'GET' && url.pathname === REGISTRATION_CURRENT) {
    const identityResult = await registrationService.resolvePortalIdentity(options.getPool(), {
      installationId: requestContext.installationId,
      subject: identityAuth.subject,
    });
    if (!identityResult.ok) {
      sendServiceError(res, identityResult, options);
      return true;
    }
    if (!identityResult.identity) {
      sendSuccess(res, { state: 'unregistered', registration: null, profile: null }, options.requestId, options.receivedAt);
      return true;
    }
    const membershipResult = await registrationService.resolvePortalMembershipByUser(options.getPool(), {
      installationId: requestContext.installationId,
      portalUserId: identityResult.identity.portal_user_id,
    });
    if (!membershipResult.ok) {
      sendServiceError(res, membershipResult, options);
      return true;
    }
    const registrationResult = await onboardingService.getPortalRegistration(options.getPool(), {
      requestContext,
      portalUserId: identityResult.identity.portal_user_id,
    });
    const state = registrationService.registrationState({
      identity: identityResult.identity,
      membership: membershipResult.membership,
      membershipUnavailable: membershipResult.membershipUnavailable,
      request: registrationResult.request,
    });
    sendSuccess(res, {
      state,
      registration: registrationService.publicRegistration(registrationResult.request),
      profile: membershipResult.membership ? service.portalProfile(membershipResult.membership) : null,
    }, options.requestId, options.receivedAt);
    return true;
  }

  if (req.method === 'POST' && url.pathname === REGISTRATION_COLLECTION) {
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    const key = idempotencyKey(req);
    if (!key.ok) {
      sendError(res, apiError(key.code, key.message, {}, false, 400), options.requestId, options.receivedAt);
      return true;
    }
    try {
      const execution = await options.executeRequestWithIdempotency({
        idempotencyStore: options.idempotencyStore,
        req,
        requestContext,
        requestId: options.requestId,
        receivedAt: options.receivedAt,
        route: REGISTRATION_COLLECTION,
        payload,
        onProcess: async () => {
          const result = await withAuditOutboxTransaction({
            adapter: options.getPool(),
            mutate: async (client) => {
              const identityResult = await registrationService.ensurePortalIdentity(client, {
                requestContext,
                subject: identityAuth.subject,
                displayName: payload?.proposedCustomer?.name,
              });
              if (!identityResult.ok) return rollbackBusinessFailure(identityResult);
              const membershipResult = await registrationService.resolvePortalMembershipByUser(client, {
                installationId: requestContext.installationId,
                portalUserId: identityResult.identity.portal_user_id,
              });
              if (!membershipResult.ok) return rollbackBusinessFailure(membershipResult);
              if (membershipResult.hasActiveMembership) {
                return rollbackBusinessFailure({
                  ok: false,
                  code: 'CUSTOMER_PORTAL_ALREADY_ACTIVE',
                  message: 'Tài khoản đã được kích hoạt cho khách hàng.',
                  statusCode: 409,
                });
              }
              const submitted = await onboardingService.submitPortalRegistration(client, {
                requestContext,
                portalUserId: identityResult.identity.portal_user_id,
                payload,
                idempotencyKey: key.key,
              });
              if (!submitted.ok) return rollbackBusinessFailure(submitted);
              if (submitted.replayed === true) return { ...submitted, portalUserId: identityResult.identity.portal_user_id, replayed: true };
              await auditRegistrationMutation(client, {
                requestContext,
                action: 'submitted',
                request: submitted.request,
                portalUserId: identityResult.identity.portal_user_id,
              });
              return auditedBusinessSuccess({ ...submitted, portalUserId: identityResult.identity.portal_user_id });
            },
          });
          if (!result.ok) return idempotentFailure(result, options);
          return idempotentSuccess({
            state: result.request.status,
            registration: registrationService.publicRegistration(result.request),
            replayed: Boolean(result.replayed),
          }, options, result.replayed ? 200 : 201);
        },
      });
      sendJson(res, execution.response.statusCode, execution.response.body, execution.response.requestId ?? options.requestId, execution.response.contentType);
    } catch (error) {
      sendError(res, unexpectedMutationError(error, 'registration-submit', options), options.requestId, options.receivedAt);
    }
    return true;
  }

  if (req.method === 'POST' && resubmitMatch) {
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    const key = idempotencyKey(req);
    if (!key.ok) {
      sendError(res, apiError(key.code, key.message, {}, false, 400), options.requestId, options.receivedAt);
      return true;
    }
    try {
      const execution = await options.executeRequestWithIdempotency({
        idempotencyStore: options.idempotencyStore,
        req,
        requestContext,
        requestId: options.requestId,
        receivedAt: options.receivedAt,
        route: `${REGISTRATION_COLLECTION}/${resubmitMatch[1]}/resubmit`,
        payload,
        onProcess: async () => {
          const result = await withAuditOutboxTransaction({
            adapter: options.getPool(),
            mutate: async (client) => {
              const identityResult = await registrationService.resolvePortalIdentity(client, {
                installationId: requestContext.installationId,
                subject: identityAuth.subject,
                forUpdate: true,
              });
              if (!identityResult.ok) return rollbackBusinessFailure(identityResult);
              if (!identityResult.identity) {
                return rollbackBusinessFailure({ ok: false, code: 'CUSTOMER_ONBOARDING_NOT_FOUND', message: 'Customer registration was not found', statusCode: 404 });
              }
              const updated = await onboardingService.resubmitPortalRegistration(client, {
                requestContext,
                portalUserId: identityResult.identity.portal_user_id,
                id: resubmitMatch[1],
                payload,
                idempotencyKey: key.key,
              });
              if (!updated.ok) return rollbackBusinessFailure(updated);
              await auditRegistrationMutation(client, {
                requestContext,
                action: 'resubmitted',
                request: updated.request,
                portalUserId: identityResult.identity.portal_user_id,
              });
              return auditedBusinessSuccess(updated);
            },
          });
          if (!result.ok) return idempotentFailure(result, options);
          return idempotentSuccess({
            state: result.request.status,
            registration: registrationService.publicRegistration(result.request),
          }, options);
        },
      });
      sendJson(res, execution.response.statusCode, execution.response.body, execution.response.requestId ?? options.requestId, execution.response.contentType);
    } catch (error) {
      sendError(res, unexpectedMutationError(error, 'registration-resubmit', options), options.requestId, options.receivedAt);
    }
    return true;
  }

  if (url.pathname === REGISTRATION_COLLECTION || url.pathname === REGISTRATION_CURRENT || resubmitMatch) {
    sendError(res, apiError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), options.requestId, options.receivedAt);
    return true;
  }
  return false;
}

export async function handleCustomerPortalRoutes(req, res, options) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (!url.pathname.startsWith('/api/customer-portal')) return false;
  const identityAuth = await authenticateIdentity(req, res, options);
  if (!identityAuth) return true;
  res.setHeader('Cache-Control', 'no-store');

  const registrationHandled = await handleRegistrationRoutes(req, res, options, url, identityAuth);
  if (registrationHandled) return true;

  const portal = await authenticateMembership(identityAuth, req, res, options);
  if (!portal) return true;
  const { requestContext, membership } = portal;

  if (req.method === 'GET' && url.pathname === '/api/customer-portal/me') {
    const result = await profileService.getPortalProfile(options.getPool(), { requestContext, membership });
    result.ok ? sendSuccess(res, { profile: result.profile }, options.requestId, options.receivedAt) : sendServiceError(res, result, options);
    return true;
  }

  if (req.method === 'PATCH' && url.pathname === '/api/customer-portal/me') {
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    const key = idempotencyKey(req);
    if (!key.ok) {
      sendError(res, apiError(key.code, key.message, {}, false, 400), options.requestId, options.receivedAt);
      return true;
    }
    try {
      const execution = await options.executeRequestWithIdempotency({
        idempotencyStore: options.idempotencyStore,
        req,
        requestContext,
        requestId: options.requestId,
        receivedAt: options.receivedAt,
        route: '/api/customer-portal/me',
        payload,
        onProcess: async () => {
          const result = await withAuditOutboxTransaction({
            adapter: options.getPool(),
            mutate: async (client) => {
              const updated = await profileService.updatePortalProfile(client, { requestContext, membership, payload });
              if (!updated.ok) return rollbackBusinessFailure(updated);
              await auditProfileMutation(client, {
                requestContext,
                membership,
                beforeProfile: updated.beforeProfile,
                profile: updated.profile,
              });
              return auditedBusinessSuccess(updated);
            },
          });
          if (!result.ok) return idempotentFailure(result, options);
          return idempotentSuccess({ profile: result.profile }, options);
        },
      });
      sendJson(res, execution.response.statusCode, execution.response.body, execution.response.requestId ?? options.requestId, execution.response.contentType);
    } catch (error) {
      sendError(res, unexpectedMutationError(error, 'profile-update', options), options.requestId, options.receivedAt);
    }
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/customer-portal/addresses') {
    const result = await service.listPortalAddresses(options.getPool(), { requestContext, membership });
    result.ok ? sendSuccess(res, { addresses: result.addresses }, options.requestId, options.receivedAt) : sendServiceError(res, result, options);
    return true;
  }
  if (req.method === 'GET' && url.pathname === '/api/customer-portal/catalog') {
    const result = await service.listPortalCatalog(options.getPool(), { requestContext, membership, ...parseCatalogQuery(url) });
    result.ok ? sendSuccess(res, { items: result.items, limit: result.limit, offset: result.offset, hasMore: result.hasMore }, options.requestId, options.receivedAt) : sendServiceError(res, result, options);
    return true;
  }
  if (req.method === 'GET' && url.pathname === '/api/customer-portal/orders') {
    const result = await service.listPortalOrders(options.getPool(), { requestContext, membership });
    result.ok ? sendSuccess(res, { orders: result.orders }, options.requestId, options.receivedAt) : sendServiceError(res, result, options);
    return true;
  }

  const orderMatch = ORDER_PATH.exec(url.pathname);
  if (req.method === 'GET' && orderMatch) {
    const result = await service.getPortalOrder(options.getPool(), { requestContext, membership, orderId: orderMatch[1] });
    result.ok ? sendSuccess(res, { order: result.order }, options.requestId, options.receivedAt) : sendServiceError(res, result, options);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/customer-portal/orders') {
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    const key = idempotencyKey(req);
    if (!key.ok) {
      sendError(res, apiError(key.code, key.message, {}, false, 400), options.requestId, options.receivedAt);
      return true;
    }
    try {
      const execution = await options.executeRequestWithIdempotency({
        idempotencyStore: options.idempotencyStore,
        req,
        requestContext,
        requestId: options.requestId,
        receivedAt: options.receivedAt,
        route: '/api/customer-portal/orders',
        payload,
        onProcess: async () => {
          const result = await withAuditOutboxTransaction({
            adapter: options.getPool(),
            mutate: async (client) => {
              const created = await service.createPortalOrder(client, { requestContext, membership, idempotencyKey: key.key, payload });
              if (!created.ok) return rollbackBusinessFailure(created);
              await auditMutation(client, { requestContext, action: 'customer_portal_create', eventType: 'sales.sales_order.customer_portal_created', order: created.order });
              return auditedBusinessSuccess(created);
            },
          });
          if (!result.ok) return idempotentFailure(result, options);
          return idempotentSuccess({ order: result.order }, options, 201);
        },
      });
      sendJson(res, execution.response.statusCode, execution.response.body, execution.response.requestId ?? options.requestId, execution.response.contentType);
    } catch (error) {
      sendError(res, unexpectedMutationError(error, 'create', options), options.requestId, options.receivedAt);
    }
    return true;
  }

  const cancelMatch = CANCEL_PATH.exec(url.pathname);
  if (req.method === 'POST' && cancelMatch) {
    const payload = await readPayload(req, res, options);
    if (payload === null) return true;
    const key = idempotencyKey(req);
    if (!key.ok) {
      sendError(res, apiError(key.code, key.message, {}, false, 400), options.requestId, options.receivedAt);
      return true;
    }
    try {
      const execution = await options.executeRequestWithIdempotency({
        idempotencyStore: options.idempotencyStore,
        req,
        requestContext,
        requestId: options.requestId,
        receivedAt: options.receivedAt,
        route: `/api/customer-portal/orders/${cancelMatch[1]}/cancel`,
        payload,
        onProcess: async () => {
          const result = await withAuditOutboxTransaction({
            adapter: options.getPool(),
            mutate: async (client) => {
              const cancelled = await service.cancelPortalOrder(client, {
                requestContext,
                membership,
                orderId: cancelMatch[1],
                idempotencyKey: key.key,
              });
              if (!cancelled.ok) return rollbackBusinessFailure(cancelled);
              await auditMutation(client, { requestContext, action: 'customer_portal_cancel', eventType: 'sales.sales_order.customer_portal_cancelled', order: cancelled.order });
              return auditedBusinessSuccess(cancelled);
            },
          });
          if (!result.ok) return idempotentFailure(result, options);
          return idempotentSuccess({ order: result.order }, options);
        },
      });
      sendJson(res, execution.response.statusCode, execution.response.body, execution.response.requestId ?? options.requestId, execution.response.contentType);
    } catch (error) {
      sendError(res, unexpectedMutationError(error, 'cancel', options), options.requestId, options.receivedAt);
    }
    return true;
  }

  const knownPath = isKnownPath(url.pathname);
  sendError(
    res,
    apiError(knownPath ? 'METHOD_NOT_ALLOWED' : 'CUSTOMER_PORTAL_ROUTE_NOT_FOUND', knownPath ? 'Method not allowed' : 'Route not found', {}, false, knownPath ? 405 : 404),
    options.requestId,
    options.receivedAt,
  );
  return true;
}
