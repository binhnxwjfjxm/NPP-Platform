import { createSuccessEnvelope } from '@npp/contracts';
import { sendJson, sendSuccess, sendError } from '../http-utils.js';
import { readJsonBody, normalizeIdempotencyKey } from '../idempotency.js';
import { buildAuditRecord, insertAuditRecord, withAuditOutboxTransaction } from '../audit-outbox.js';
import * as supplierService from '../services/supplier.js';

const CHILDREN = Object.freeze({
  contacts: Object.freeze({
    resourceType: 'supplier_contact',
    entityKey: 'contact',
    childIdKey: 'contactId',
    list: supplierService.listSupplierContacts,
    create: supplierService.createSupplierContact,
    update: supplierService.updateSupplierContact,
  }),
  addresses: Object.freeze({
    resourceType: 'supplier_address',
    entityKey: 'address',
    childIdKey: 'addressId',
    list: supplierService.listSupplierAddresses,
    create: supplierService.createSupplierAddress,
    update: supplierService.updateSupplierAddress,
  }),
  'payment-terms': Object.freeze({
    resourceType: 'supplier_payment_term',
    entityKey: 'paymentTerm',
    childIdKey: 'paymentTermId',
    list: supplierService.listSupplierPaymentTerms,
    create: supplierService.createSupplierPaymentTerm,
    update: supplierService.updateSupplierPaymentTerm,
  }),
});

function createError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function parseBooleanParam(value) {
  if (value === null) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw Object.assign(new Error('INVALID_QUERY_PARAMETER'), {
    code: 'INVALID_QUERY_PARAMETER',
    publicMessage: 'Query parameter must be true or false',
    statusCode: 400,
  });
}

function parsePositiveIntParam(value, defaultValue, maxValue) {
  if (value === null) return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > maxValue) {
    throw Object.assign(new Error('INVALID_QUERY_PARAMETER'), {
      code: 'INVALID_QUERY_PARAMETER',
      publicMessage: `Query parameter must be an integer between 0 and ${maxValue}`,
      statusCode: 400,
    });
  }
  return parsed;
}

function requireIdempotencyKey(req) {
  const raw = req.headers['idempotency-key'];
  if (raw === undefined || raw === null) {
    return { ok: false, code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key header is required' };
  }
  try {
    normalizeIdempotencyKey(raw);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      code: error.code ?? 'INVALID_IDEMPOTENCY_KEY',
      message: 'Idempotency-Key must be 1-128 characters and contain only letters, numbers, dots, underscores, or hyphens',
    };
  }
}

function serviceStatus(result) {
  if (['NOT_FOUND', 'EMPLOYEE_NOT_FOUND'].includes(result.code)) return 404;
  if (['DUPLICATE_CODE', 'CONFLICT', 'EMPLOYEE_INACTIVE', 'SUPPLIER_INACTIVE'].includes(result.code)) return 409;
  return 400;
}

function sendServiceError(res, result, context) {
  sendError(
    res,
    createError(result.code, result.message, {}, Boolean(result.retryable), serviceStatus(result)),
    context.requestId,
    context.receivedAt,
  );
}

async function readPayload(req, res, context) {
  try {
    return await readJsonBody(req);
  } catch (error) {
    sendError(
      res,
      createError(error.code, error.publicMessage, {}, false, error.statusCode),
      context.requestId,
      context.receivedAt,
    );
    return null;
  }
}

async function executeIdempotentCreate(req, res, context, {
  route,
  payload,
  create,
  resourceType,
  entityKey,
  metadata,
}) {
  const keyResult = requireIdempotencyKey(req);
  if (!keyResult.ok) {
    sendError(res, createError(keyResult.code, keyResult.message, {}, false, 400), context.requestId, context.receivedAt);
    return;
  }

  try {
    const execution = await context.executeRequestWithIdempotency({
      idempotencyStore: context.idempotencyStore,
      req,
      requestContext: context.requestContext,
      requestId: context.requestId,
      receivedAt: context.receivedAt,
      route,
      payload,
      onProcess: async () => {
        const transactionResult = await withAuditOutboxTransaction({
          adapter: context.getPool(),
          mutate: async (client) => {
            const serviceResult = await create(client);
            if (!serviceResult.ok) return { serviceResult, skipAudit: true };
            const entity = serviceResult[entityKey];
            await insertAuditRecord(client, buildAuditRecord({
              requestContext: context.requestContext,
              action: 'create',
              resourceType,
              resourceId: entity.id,
              afterData: entity,
              metadata: metadata(entity),
            }));
            return { entity };
          },
        });

        if (transactionResult.skipAudit) {
          const failed = transactionResult.serviceResult;
          return {
            statusCode: serviceStatus(failed),
            contentType: 'application/json',
            requestId: context.requestId,
            body: {
              error: {
                code: failed.code,
                message: failed.message,
                retryable: Boolean(failed.retryable),
                details: {},
              },
              requestId: context.requestId,
              receivedAt: context.receivedAt,
            },
          };
        }

        return {
          statusCode: 201,
          contentType: 'application/json',
          requestId: context.requestId,
          body: createSuccessEnvelope(transactionResult.entity, context.requestId, context.receivedAt),
        };
      },
    });

    res.setHeader('Cache-Control', 'no-store');
    sendJson(
      res,
      execution.response.statusCode,
      execution.response.body,
      execution.response.requestId ?? context.requestId,
      execution.response.contentType,
    );
  } catch {
    sendError(
      res,
      createError('IDEMPOTENCY_STORAGE_ERROR', 'Idempotency storage unavailable', {}, true, 503),
      context.requestId,
      context.receivedAt,
    );
  }
}

