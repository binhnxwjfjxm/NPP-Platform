import { createSuccessEnvelope } from '@npp/contracts';
import { sendJson, sendSuccess, sendError } from '../http-utils.js';
import { readJsonBody, normalizeIdempotencyKey } from '../idempotency.js';
import { buildAuditRecord, insertAuditRecord, withAuditOutboxTransaction } from '../audit-outbox.js';
import * as service from '../services/pricing.js';

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}
function statusFor(result) {
  if (['NOT_FOUND', 'CHANNEL_NOT_FOUND', 'CUSTOMER_GROUP_NOT_FOUND', 'CUSTOMER_NOT_FOUND', 'PRICE_LIST_NOT_FOUND', 'VARIANT_NOT_FOUND'].includes(result.code)) return 404;
  if (['CONFLICT', 'DUPLICATE_CODE', 'DUPLICATE_SOURCE_KEY', 'CHANNEL_IN_USE', 'CHANNEL_INACTIVE',
    'CUSTOMER_GROUP_INACTIVE', 'CUSTOMER_INACTIVE', 'CUSTOMER_GROUP_MISMATCH', 'VARIANT_NOT_PRICEABLE',
    'VARIANT_UNIT_MISSING', 'BASE_PRICE_NOT_FOUND', 'IMPORT_CONFLICT', 'IMPORT_IDENTITY_CONFLICT',
    'DUPLICATE_IMPORT_SOURCE_KEY'].includes(result.code)) return 409;
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
async function idempotentMutation(req, res, context, { route, body, mutate, resourceType, entityKey, action = 'create', metadata = () => ({}) }) {
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
        const tx = await withAuditOutboxTransaction({
          adapter: context.getPool(),
          mutate: async (client) => {
            const result = await mutate(client);
            if (!result.ok) return { failed: result, skipAudit: true };
            const entity = result[entityKey];
            await insertAuditRecord(client, buildAuditRecord({
              requestContext: context.requestContext,
              action,
              resourceType,
              resourceId: entity?.id ?? context.requestId,
              afterData: entity,
              metadata: metadata(entity, result),
            }));
            return { entity };
          },
        });
        if (tx.failed) {
          return {
            statusCode: statusFor(tx.failed), contentType: 'application/json', requestId: context.requestId,
            body: { error: { code: tx.failed.code, message: tx.failed.message, retryable: Boolean(tx.failed.retryable), details: {} }, requestId: context.requestId, receivedAt: context.receivedAt },
          };
        }
        return { statusCode: 201, contentType: 'application/json', requestId: context.requestId, body: createSuccessEnvelope(tx.entity, context.requestId, context.receivedAt) };
      },
    });
    res.setHeader('Cache-Control', 'no-store');
    sendJson(res, execution.response.statusCode, execution.response.body, execution.response.requestId ?? context.requestId, execution.response.contentType);
  } catch {
    sendError(res, apiError('PRICING_STORAGE_UNAVAILABLE', 'Pricing data is temporarily unavailable', {}, true, 503), context.requestId, context.receivedAt);
  }
}
async function patchMutation(res, context, { mutate, resourceType, entityKey, metadata = () => ({}) }) {
  try {
    const tx = await withAuditOutboxTransaction({
      adapter: context.getPool(),
      mutate: async (client) => {
        const result = await mutate(client);
        if (!result.ok) return { failed: result, skipAudit: true };
        const entity = result[entityKey];
        await insertAuditRecord(client, buildAuditRecord({
          requestContext: context.requestContext,
          action: result.action ?? 'update',
          resourceType,
          resourceId: entity.id,
          beforeData: result.beforeData ?? null,
          afterData: entity,
          metadata: metadata(entity, result),
        }));
        return { entity };
      },
    });
    if (tx.failed) return sendServiceError(res, tx.failed, context);
    sendSuccess(res, tx.entity, context.requestId, context.receivedAt);
  } catch {
    sendError(res, apiError('PRICING_STORAGE_UNAVAILABLE', 'Pricing data is temporarily unavailable', {}, true, 503), context.requestId, context.receivedAt);
  }
}
async function listQuery(res, context, execute, key) {
  try {
    const result = await execute();
    if (!result.ok) return sendServiceError(res, result, context);
    sendSuccess(res, result[key], context.requestId, context.receivedAt);
  } catch {
    sendError(res, apiError('PRICING_STORAGE_UNAVAILABLE', 'Pricing data is temporarily unavailable', {}, true, 503), context.requestId, context.receivedAt);
  }
}

