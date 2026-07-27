import { createSuccessEnvelope } from '@npp/contracts';
import { sendJson, sendSuccess, sendError } from '../http-utils.js';
import { readJsonBody, normalizeIdempotencyKey } from '../idempotency.js';
import { buildAuditRecord, insertAuditRecord, withAuditOutboxTransaction } from '../audit-outbox.js';
import * as service from '../services/product-unit.js';
import { handlePricingRoutes } from './pricing.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(result) {
  if (['NOT_FOUND', 'PRODUCT_NOT_FOUND', 'VARIANT_NOT_FOUND', 'UNIT_NOT_FOUND'].includes(result.code)) return 404;
  if (['DUPLICATE_CODE', 'DUPLICATE_BARCODE', 'CONFLICT', 'UNIT_INACTIVE', 'UNIT_DEFINITION_CONFLICT',
    'UNIT_CONVERSION_MISSING', 'VARIANT_INACTIVE', 'VARIANT_PRODUCT_MISMATCH', 'BASE_VARIANT_MISMATCH',
    'IMPORT_REVIEW_REQUIRED', 'DUPLICATE_IMPORT_PRODUCT', 'DUPLICATE_IMPORT_SKU', 'DUPLICATE_IMPORT_BARCODE'].includes(result.code)) return 409;
  return 400;
}

function sendServiceError(res, result, context) {
  sendError(res, apiError(result.code, result.message, {}, Boolean(result.retryable), statusFor(result)), context.requestId, context.receivedAt);
}

async function readPayload(req, res, context) {
  try {
    return await readJsonBody(req);
  } catch (error) {
    sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), context.requestId, context.receivedAt);
    return null;
  }
}

function parseBoolean(value) {
  if (value === null) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw Object.assign(new Error('INVALID_QUERY_PARAMETER'), { code: 'INVALID_QUERY_PARAMETER', publicMessage: 'Query parameter must be true or false', statusCode: 400 });
}

function parseInteger(value, fallback, max) {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
    throw Object.assign(new Error('INVALID_QUERY_PARAMETER'), { code: 'INVALID_QUERY_PARAMETER', publicMessage: `Query parameter must be an integer between 0 and ${max}`, statusCode: 400 });
  }
  return parsed;
}