async function executePatch(res, context, {
  update,
  resourceType,
  entityKey,
  action = () => 'update',
  metadata,
}) {
  try {
    const transactionResult = await withAuditOutboxTransaction({
      adapter: context.getPool(),
      mutate: async (client) => {
        const serviceResult = await update(client);
        if (!serviceResult.ok) {
          throw Object.assign(new Error('SUPPLIER_MASTER_UPDATE_FAILED'), { serviceResult });
        }
        const entity = serviceResult[entityKey];
        if (serviceResult.changed === false) return { entity };
        await insertAuditRecord(client, buildAuditRecord({
          requestContext: context.requestContext,
          action: action(serviceResult),
          resourceType,
          resourceId: entity.id,
          beforeData: serviceResult.beforeData ?? null,
          afterData: entity,
          metadata: metadata(entity),
        }));
        return { entity };
      },
    });
    sendSuccess(res, transactionResult.entity, context.requestId, context.receivedAt);
  } catch (error) {
    if (error?.serviceResult) {
      sendServiceError(res, error.serviceResult, context);
      return;
    }
    sendError(res, createError('INTERNAL_ERROR', 'Failed to update supplier master data', {}, true, 500), context.requestId, context.receivedAt);
  }
}

async function handleListSuppliers(req, res, context) {
  const url = new URL(`http://localhost${req.url}`);
  let active;
  let limit;
  let offset;
  try {
    active = parseBooleanParam(url.searchParams.get('active'));
    limit = parsePositiveIntParam(url.searchParams.get('limit'), 100, 1000);
    offset = parsePositiveIntParam(url.searchParams.get('offset'), 0, 10000);
  } catch (error) {
    sendError(res, createError(error.code, error.publicMessage, {}, false, error.statusCode), context.requestId, context.receivedAt);
    return;
  }

  try {
    const result = await supplierService.listSuppliers(context.getPool(), {
      installationId: context.requestContext.installationId,
      search: url.searchParams.get('search'),
      active,
      limit,
      offset,
    });
    if (!result.ok) return sendServiceError(res, result, context);
    sendSuccess(res, result.suppliers, context.requestId, context.receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_ERROR', 'Failed to list suppliers', {}, true, 500), context.requestId, context.receivedAt);
  }
}

async function handleGetSupplier(res, context, id) {
  try {
    const result = await supplierService.getSupplier(context.getPool(), {
      installationId: context.requestContext.installationId,
      id,
    });
    if (!result.ok) return sendServiceError(res, result, context);
    sendSuccess(res, result.supplier, context.requestId, context.receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_ERROR', 'Failed to fetch supplier', {}, true, 500), context.requestId, context.receivedAt);
  }
}

async function handleCreateSupplier(req, res, context) {
  const payload = await readPayload(req, res, context);
  if (payload === null) return;
  await executeIdempotentCreate(req, res, context, {
    route: '/api/suppliers',
    payload,
    create: (client) => supplierService.createSupplier(client, {
      installationId: context.requestContext.installationId,
      payload,
      createdBy: context.requestContext.actorId,
    }),
    resourceType: 'supplier',
    entityKey: 'supplier',
    metadata: (supplier) => ({ code: supplier.code }),
  });
}

async function handlePatchSupplier(req, res, context, id) {
  const payload = await readPayload(req, res, context);
  if (payload === null) return;
  await executePatch(res, context, {
    update: (client) => supplierService.updateSupplier(client, {
      id,
      installationId: context.requestContext.installationId,
      payload,
      updatedBy: context.requestContext.actorId,
    }),
    resourceType: 'supplier',
    entityKey: 'supplier',
    action: (result) => result.action ?? 'update',
    metadata: (supplier) => ({ code: supplier.code }),
  });
}

async function handleListChild(res, context, supplierId, kind) {
  const child = CHILDREN[kind];
  try {
    const result = await child.list(context.getPool(), {
      installationId: context.requestContext.installationId,
      supplierId,
    });
    if (!result.ok) return sendServiceError(res, result, context);
    const collectionKey = kind === 'contacts' ? 'contacts' : kind === 'addresses' ? 'addresses' : 'paymentTerms';
    sendSuccess(res, result[collectionKey], context.requestId, context.receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_ERROR', `Failed to list supplier ${kind}`, {}, true, 500), context.requestId, context.receivedAt);
  }
}

async function handleCreateChild(req, res, context, supplierId, kind) {
  const payload = await readPayload(req, res, context);
  if (payload === null) return;
  const child = CHILDREN[kind];
  await executeIdempotentCreate(req, res, context, {
    route: `/api/suppliers/${supplierId}/${kind}`,
    payload,
    create: (client) => child.create(client, {
      installationId: context.requestContext.installationId,
      supplierId,
      payload,
      createdBy: context.requestContext.actorId,
    }),
    resourceType: child.resourceType,
    entityKey: child.entityKey,
    metadata: (entity) => ({ supplierId: entity.supplier_id }),
  });
}

async function handlePatchChild(req, res, context, supplierId, childId, kind) {
  const payload = await readPayload(req, res, context);
  if (payload === null) return;
  const child = CHILDREN[kind];
  await executePatch(res, context, {
    update: (client) => child.update(client, {
      installationId: context.requestContext.installationId,
      supplierId,
      [child.childIdKey]: childId,
      payload,
      updatedBy: context.requestContext.actorId,
    }),
    resourceType: child.resourceType,
    entityKey: child.entityKey,
    metadata: (entity) => ({ supplierId: entity.supplier_id }),
  });
}

export async function handleSupplierRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  const isSupplierPath = pathname === '/api/suppliers' || pathname.startsWith('/api/suppliers/');
  if (!isSupplierPath) return false;

  const authResult = options.authenticate(req, options.config);
  if (!authResult.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, createError('UNAUTHORIZED', 'Authorization required', {}, false, 401), options.requestId, options.receivedAt);
    return true;
  }

  const requestContext = options.createContext({
    config: options.config,
    principal: authResult.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  const method = String(req.method || 'GET').toUpperCase();
  const permission = options.authorize(
    requestContext,
    method === 'GET' ? options.PERMISSIONS.coreSupplierRead : options.PERMISSIONS.coreSupplierWrite,
  );
  if (!permission.ok) {
    sendError(res, createError('FORBIDDEN', 'Permission denied', {}, false, 403), options.requestId, options.receivedAt);
    return true;
  }

  const context = { ...options, requestContext };

  if (pathname === '/api/suppliers' && method === 'GET') {
    await handleListSuppliers(req, res, context);
    return true;
  }
  if (pathname === '/api/suppliers' && method === 'POST') {
    await handleCreateSupplier(req, res, context);
    return true;
  }

  const childCollectionMatch = pathname.match(/^\/api\/suppliers\/([^/]+)\/(contacts|addresses|payment-terms)$/);
  if (childCollectionMatch && method === 'GET') {
    await handleListChild(res, context, childCollectionMatch[1], childCollectionMatch[2]);
    return true;
  }
  if (childCollectionMatch && method === 'POST') {
    await handleCreateChild(req, res, context, childCollectionMatch[1], childCollectionMatch[2]);
    return true;
  }

  const childMatch = pathname.match(/^\/api\/suppliers\/([^/]+)\/(contacts|addresses|payment-terms)\/([^/]+)$/);
  if (childMatch && method === 'PATCH') {
    await handlePatchChild(req, res, context, childMatch[1], childMatch[3], childMatch[2]);
    return true;
  }

  const supplierMatch = pathname.match(/^\/api\/suppliers\/([^/]+)$/);
  if (supplierMatch && method === 'GET') {
    await handleGetSupplier(res, context, supplierMatch[1]);
    return true;
  }
  if (supplierMatch && method === 'PATCH') {
    await handlePatchSupplier(req, res, context, supplierMatch[1]);
    return true;
  }

  sendError(res, createError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), options.requestId, options.receivedAt);
  return true;
}
