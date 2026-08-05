import { createSuccessEnvelope } from '@npp/contracts';
import { sendError, sendJson, sendSuccess } from '../http-utils.js';
import { readJsonBody } from '../idempotency.js';
import {
  withAuditOutboxTransaction,
  buildAuditRecord,
  insertAuditRecord,
  buildOutboxEvent,
  insertOutboxEvent,
} from '../audit-outbox.js';
import * as warehouseRepository from '../db/repositories/warehouse.js';
import * as service from '../services/customer-return-credit.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(code) {
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'FORBIDDEN' || code === 'WAREHOUSE_SCOPE_DENIED') return 403;
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (
    code.includes('CONFLICT') || code.includes('MISMATCH') || code.includes('EXCEEDS')
    || code.includes('ALREADY') || code.includes('EXISTS') || code.includes('REVERSED')
    || code.includes('DUPLICATE') || code.includes('ACTIVE_REFUND')
  ) return 409;
  return 400;
}

function sendServiceError(res, result, options) {
  sendError(
    res,
    apiError(
      result.code,
      result.message,
      result.details ?? {},
      Boolean(result.retryable),
      statusFor(result.code),
    ),
    options.requestId,
    options.receivedAt,
  );
}

function withWarehouseScopes(requestContext, warehouseIds) {
  const scopes = Object.freeze({
    branchIds: Object.freeze([...(requestContext.scopes?.branchIds ?? [])]),
    warehouseIds: Object.freeze(warehouseIds),
    territoryIds: Object.freeze([...(requestContext.scopes?.territoryIds ?? [])]),
  });
  return Object.freeze({
    ...requestContext,
    scopes,
    authContext: requestContext.authContext
      ? Object.freeze({ ...requestContext.authContext, scopes })
      : requestContext.authContext,
  });
}

