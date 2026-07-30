import { createSuccessEnvelope } from '@npp/contracts';
import { sendJson, sendSuccess, sendError } from '../http-utils.js';
import { readJsonBody, normalizeIdempotencyKey } from '../idempotency.js';
import { buildAuditRecord, insertAuditRecord, withAuditOutboxTransaction } from '../audit-outbox.js';
import * as productService from '../services/product.js';

const RESOURCES = Object.freeze({
  category: Object.freeze({
    collection: '/api/product-categories',
    permissionPrefix: 'product',
    resourceType: 'product_category',
    entityKey: 'category',
    listKey: 'categories',
    list: productService.listProductCategories,
    get: productService.getProductCategory,
    create: productService.createProductCategory,
    update: productService.updateProductCategory,
  }),
  brand: Object.freeze({
    collection: '/api/product-brands',
    permissionPrefix: 'product',
    resourceType: 'product_brand',
    entityKey: 'brand',
    listKey: 'brands',
    list: productService.listProductBrands,
    get: productService.getProductBrand,
    create: productService.createProductBrand,
    update: productService.updateProductBrand,
  }),
});

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(result) {
  if (['NOT_FOUND', 'CATEGORY_NOT_FOUND', 'BRAND_NOT_FOUND', 'PRODUCT_NOT_FOUND', 'VARIANT_NOT_FOUND', 'PARENT_CATEGORY_NOT_FOUND'].includes(result.code)) return 404;
  if (['DUPLICATE_CODE', 'DUPLICATE_SKU', 'CONFLICT', 'ACTIVE_DEPENDENTS', 'STALE_VERSION', 'DOMAIN_CONFLICT', 'CATEGORY_INACTIVE', 'BRAND_INACTIVE', 'PARENT_CATEGORY_INACTIVE', 'PRODUCT_INACTIVE', 'INVALID_ORDERABLE_STATUS', 'VARIANT_PRODUCT_MISMATCH', 'CONFLICTING_PRODUCT_ID', 'CONFLICTING_VARIANT_ID', 'IMPORT_VARIANT_SNAPSHOT_INCOMPLETE'].includes(result.code)) return 409;
  return 400;
}

function sendServiceError(res, result, context) {
  sendError(res, apiError(result.code, result.message, result.details ?? {}, Boolean(result.retryable), statusFor(result)), context.requestId, context.receivedAt);
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

async function payload(req, res, context) {
  try {
    return await readJsonBody(req);
  } catch (error) {
    sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), context.requestId, context.receivedAt);
    return null;
  }
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
  metadata,
  responseStatus = 201,
}) {
  const key = requireIdempotency(req);
  if (!key.ok) {
    sendError(res, apiError(key.code, key.message, {}, false, 400), context.requestId, context.receivedAt);
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
        const result = await withAuditOutboxTransaction({
          adapter: context.getPool(),
          mutate: async (client) => {
            const serviceResult = await mutate(client);
            if (!serviceResult.ok) return { failed: serviceResult };
            const entity = entityKey === 'import'
              ? { imported: serviceResult.imported, created: serviceResult.created, updated: serviceResult.updated }
              : serviceResult[entityKey];
            await insertAuditRecord(client, buildAuditRecord({
              requestContext: context.requestContext,
              action,
              resourceType,
              resourceId: entityKey === 'import' ? context.requestId : entity.id,
              afterData: entity,
              metadata: metadata(entity, serviceResult),
            }));
            return { entity };
          },
        });

        if (result.failed) {
          const failed = result.failed;
          return {
            statusCode: statusFor(failed),
            contentType: 'application/json',
            requestId: context.requestId,
            body: { error: { code: failed.code, message: failed.message, retryable: Boolean(failed.retryable), details: failed.details ?? {} }, requestId: context.requestId, receivedAt: context.receivedAt },
          };
        }
        return {
          statusCode: responseStatus,
          contentType: 'application/json',
          requestId: context.requestId,
          body: createSuccessEnvelope(result.entity, context.requestId, context.receivedAt),
        };
      },
    });
    res.setHeader('Cache-Control', 'no-store');
    sendJson(res, execution.response.statusCode, execution.response.body, execution.response.requestId ?? context.requestId, execution.response.contentType);
  } catch {
    sendError(res, apiError('PRODUCT_STORAGE_UNAVAILABLE', 'Product data is temporarily unavailable', {}, true, 503), context.requestId, context.receivedAt);
  }
}