async function handleChannels(req, res, context, pathname, method) {
  if (pathname === '/api/sales-channels' && method === 'GET') {
    const url = new URL(`http://localhost${req.url}`);
    try {
      await listQuery(res, context, () => service.listSalesChannels(context.getPool(), {
        installationId: context.requestContext.installationId,
        search: url.searchParams.get('search'), active: parseBoolean(url.searchParams.get('active')),
        limit: parseInteger(url.searchParams.get('limit'), 200, 1000), offset: parseInteger(url.searchParams.get('offset'), 0, 10000),
      }), 'channels');
    } catch (error) {
      sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), context.requestId, context.receivedAt);
    }
    return true;
  }
  if (pathname === '/api/sales-channels' && method === 'POST') {
    const body = await readPayload(req, res, context); if (body === null) return true;
    await idempotentMutation(req, res, context, {
      route: pathname, body,
      mutate: (client) => service.createSalesChannel(client, { installationId: context.requestContext.installationId, payload: body, createdBy: context.requestContext.actorId }),
      resourceType: 'sales_channel', entityKey: 'channel', metadata: (entity) => ({ code: entity.code }),
    });
    return true;
  }
  const match = pathname.match(/^\/api\/sales-channels\/([^/]+)$/);
  if (match && method === 'GET') {
    await listQuery(res, context, () => service.getSalesChannel(context.getPool(), { installationId: context.requestContext.installationId, id: match[1] }), 'channel');
    return true;
  }
  if (match && method === 'PATCH') {
    const body = await readPayload(req, res, context); if (body === null) return true;
    await patchMutation(res, context, {
      mutate: (client) => service.updateSalesChannel(client, { installationId: context.requestContext.installationId, id: match[1], payload: body, updatedBy: context.requestContext.actorId }),
      resourceType: 'sales_channel', entityKey: 'channel', metadata: (entity) => ({ code: entity.code }),
    });
    return true;
  }
  return false;
}

async function handlePriceLists(req, res, context, pathname, method) {
  if (pathname === '/api/price-lists' && method === 'GET') {
    const url = new URL(`http://localhost${req.url}`);
    try {
      await listQuery(res, context, () => service.listPriceLists(context.getPool(), {
        installationId: context.requestContext.installationId,
        search: url.searchParams.get('search'), active: parseBoolean(url.searchParams.get('active')),
        listType: url.searchParams.get('listType'), currencyCode: url.searchParams.get('currencyCode'),
        limit: parseInteger(url.searchParams.get('limit'), 300, 1000), offset: parseInteger(url.searchParams.get('offset'), 0, 10000),
      }), 'priceLists');
    } catch (error) {
      sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), context.requestId, context.receivedAt);
    }
    return true;
  }
  if (pathname === '/api/price-lists' && method === 'POST') {
    const body = await readPayload(req, res, context); if (body === null) return true;
    await idempotentMutation(req, res, context, {
      route: pathname, body,
      mutate: (client) => service.createPriceList(client, { installationId: context.requestContext.installationId, payload: body, createdBy: context.requestContext.actorId }),
      resourceType: 'price_list', entityKey: 'priceList', metadata: (entity) => ({ code: entity.code, listType: entity.list_type }),
    });
    return true;
  }
  const detail = pathname.match(/^\/api\/price-lists\/([^/]+)$/);
  if (detail && method === 'GET') {
    await listQuery(res, context, () => service.getPriceList(context.getPool(), { installationId: context.requestContext.installationId, id: detail[1] }), 'priceList');
    return true;
  }
  if (detail && method === 'PATCH') {
    const body = await readPayload(req, res, context); if (body === null) return true;
    await patchMutation(res, context, {
      mutate: (client) => service.updatePriceList(client, { installationId: context.requestContext.installationId, id: detail[1], payload: body, updatedBy: context.requestContext.actorId }),
      resourceType: 'price_list', entityKey: 'priceList', metadata: (entity) => ({ code: entity.code, listType: entity.list_type }),
    });
    return true;
  }
  const items = pathname.match(/^\/api\/price-lists\/([^/]+)\/items$/);
  if (items && method === 'GET') {
    const url = new URL(`http://localhost${req.url}`);
    try {
      await listQuery(res, context, () => service.listPriceListItems(context.getPool(), {
        installationId: context.requestContext.installationId, priceListId: items[1],
        variantId: url.searchParams.get('variantId'), active: parseBoolean(url.searchParams.get('active')),
        limit: parseInteger(url.searchParams.get('limit'), 500, 2000), offset: parseInteger(url.searchParams.get('offset'), 0, 10000),
      }), 'items');
    } catch (error) {
      sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), context.requestId, context.receivedAt);
    }
    return true;
  }
  if (items && method === 'POST') {
    const body = await readPayload(req, res, context); if (body === null) return true;
    await idempotentMutation(req, res, context, {
      route: pathname, body,
      mutate: (client) => service.createPriceListItem(client, { installationId: context.requestContext.installationId, priceListId: items[1], payload: body, createdBy: context.requestContext.actorId }),
      resourceType: 'price_list_item', entityKey: 'item', metadata: (entity) => ({ priceListId: entity.price_list_id, sku: entity.sku }),
    });
    return true;
  }
  const itemDetail = pathname.match(/^\/api\/price-lists\/([^/]+)\/items\/([^/]+)$/);
  if (itemDetail && method === 'PATCH') {
    const body = await readPayload(req, res, context); if (body === null) return true;
    await patchMutation(res, context, {
      mutate: (client) => service.updatePriceListItem(client, { installationId: context.requestContext.installationId, priceListId: itemDetail[1], itemId: itemDetail[2], payload: body, updatedBy: context.requestContext.actorId }),
      resourceType: 'price_list_item', entityKey: 'item', metadata: (entity) => ({ priceListId: entity.price_list_id, sku: entity.sku }),
    });
    return true;
  }
  return false;
}

