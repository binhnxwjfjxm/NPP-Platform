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
import * as service from '../services/supplier-payment.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(code) {
  if (code === 'UNAUTHORIZED') return 401;
  if (code === 'FORBIDDEN' || code === 'WAREHOUSE_SCOPE_DENIED') return 403;
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (code.includes('CONFLICT') || code.includes('MISMATCH') || code.includes('EXCEEDS') || code.includes('ALREADY')) return 409;
  return 400;
}

function sendServiceError(res, result, options) {
  sendError(res, apiError(result.code, result.message, result.details ?? {}, Boolean(result.retryable), statusFor(result.code)), options.requestId, options.receivedAt);
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
    authContext: requestContext.authContext ? Object.freeze({ ...requestContext.authContext, scopes }) : requestContext.authContext,
  });
}

async function ensureWarehouseScopes(client, requestContext) {
  if (Array.isArray(requestContext.scopes?.warehouseIds) && requestContext.scopes.warehouseIds.length) return requestContext;
  if (!Array.isArray(requestContext.roles) || !requestContext.roles.includes('bootstrap')) return requestContext;
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
    sendError(res, apiError('WAREHOUSE_SCOPE_DENIED', 'At least one authorized warehouse is required', {}, false, 403), options.requestId, options.receivedAt);
    return null;
  }
  return scoped;
}

async function payload(req, res, options) {
  try {
    return await readJsonBody(req);
  } catch (error) {
    sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), options.requestId, options.receivedAt);
    return null;
  }
}

async function executeMutation(req, res, options, {
  requestContext, route, input, statusCode = 200, action, resourceType, eventType, mutate,
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
            const entity = result.supplierPayment ?? result.allocation;
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
            return { entity, eventId: outbox.eventId };
          },
        });
        if (transaction.failed) {
          const result = transaction.result;
          return {
            statusCode: statusFor(result.code),
            contentType: 'application/json',
            requestId: options.requestId,
            body: { error: { code: result.code, message: result.message, retryable: Boolean(result.retryable), details: result.details ?? {} }, requestId: options.requestId, receivedAt: options.receivedAt },
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
    sendJson(res, execution.response.statusCode, execution.response.body, execution.response.requestId ?? options.requestId, execution.response.contentType);
  } catch (error) {
    sendError(res, apiError(error?.code ?? 'SUPPLIER_PAYMENT_TRANSACTION_FAILED', 'Supplier payment transaction failed', {}, true, error?.statusCode ?? 503), options.requestId, options.receivedAt);
  }
}

function parseInteger(value, fallback, min, max) {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw Object.assign(new Error('invalid_query'), { code: 'INVALID_QUERY_PARAMETER', publicMessage: `Query parameter must be between ${min} and ${max}`, statusCode: 400 });
  return parsed;
}