async function patchMutation(res, context, { mutate, resourceType, entityKey, metadata }) {
  try {
    const result = await withAuditOutboxTransaction({
      adapter: context.getPool(),
      mutate: async (client) => {
        const serviceResult = await mutate(client);
        if (!serviceResult.ok) return { failed: serviceResult };
        const entity = serviceResult[entityKey];
        if (serviceResult.changed === false) return { entity };
        await insertAuditRecord(client, buildAuditRecord({
          requestContext: context.requestContext,
          action: serviceResult.action ?? 'update',
          resourceType,
          resourceId: entity.id,
          beforeData: serviceResult.beforeData ?? null,
          afterData: entity,
          metadata: metadata(entity),
        }));
        return { entity };
      },
    });
    if (result.failed) return sendServiceError(res, result.failed, context);
    sendSuccess(res, result.entity, context.requestId, context.receivedAt);
  } catch {
    sendError(res, apiError('PRODUCT_STORAGE_UNAVAILABLE', 'Product data is temporarily unavailable', {}, true, 503), context.requestId, context.receivedAt);
  }
}

function listQuery(req, includeProductFilters = false) {
  const url = new URL(`http://localhost${req.url}`);
  const common = {
    search: url.searchParams.get('search'),
    active: parseBoolean(url.searchParams.get('active')),
    limit: parseInteger(url.searchParams.get('limit'), 100, 1000),
    offset: parseInteger(url.searchParams.get('offset'), 0, 10000),
  };
  if (!includeProductFilters) return common;
  return {
    ...common,
    catalogVisible: parseBoolean(url.searchParams.get('catalogVisible')),
    orderable: parseBoolean(url.searchParams.get('orderable')),
    categoryId: url.searchParams.get('categoryId'),
    brandId: url.searchParams.get('brandId'),
  };
}

async function handleMasterResource(req, res, context, descriptor, id) {
  const method = String(req.method || 'GET').toUpperCase();
  if (!id && method === 'GET') {
    let query;
    try { query = listQuery(req); } catch (error) {
      sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), context.requestId, context.receivedAt);
      return true;
    }
    try {
      const result = await descriptor.list(context.getPool(), { installationId: context.requestContext.installationId, ...query });
      if (!result.ok) return sendServiceError(res, result, context), true;
      sendSuccess(res, result[descriptor.listKey], context.requestId, context.receivedAt);
    } catch {
      sendError(res, apiError('PRODUCT_STORAGE_UNAVAILABLE', 'Product data is temporarily unavailable', {}, true, 503), context.requestId, context.receivedAt);
    }
    return true;
  }
  if (!id && method === 'POST') {
    const body = await payload(req, res, context);
    if (body === null) return true;
    await idempotentMutation(req, res, context, {
      route: descriptor.collection,
      body,
      mutate: (client) => descriptor.create(client, { installationId: context.requestContext.installationId, payload: body, createdBy: context.requestContext.actorId }),
      resourceType: descriptor.resourceType,
      entityKey: descriptor.entityKey,
      metadata: (entity) => ({ code: entity.code }),
    });
    return true;
  }
  if (id && method === 'GET') {
    try {
      const result = await descriptor.get(context.getPool(), { installationId: context.requestContext.installationId, id });
      if (!result.ok) return sendServiceError(res, result, context), true;
      sendSuccess(res, result[descriptor.entityKey], context.requestId, context.receivedAt);
    } catch {
      sendError(res, apiError('PRODUCT_STORAGE_UNAVAILABLE', 'Product data is temporarily unavailable', {}, true, 503), context.requestId, context.receivedAt);
    }
    return true;
  }
  if (id && method === 'PATCH') {
    const body = await payload(req, res, context);
    if (body === null) return true;
    await patchMutation(res, context, {
      mutate: (client) => descriptor.update(client, { id, installationId: context.requestContext.installationId, payload: body, updatedBy: context.requestContext.actorId }),
      resourceType: descriptor.resourceType,
      entityKey: descriptor.entityKey,
      metadata: (entity) => ({ code: entity.code }),
    });
    return true;
  }
  return false;
}