function requireIdempotency(req) {
  const raw = req.headers['idempotency-key'];
  if (raw === undefined || raw === null) return { ok: false, code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key header is required' };
  try {
    normalizeIdempotencyKey(raw);
    return { ok: true };
  } catch (error) {
    return { ok: false, code: error.code ?? 'INVALID_IDEMPOTENCY_KEY', message: 'Idempotency-Key must use 1-128 safe characters' };
  }
}

async function idempotentMutation(req, res, context, {
  route,
  body,
  mutate,
  resourceType,
  entityKey,
  action = 'create',
  metadata = () => ({}),
}) {
  const idempotency = requireIdempotency(req);
  if (!idempotency.ok) {
    sendError(res, apiError(idempotency.code, idempotency.message, {}, false, 400), context.requestId, context.receivedAt);
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
      payload: body,
      onProcess: async () => {
        const transactionResult = await withAuditOutboxTransaction({
          adapter: context.getPool(),
          mutate: async (client) => {
            const serviceResult = await mutate(client);
            if (!serviceResult.ok) return { failed: serviceResult, skipAudit: true };
            const entity = serviceResult[entityKey];
            await insertAuditRecord(client, buildAuditRecord({
              requestContext: context.requestContext,
              action,
              resourceType,
              resourceId: entity?.id ?? context.requestId,
              afterData: entity,
              metadata: metadata(entity, serviceResult),
            }));
            return { entity };
          },
        });
        if (transactionResult.failed) {
          const failed = transactionResult.failed;
          return {
            statusCode: statusFor(failed),
            contentType: 'application/json',
            requestId: context.requestId,
            body: { error: { code: failed.code, message: failed.message, retryable: Boolean(failed.retryable), details: {} }, requestId: context.requestId, receivedAt: context.receivedAt },
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
    sendJson(res, execution.response.statusCode, execution.response.body, execution.response.requestId ?? context.requestId, execution.response.contentType);
  } catch {
    sendError(res, apiError('PRODUCT_UNIT_STORAGE_UNAVAILABLE', 'Product unit data is temporarily unavailable', {}, true, 503), context.requestId, context.receivedAt);
  }
}

async function patchMutation(res, context, { mutate, resourceType, entityKey, metadata = () => ({}) }) {
  try {
    const transactionResult = await withAuditOutboxTransaction({
      adapter: context.getPool(),
      mutate: async (client) => {
        const serviceResult = await mutate(client);
        if (!serviceResult.ok) return { failed: serviceResult, skipAudit: true };
        const entity = serviceResult[entityKey];
        await insertAuditRecord(client, buildAuditRecord({
          requestContext: context.requestContext,
          action: serviceResult.action ?? 'update',
          resourceType,
          resourceId: entity.id,
          beforeData: serviceResult.beforeData ?? null,
          afterData: entity,
          metadata: metadata(entity, serviceResult),
        }));
        return { entity };
      },
    });
    if (transactionResult.failed) return sendServiceError(res, transactionResult.failed, context);
    sendSuccess(res, transactionResult.entity, context.requestId, context.receivedAt);
  } catch {
    sendError(res, apiError('PRODUCT_UNIT_STORAGE_UNAVAILABLE', 'Product unit data is temporarily unavailable', {}, true, 503), context.requestId, context.receivedAt);
  }
}

async function handleUnits(req, res, context, pathname, method) {
  if (pathname === '/api/units' && method === 'GET') {
    const url = new URL(`http://localhost${req.url}`);
    let active, limit, offset;
    try {
      active = parseBoolean(url.searchParams.get('active'));
      limit = parseInteger(url.searchParams.get('limit'), 200, 1000);
      offset = parseInteger(url.searchParams.get('offset'), 0, 10000);
    } catch (error) {
      sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), context.requestId, context.receivedAt);
      return true;
    }
    try {
      const result = await service.listUnits(context.getPool(), { installationId: context.requestContext.installationId, search: url.searchParams.get('search'), active, limit, offset });
      if (!result.ok) return sendServiceError(res, result, context), true;
      sendSuccess(res, result.units, context.requestId, context.receivedAt);
    } catch {
      sendError(res, apiError('PRODUCT_UNIT_STORAGE_UNAVAILABLE', 'Product unit data is temporarily unavailable', {}, true, 503), context.requestId, context.receivedAt);
    }
    return true;
  }
  if (pathname === '/api/units' && method === 'POST') {
    const body = await readPayload(req, res, context);
    if (body === null) return true;
    await idempotentMutation(req, res, context, {
      route: pathname,
      body,
      mutate: (client) => service.createUnit(client, { installationId: context.requestContext.installationId, payload: body, createdBy: context.requestContext.actorId }),
      resourceType: 'unit_of_measure',
      entityKey: 'unit',
      metadata: (unit) => ({ code: unit.code }),
    });
    return true;
  }
  const detail = pathname.match(/^\/api\/units\/([^/]+)$/);
  if (detail && method === 'GET') {
    try {
      const result = await service.getUnit(context.getPool(), { installationId: context.requestContext.installationId, id: detail[1] });
      if (!result.ok) return sendServiceError(res, result, context), true;
      sendSuccess(res, result.unit, context.requestId, context.receivedAt);
    } catch {
      sendError(res, apiError('PRODUCT_UNIT_STORAGE_UNAVAILABLE', 'Product unit data is temporarily unavailable', {}, true, 503), context.requestId, context.receivedAt);
    }
    return true;
  }
  if (detail && method === 'PATCH') {
    const body = await readPayload(req, res, context);
    if (body === null) return true;
    await patchMutation(res, context, {
      mutate: (client) => service.updateUnit(client, { installationId: context.requestContext.installationId, id: detail[1], payload: body, updatedBy: context.requestContext.actorId }),
      resourceType: 'unit_of_measure',
      entityKey: 'unit',
      metadata: (unit) => ({ code: unit.code }),
    });
    return true;
  }
  return false;
}

async function handleVariantUnit(req, res, context, pathname, method) {
  const match = pathname.match(/^\/api\/products\/([^/]+)\/variants\/([^/]+)\/unit$/);
  if (!match) return false;
  const [, productId, variantId] = match;
  if (method === 'GET') {
    try {
      const result = await service.getVariantUnit(context.getPool(), { installationId: context.requestContext.installationId, productId, variantId });
      if (!result.ok) return sendServiceError(res, result, context), true;
      sendSuccess(res, result.variant, context.requestId, context.receivedAt);
    } catch {
      sendError(res, apiError('PRODUCT_UNIT_STORAGE_UNAVAILABLE', 'Product unit data is temporarily unavailable', {}, true, 503), context.requestId, context.receivedAt);
    }
    return true;
  }
  if (method === 'PATCH') {
    const body = await readPayload(req, res, context);
    if (body === null) return true;
    await patchMutation(res, context, {
      mutate: (client) => service.assignVariantUnit(client, { installationId: context.requestContext.installationId, productId, variantId, payload: body, updatedBy: context.requestContext.actorId }),
      resourceType: 'product_variant_unit',
      entityKey: 'variant',
      metadata: (variant) => ({ sku: variant.sku, unitCode: variant.unit_code, conversionToBase: variant.conversion_to_base }),
    });
    return true;
  }
  return false;
}

async function handleNormalization(req, res, context, pathname, method) {
  const match = pathname.match(/^\/api\/products\/([^/]+)\/variants\/([^/]+)\/normalize-quantity$/);
  if (!match || method !== 'POST') return false;
  const body = await readPayload(req, res, context);
  if (body === null) return true;
  try {
    const result = await service.normalizeQuantity(context.getPool(), { installationId: context.requestContext.installationId, productId: match[1], variantId: match[2], payload: body });
    if (!result.ok) return sendServiceError(res, result, context), true;
    sendSuccess(res, result.normalization, context.requestId, context.receivedAt);
  } catch {
    sendError(res, apiError('PRODUCT_UNIT_STORAGE_UNAVAILABLE', 'Product unit data is temporarily unavailable', {}, true, 503), context.requestId, context.receivedAt);
  }
  return true;
}

async function handleBarcodes(req, res, context, pathname, method) {
  const collection = pathname.match(/^\/api\/products\/([^/]+)\/variants\/([^/]+)\/barcodes$/);
  if (collection && method === 'GET') {
    try {
      const result = await service.listBarcodes(context.getPool(), { installationId: context.requestContext.installationId, productId: collection[1], variantId: collection[2] });
      if (!result.ok) return sendServiceError(res, result, context), true;
      sendSuccess(res, result.barcodes, context.requestId, context.receivedAt);
    } catch {
      sendError(res, apiError('PRODUCT_UNIT_STORAGE_UNAVAILABLE', 'Product unit data is temporarily unavailable', {}, true, 503), context.requestId, context.receivedAt);
    }
    return true;
  }
  if (collection && method === 'POST') {
    const body = await readPayload(req, res, context);
    if (body === null) return true;
    await idempotentMutation(req, res, context, {
      route: pathname,
      body,
      mutate: (client) => service.createBarcode(client, { installationId: context.requestContext.installationId, productId: collection[1], variantId: collection[2], payload: body, createdBy: context.requestContext.actorId }),
      resourceType: 'product_barcode',
      entityKey: 'barcode',
      metadata: (barcode) => ({ barcode: barcode.normalized_barcode, variantId: barcode.variant_id }),
    });
    return true;
  }
  const detail = pathname.match(/^\/api\/products\/([^/]+)\/variants\/([^/]+)\/barcodes\/([^/]+)$/);
  if (detail && method === 'PATCH') {
    const body = await readPayload(req, res, context);
    if (body === null) return true;
    await patchMutation(res, context, {
      mutate: (client) => service.updateBarcode(client, { installationId: context.requestContext.installationId, productId: detail[1], variantId: detail[2], barcodeId: detail[3], payload: body, updatedBy: context.requestContext.actorId }),
      resourceType: 'product_barcode',
      entityKey: 'barcode',
      metadata: (barcode) => ({ barcode: barcode.normalized_barcode, variantId: barcode.variant_id }),
    });
    return true;
  }
  return false;
}

async function handleImport(req, res, context, pathname, method) {
  if (pathname !== '/api/product-units/import' || method !== 'POST') return false;
  const body = await readPayload(req, res, context);
  if (body === null) return true;
  await idempotentMutation(req, res, context, {
    route: pathname,
    body,
    mutate: (client) => service.importProductUnits(client, { installationId: context.requestContext.installationId, payload: body, createdBy: context.requestContext.actorId }),
    resourceType: 'product_unit_import',
    entityKey: 'import',
    action: 'import',
    metadata: (summary) => summary,
  });
  return true;
}

export async function handleProductUnitRoutes(req, res, options) {
  if (await handlePricingRoutes(req, res, options)) return true;

  const pathname = new URL(`http://localhost${req.url}`).pathname;
  const isRoute = pathname === '/api/units'
    || pathname.startsWith('/api/units/')
    || pathname === '/api/product-units/import'
    || /^\/api\/products\/[^/]+\/variants\/[^/]+\/(?:unit|normalize-quantity|barcodes(?:\/[^/]+)?)$/.test(pathname);
  if (!isRoute) return false;

  const auth = options.authenticate(req, options.config);
  if (!auth.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, apiError('UNAUTHORIZED', 'Authorization required', {}, false, 401), options.requestId, options.receivedAt);
    return true;
  }
  const requestContext = options.createContext({ config: options.config, principal: auth.principal, requestId: options.requestId, receivedAt: options.receivedAt });
  const method = String(req.method || 'GET').toUpperCase();
  const readOperation = method === 'GET' || pathname.endsWith('/normalize-quantity');
  const permission = options.authorize(requestContext, readOperation ? options.PERMISSIONS.coreProductRead : options.PERMISSIONS.coreProductWrite);
  if (!permission.ok) {
    sendError(res, apiError('FORBIDDEN', 'Permission denied', {}, false, 403), options.requestId, options.receivedAt);
    return true;
  }
  const context = { ...options, requestContext };

  if (await handleUnits(req, res, context, pathname, method)) return true;
  if (await handleVariantUnit(req, res, context, pathname, method)) return true;
  if (await handleNormalization(req, res, context, pathname, method)) return true;
  if (await handleBarcodes(req, res, context, pathname, method)) return true;
  if (await handleImport(req, res, context, pathname, method)) return true;

  sendError(res, apiError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), options.requestId, options.receivedAt);
  return true;
}