export async function handleSupplierPaymentRoutes(req, res, options) {
  const url = new URL(`http://localhost${req.url}`);
  const pathname = url.pathname;
  const isPayment = pathname === '/api/supplier-payments' || pathname.startsWith('/api/supplier-payments/');
  const isAllocation = pathname === '/api/payable-allocations' || pathname.startsWith('/api/payable-allocations/');
  if (!isPayment && !isAllocation) return false;
  const method = String(req.method || 'GET').toUpperCase();

  try {
    if (pathname === '/api/supplier-payments' && method === 'GET') {
      const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreSupplierPaymentRead);
      if (!requestContext) return true;
      const result = await service.listSupplierPayments(options.getPool(), {
        requestContext,
        supplierId: url.searchParams.get('supplierId'),
        warehouseId: url.searchParams.get('warehouseId'),
        status: url.searchParams.get('status'),
        currencyCode: url.searchParams.get('currencyCode'),
        search: url.searchParams.get('search'),
        limit: parseInteger(url.searchParams.get('limit'), 100, 1, 1000),
        offset: parseInteger(url.searchParams.get('offset'), 0, 0, 100000),
      });
      if (!result.ok) return sendServiceError(res, result, options), true;
      sendSuccess(res, result.supplierPayments, options.requestId, options.receivedAt);
      return true;
    }

    if (pathname === '/api/supplier-payments/allocation-targets' && method === 'GET') {
      const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.corePayableRead);
      if (!requestContext) return true;
      const result = await service.listOpenAllocationTargets(options.getPool(), {
        requestContext,
        supplierId: url.searchParams.get('supplierId'),
        warehouseId: url.searchParams.get('warehouseId'),
        currencyCode: url.searchParams.get('currencyCode'),
      });
      if (!result.ok) return sendServiceError(res, result, options), true;
      sendSuccess(res, result.payableDocuments, options.requestId, options.receivedAt);
      return true;
    }

    if (pathname === '/api/supplier-payments' && method === 'POST') {
      const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreSupplierPaymentCreate);
      if (!requestContext) return true;
      const input = await payload(req, res, options);
      if (input === null) return true;
      await executeMutation(req, res, options, {
        requestContext, route: pathname, input, statusCode: 201,
        action: 'create', resourceType: 'accounting.supplier_payment', eventType: 'accounting.supplier_payment.posted',
        mutate: (client, idempotencyKey) => service.createSupplierPayment(client, { requestContext, payload: input, idempotencyKey }),
      });
      return true;
    }

    const paymentReverse = pathname.match(/^\/api\/supplier-payments\/([^/]+)\/reverse$/);
    if (paymentReverse && method === 'POST') {
      const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreSupplierPaymentReverse);
      if (!requestContext) return true;
      const input = await payload(req, res, options);
      if (input === null) return true;
      await executeMutation(req, res, options, {
        requestContext, route: pathname, input,
        action: 'reverse', resourceType: 'accounting.supplier_payment', eventType: 'accounting.supplier_payment.reversed',
        mutate: (client) => service.reverseSupplierPayment(client, { requestContext, id: paymentReverse[1], payload: input }),
      });
      return true;
    }

    const paymentDetail = pathname.match(/^\/api\/supplier-payments\/([^/]+)$/);
    if (paymentDetail && method === 'GET') {
      const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.coreSupplierPaymentRead);
      if (!requestContext) return true;
      const result = await service.getSupplierPayment(options.getPool(), { requestContext, id: paymentDetail[1] });
      if (!result.ok) return sendServiceError(res, result, options), true;
      sendSuccess(res, result.supplierPayment, options.requestId, options.receivedAt);
      return true;
    }

    if (pathname === '/api/payable-allocations' && method === 'POST') {
      const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.corePayableAllocationCreate);
      if (!requestContext) return true;
      const input = await payload(req, res, options);
      if (input === null) return true;
      await executeMutation(req, res, options, {
        requestContext, route: pathname, input, statusCode: 201,
        action: 'create', resourceType: 'accounting.payable_allocation', eventType: 'accounting.payable_allocation.created',
        mutate: (client) => service.createPayableAllocation(client, { requestContext, payload: input }),
      });
      return true;
    }

    const allocationReverse = pathname.match(/^\/api\/payable-allocations\/([^/]+)\/reverse$/);
    if (allocationReverse && method === 'POST') {
      const requestContext = await authenticateAndAuthorize(req, res, options, options.PERMISSIONS.corePayableAllocationReverse);
      if (!requestContext) return true;
      const input = await payload(req, res, options);
      if (input === null) return true;
      await executeMutation(req, res, options, {
        requestContext, route: pathname, input,
        action: 'reverse', resourceType: 'accounting.payable_allocation', eventType: 'accounting.payable_allocation.reversed',
        mutate: (client) => service.reversePayableAllocation(client, { requestContext, id: allocationReverse[1], payload: input }),
      });
      return true;
    }
  } catch (error) {
    sendError(res, apiError(error?.code ?? 'SUPPLIER_PAYMENT_REQUEST_FAILED', error?.publicMessage ?? 'Supplier payment request failed', {}, false, error?.statusCode ?? 500), options.requestId, options.receivedAt);
    return true;
  }

  sendError(res, apiError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), options.requestId, options.receivedAt);
  return true;
}