async function handleProducts(req, res, context, pathname) {
  const method = String(req.method || 'GET').toUpperCase();
  if (pathname === '/api/products/import' && method === 'POST') {
    const body = await payload(req, res, context);
    if (body === null) return true;
    await idempotentMutation(req, res, context, {
      route: pathname,
      body,
      mutate: (client) => productService.importProducts(client, { installationId: context.requestContext.installationId, payload: body, createdBy: context.requestContext.actorId }),
      resourceType: 'product_import',
      entityKey: 'import',
      action: 'import',
      metadata: (entity) => entity,
    });
    return true;
  }
  if (pathname === '/api/products' && method === 'GET') {
    let query;
    try { query = listQuery(req, true); } catch (error) {
      sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), context.requestId, context.receivedAt);
      return true;
    }
    try {
      const result = await productService.listProducts(context.getPool(), { installationId: context.requestContext.installationId, ...query });
      if (!result.ok) return sendServiceError(res, result, context), true;
      sendSuccess(res, result.products, context.requestId, context.receivedAt);
    } catch {
      sendError(res, apiError('PRODUCT_STORAGE_UNAVAILABLE', 'Product data is temporarily unavailable', {}, true, 503), context.requestId, context.receivedAt);
    }
    return true;
  }
  if (pathname === '/api/products' && method === 'POST') {
    const body = await payload(req, res, context);
    if (body === null) return true;
    await idempotentMutation(req, res, context, {
      route: pathname,
      body,
      mutate: (client) => productService.createProduct(client, { installationId: context.requestContext.installationId, payload: body, createdBy: context.requestContext.actorId }),
      resourceType: 'product',
      entityKey: 'product',
      metadata: (entity) => ({ code: entity.code }),
    });
    return true;
  }

  const variantDetail = pathname.match(/^\/api\/products\/([^/]+)\/variants\/([^/]+)$/);
  if (variantDetail && method === 'PATCH') {
    const body = await payload(req, res, context);
    if (body === null) return true;
    await patchMutation(res, context, {
      mutate: (client) => productService.updateProductVariant(client, { productId: variantDetail[1], variantId: variantDetail[2], installationId: context.requestContext.installationId, payload: body, updatedBy: context.requestContext.actorId }),
      resourceType: 'product_variant',
      entityKey: 'variant',
      metadata: (entity) => ({ sku: entity.sku, productId: entity.product_id }),
    });
    return true;
  }

  const variants = pathname.match(/^\/api\/products\/([^/]+)\/variants$/);
  if (variants && method === 'GET') {
    try {
      const result = await productService.listProductVariants(context.getPool(), { installationId: context.requestContext.installationId, productId: variants[1] });
      if (!result.ok) return sendServiceError(res, result, context), true;
      sendSuccess(res, result.variants, context.requestId, context.receivedAt);
    } catch {
      sendError(res, apiError('PRODUCT_STORAGE_UNAVAILABLE', 'Product data is temporarily unavailable', {}, true, 503), context.requestId, context.receivedAt);
    }
    return true;
  }
  if (variants && method === 'POST') {
    const body = await payload(req, res, context);
    if (body === null) return true;
    await idempotentMutation(req, res, context, {
      route: `/api/products/${variants[1]}/variants`,
      body,
      mutate: (client) => productService.createProductVariant(client, { installationId: context.requestContext.installationId, productId: variants[1], payload: body, createdBy: context.requestContext.actorId }),
      resourceType: 'product_variant',
      entityKey: 'variant',
      metadata: (entity) => ({ sku: entity.sku, productId: entity.product_id }),
    });
    return true;
  }

  const detail = pathname.match(/^\/api\/products\/([^/]+)$/);
  if (detail && method === 'GET') {
    try {
      const result = await productService.getProduct(context.getPool(), { installationId: context.requestContext.installationId, id: detail[1] });
      if (!result.ok) return sendServiceError(res, result, context), true;
      sendSuccess(res, result.product, context.requestId, context.receivedAt);
    } catch {
      sendError(res, apiError('PRODUCT_STORAGE_UNAVAILABLE', 'Product data is temporarily unavailable', {}, true, 503), context.requestId, context.receivedAt);
    }
    return true;
  }
  if (detail && method === 'PATCH') {
    const body = await payload(req, res, context);
    if (body === null) return true;
    await patchMutation(res, context, {
      mutate: (client) => productService.updateProduct(client, { id: detail[1], installationId: context.requestContext.installationId, payload: body, updatedBy: context.requestContext.actorId }),
      resourceType: 'product',
      entityKey: 'product',
      metadata: (entity) => ({ code: entity.code }),
    });
    return true;
  }
  return false;
}

export async function handleProductRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  const productPath = pathname === '/api/product-categories'
    || pathname.startsWith('/api/product-categories/')
    || pathname === '/api/product-brands'
    || pathname.startsWith('/api/product-brands/')
    || pathname === '/api/products'
    || pathname.startsWith('/api/products/');
  if (!productPath) return false;

  const auth = options.authenticate(req, options.config);
  if (!auth.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, apiError('UNAUTHORIZED', 'Authorization required', {}, false, 401), options.requestId, options.receivedAt);
    return true;
  }
  const requestContext = options.createContext({ config: options.config, principal: auth.principal, requestId: options.requestId, receivedAt: options.receivedAt });
  const method = String(req.method || 'GET').toUpperCase();
  const permission = options.authorize(requestContext, method === 'GET' ? options.PERMISSIONS.coreProductRead : options.PERMISSIONS.coreProductWrite);
  if (!permission.ok) {
    sendError(res, apiError('FORBIDDEN', 'Permission denied', {}, false, 403), options.requestId, options.receivedAt);
    return true;
  }
  const context = { ...options, requestContext };

  const categoryMatch = pathname.match(/^\/api\/product-categories(?:\/([^/]+))?$/);
  if (categoryMatch && await handleMasterResource(req, res, context, RESOURCES.category, categoryMatch[1])) return true;
  const brandMatch = pathname.match(/^\/api\/product-brands(?:\/([^/]+))?$/);
  if (brandMatch && await handleMasterResource(req, res, context, RESOURCES.brand, brandMatch[1])) return true;
  if (await handleProducts(req, res, context, pathname)) return true;

  sendError(res, apiError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), options.requestId, options.receivedAt);
  return true;
}