async function ensureWarehouseScopes(client, requestContext) {
  if (Array.isArray(requestContext.scopes?.warehouseIds) && requestContext.scopes.warehouseIds.length) {
    return requestContext;
  }
  if (!Array.isArray(requestContext.roles) || !requestContext.roles.includes('bootstrap')) {
    return requestContext;
  }
  const warehouses = await warehouseRepository.listWarehousesForInstallation(client, {
    installationId: requestContext.installationId,
    active: undefined,
    limit: 10000,
    offset: 0,
  });
  return withWarehouseScopes(requestContext, warehouses.map((warehouse) => warehouse.id));
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
  const scoped = await ensureWarehouseScopes(options.getPool(), requestContext);
  if (!Array.isArray(scoped.scopes?.warehouseIds) || scoped.scopes.warehouseIds.length === 0) {
    sendError(
      res,
      apiError('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required', {}, false, 403),
      options.requestId,
      options.receivedAt,
    );
    return null;
  }
  return scoped;
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

async function executeMutation(req, res, options, {
  requestContext,
  route,
  input,
  statusCode = 200,
  action,
  resourceType,
  eventType,
  entityFrom,
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
      payload: input,
      onProcess: async ({ idempotencyKey } = {}) => {
        const transaction = await withAuditOutboxTransaction({
          adapter: options.getPool(),
          mutate: async (client) => {
            const result = await mutate(client, idempotencyKey ?? String(req.headers['idempotency-key'] ?? ''));
            if (!result.ok) return { failed: true, result };
            const entity = entityFrom(result);
            const audit = buildAuditRecord({
              requestContext,
              action,
              resourceType,
              resourceId: entity.id,
              beforeData: null,
              afterData: entity,
              metadata: { route, action },
            });
            const outbox = buildOutboxEvent({
              requestContext,
              aggregateType: resourceType,
              aggregateId: entity.id,
              eventType,
              eventVersion: 1,
              payload: entity,
              metadata: { route, action },
            });
            await insertAuditRecord(client, audit);
            await insertOutboxEvent(client, outbox);
            return { entity };
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
          body: createSuccessEnvelope(transaction.entity, options.requestId, options.receivedAt),
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
        error?.code ?? 'CUSTOMER_RETURN_CREDIT_TRANSACTION_FAILED',
        'Customer Return credit transaction failed',
        {},
        true,
        error?.statusCode ?? 503,
      ),
      options.requestId,
      options.receivedAt,
    );
  }
}

function parseInteger(value, fallback, min, max) {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw Object.assign(new Error('invalid_query'), {
      code: 'INVALID_QUERY_PARAMETER',
      publicMessage: `Query parameter must be between ${min} and ${max}`,
      statusCode: 400,
    });
  }
  return parsed;
}

export async function handleCustomerReturnCreditRoutes(req, res, options) {
  const url = new URL(`http://localhost${req.url}`);
  const pathname = url.pathname;
  const inScope = pathname === '/api/customer-return-credits'
    || pathname.startsWith('/api/customer-return-credits/')
    || pathname === '/api/customer-refunds'
    || pathname.startsWith('/api/customer-refunds/');
  if (!inScope) return false;
  const method = String(req.method || 'GET').toUpperCase();

  try {
    if (pathname === '/api/customer-return-credits' && method === 'GET') {
      const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreCustomerReturnCreditRead);
      if (!requestContext) return true;
      const result = await service.listCustomerReturnCredits(options.getPool(), {
        requestContext,
        customerId: url.searchParams.get('customerId'),
        warehouseId: url.searchParams.get('warehouseId'),
        status: url.searchParams.get('status'),
        currencyCode: url.searchParams.get('currencyCode'),
        search: url.searchParams.get('search'),
        limit: parseInteger(url.searchParams.get('limit'), 100, 1, 1000),
        offset: parseInteger(url.searchParams.get('offset'), 0, 0, 100000),
      });
      if (!result.ok) sendServiceError(res, result, options);
      else sendSuccess(res, result.customerReturnCredits, options.requestId, options.receivedAt);
      return true;
    }

    const creditDetail = pathname.match(/^\/api\/customer-return-credits\/([^/]+)$/);
    if (creditDetail && method === 'GET') {
      const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreCustomerReturnCreditRead);
      if (!requestContext) return true;
      const result = await service.getCustomerReturnCredit(options.getPool(), { requestContext, id: creditDetail[1] });
      if (!result.ok) sendServiceError(res, result, options);
      else sendSuccess(res, result.customerReturnCredit, options.requestId, options.receivedAt);
      return true;
    }

    const creditAllocation = pathname.match(/^\/api\/customer-return-credits\/([^/]+)\/allocations$/);
    if (creditAllocation && method === 'POST') {
      const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreCustomerReturnCreditAllocate);
      if (!requestContext) return true;
      const input = await readPayload(req, res, options);
      if (input === null) return true;
      await executeMutation(req, res, options, {
        requestContext,
        route: pathname,
        input,
        action: 'allocate',
        resourceType: 'accounting.customer_return_credit',
        eventType: 'accounting.customer_return_credit.allocated',
        entityFrom: (result) => result.customerReturnCredit,
        mutate: (client) => service.allocateCustomerReturnCredit(client, {
          requestContext,
          id: creditAllocation[1],
          payload: input,
        }),
      });
      return true;
    }

    const creditReverse = pathname.match(/^\/api\/customer-return-credits\/([^/]+)\/reverse$/);
    if (creditReverse && method === 'POST') {
      const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreCustomerReturnCreditReverse);
      if (!requestContext) return true;
      const input = await readPayload(req, res, options);
      if (input === null) return true;
      await executeMutation(req, res, options, {
        requestContext,
        route: pathname,
        input,
        action: 'reverse',
        resourceType: 'accounting.customer_return_credit',
        eventType: 'accounting.customer_return_credit.reversed',
        entityFrom: (result) => result.customerReturnCredit,
        mutate: (client) => service.reverseCustomerReturnCredit(client, {
          requestContext,
          id: creditReverse[1],
          payload: input,
        }),
      });
      return true;
    }

    if (pathname === '/api/customer-refunds' && method === 'POST') {
      const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreCustomerRefundCreate);
      if (!requestContext) return true;
      const input = await readPayload(req, res, options);
      if (input === null) return true;
      await executeMutation(req, res, options, {
        requestContext,
        route: pathname,
        input,
        statusCode: 201,
        action: 'create-refund',
        resourceType: 'accounting.customer_refund',
        eventType: 'accounting.customer_refund.posted',
        entityFrom: (result) => result.refund,
        mutate: (client, idempotencyKey) => service.createCustomerRefund(client, {
          requestContext,
          payload: input,
          idempotencyKey,
        }),
      });
      return true;
    }

    const refundReverse = pathname.match(/^\/api\/customer-refunds\/([^/]+)\/reverse$/);
    if (refundReverse && method === 'POST') {
      const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreCustomerRefundReverse);
      if (!requestContext) return true;
      const input = await readPayload(req, res, options);
      if (input === null) return true;
      await executeMutation(req, res, options, {
        requestContext,
        route: pathname,
        input,
        action: 'reverse-refund',
        resourceType: 'accounting.customer_refund',
        eventType: 'accounting.customer_refund.reversed',
        entityFrom: (result) => result.refund,
        mutate: (client) => service.reverseCustomerRefund(client, {
          requestContext,
          id: refundReverse[1],
          payload: input,
        }),
      });
      return true;
    }
  } catch (error) {
    sendError(
      res,
      apiError(
        error?.code ?? 'CUSTOMER_RETURN_CREDIT_REQUEST_FAILED',
        error?.publicMessage ?? 'Customer Return credit request failed',
        {},
        false,
        error?.statusCode ?? 500,
      ),
      options.requestId,
      options.receivedAt,
    );
    return true;
  }

  sendError(res, apiError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), options.requestId, options.receivedAt);
  return true;
}