async function handleResolution(req, res, context, pathname, method) {
  if (pathname !== '/api/pricing/resolve' || method !== 'POST') return false;
  const body = await readPayload(req, res, context); if (body === null) return true;
  const manualSupplied = body?.manualUnitPriceMinor !== undefined
    && body?.manualUnitPriceMinor !== null
    && body?.manualUnitPriceMinor !== '';
  if (manualSupplied) {
    const overridePermission = context.authorize(
      context.requestContext,
      context.PERMISSIONS.coreSalesOrderPriceOverride,
    );
    if (!overridePermission.ok) {
      sendError(
        res,
        apiError('PRICE_OVERRIDE_FORBIDDEN', 'Price override permission is required', {}, false, 403),
        context.requestId,
        context.receivedAt,
      );
      return true;
    }
  }
  try {
    const result = await service.resolvePrice(context.getPool(), { installationId: context.requestContext.installationId, payload: body });
    if (!result.ok) return sendServiceError(res, result, context), true;
    sendSuccess(res, result.resolution, context.requestId, context.receivedAt);
  } catch {
    sendError(res, apiError('PRICING_STORAGE_UNAVAILABLE', 'Pricing data is temporarily unavailable', {}, true, 503), context.requestId, context.receivedAt);
  }
  return true;
}

async function handleImport(req, res, context, pathname, method) {
  if (pathname !== '/api/pricing/import' || method !== 'POST') return false;
  const body = await readPayload(req, res, context); if (body === null) return true;
  await idempotentMutation(req, res, context, {
    route: pathname, body,
    mutate: (client) => service.importPricing(client, { installationId: context.requestContext.installationId, payload: body, createdBy: context.requestContext.actorId }),
    resourceType: 'pricing_import', entityKey: 'import', action: 'import', metadata: (entity) => entity,
  });
  return true;
}

export async function handlePricingRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  const isRoute = pathname === '/api/sales-channels' || pathname.startsWith('/api/sales-channels/')
    || pathname === '/api/price-lists' || pathname.startsWith('/api/price-lists/')
    || pathname === '/api/pricing/resolve' || pathname === '/api/pricing/import';
  if (!isRoute) return false;
  const auth = options.authenticate(req, options.config);
  if (!auth.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, apiError('UNAUTHORIZED', 'Authorization required', {}, false, 401), options.requestId, options.receivedAt);
    return true;
  }
  const requestContext = options.createContext({ config: options.config, principal: auth.principal, requestId: options.requestId, receivedAt: options.receivedAt });
  const method = String(req.method || 'GET').toUpperCase();
  const readOperation = method === 'GET' || pathname === '/api/pricing/resolve';
  const permission = options.authorize(requestContext, readOperation ? options.PERMISSIONS.corePriceRead : options.PERMISSIONS.corePriceWrite);
  if (!permission.ok) {
    sendError(res, apiError('FORBIDDEN', 'Permission denied', {}, false, 403), options.requestId, options.receivedAt);
    return true;
  }
  const context = { ...options, requestContext };
  if (await handleChannels(req, res, context, pathname, method)) return true;
  if (await handlePriceLists(req, res, context, pathname, method)) return true;
  if (await handleResolution(req, res, context, pathname, method)) return true;
  if (await handleImport(req, res, context, pathname, method)) return true;
  sendError(res, apiError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), options.requestId, options.receivedAt);
  return true;
}
