import { createSuccessEnvelope } from '@npp/contracts';
import { sendJson, sendSuccess, sendError } from '../http-utils.js';
import { readJsonBody, normalizeIdempotencyKey } from '../idempotency.js';
import { buildAuditRecord, insertAuditRecord, withAuditOutboxTransaction } from '../audit-outbox.js';
import * as productService from '../services/product.js';

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
  if (['NOT_FOUND', 'CATEGORY_NOT_FOUND', 'BRAND_NOT_FOUND', 'PRODUCT_NOT_FOUND', 'VARIANT_NOT_FOUND'].includes(result.code)) return 404;
  if (['DUPLICATE_CODE', 'DUPLICATE_SKU', 'CONFLICT', 'CATEGORY_INACTIVE', 'BRAND_INACTIVE', 'INVALID_ORDERABLE_STATUS', 'VARIANT_PRODUCT_MISMATCH', 'CONFLICTING_PRODUCT_ID', 'CONFLICTING_VARIANT_ID'].includes(result.code)) return 409;
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
    sendError(res, createError(error.code, error.publicMessage, {}, false, error.statusCode), context.requestId, context.receivedAt);
    return null;
  }
}

async function executeIdempotentCreate(req, res, context, {
  route,
  payload,
  create,
  resourceType,
  getResourceId,
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
            const entity = serviceResult[resourceType === 'product_import' ? 'imported' : resourceType] || serviceResult[resourceType];
            if (resourceType !== 'product_import') {
              await insertAuditRecord(client, buildAuditRecord({
                requestContext: context.requestContext,
                action: 'create',
                resourceType,
                resourceId: getResourceId(entity),
                afterData: entity,
                metadata: metadata(entity),
              }));
            } else {
              await insertAuditRecord(client, buildAuditRecord({
                requestContext: context.requestContext,
                action: 'import',
                resourceType: 'product_import',
                resourceId: context.requestId,
                afterData: { imported: serviceResult.imported },
                metadata: metadata(serviceResult),
              }));
            }
            return { entity: serviceResult.product || serviceResult.category || serviceResult.brand || serviceResult.variant || serviceResult };
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

async function executePatch(res, context, { update, resourceType, getEntity, getAction, metadata }) {
  try {
    const transactionResult = await withAuditOutboxTransaction({
      adapter: context.getPool(),
      mutate: async (client) => {
        const serviceResult = await update(client);
        if (!serviceResult.ok) {
          throw Object.assign(new Error('PRODUCT_MASTER_UPDATE_FAILED'), { serviceResult });
        }
        const entity = getEntity(serviceResult);
        await insertAuditRecord(client, buildAuditRecord({
          requestContext: context.requestContext,
          action: getAction(serviceResult),
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
    sendError(res, createError('INTERNAL_ERROR', 'Failed to update product master data', {}, true, 500), context.requestId, context.receivedAt);
  }
}

async function handleListCategories(req, res, context) {
  const url = new URL(`http://localhost${req.url}`);
  let active, limit, offset;
  try {
    active = parseBooleanParam(url.searchParams.get('active'));
    limit = parsePositiveIntParam(url.searchParams.get('limit'), 100, 1000);
    offset = parsePositiveIntParam(url.searchParams.get('offset'), 0, 10000);
  } catch (error) {
    sendError(res, createError(error.code, error.publicMessage, {}, false, error.statusCode), context.requestId, context.receivedAt);
    return;
  }

  const result = await productService.listProductCategories(context.getPool(), {
    installationId: context.requestContext.installationId,
    search: url.searchParams.get('search'),
    active,
    limit,
    offset,
  });
  if (!result.ok) return sendServiceError(res, result, context);
  sendSuccess(res, result.categories, context.requestId, context.receivedAt);
}

async function handleGetCategory(res, context, id) {
  const result = await productService.getProductCategory(context.getPool(), {
    installationId: context.requestContext.installationId,
    id,
  });
  if (!result.ok) return sendServiceError(res, result, context);
  sendSuccess(res, result.category, context.requestId, context.receivedAt);
}

async function handleCreateCategory(req, res, context) {
  const payload = await readPayload(req, res, context);
  if (payload === null) return;
  await executeIdempotentCreate(req, res, context, {
    route: '/api/product-categories',
    payload,
    create: async (client) => productService.createProductCategory(client, {
      installationId: context.requestContext.installationId,
      payload,
      createdBy: context.requestContext.actorId,
    }),
    resourceType: 'product_category',
    getResourceId: (category) => category.id,
    metadata: (category) => ({ code: category.code }),
  });
}

async function handlePatchCategory(req, res, context, id) {
  const payload = await readPayload(req, res, context);
  if (payload === null) return;
  await executePatch(res, context, {
    update: (client) => productService.updateProductCategory(client, {
      id,
      installationId: context.requestContext.installationId,
      payload,
      updatedBy: context.requestContext.actorId,
    }),
    resourceType: 'product_category',
    getEntity: (result) => result.category,
    getAction: (result) => result.action ?? 'update',
    metadata: (category) => ({ code: category.code }),
  });
}

async function handleListBrands(req, res, context) {
  const url = new URL(`http://localhost${req.url}`);
  let active, limit, offset;
  try {
    active = parseBooleanParam(url.searchParams.get('active'));
    limit = parsePositiveIntParam(url.searchParams.get('limit'), 100, 1000);
    offset = parsePositiveIntParam(url.searchParams.get('offset'), 0, 10000);
  } catch (error) {
    sendError(res, createError(error.code, error.publicMessage, {}, false, error.statusCode), context.requestId, context.receivedAt);
    return;
  }

  const result = await productService.listProductBrands(context.getPool(), {
    installationId: context.requestContext.installationId,
    search: url.searchParams.get('search'),
    active,
    limit,
    offset,
  });
  if (!result.ok) return sendServiceError(res, result, context);
  sendSuccess(res, result.brands, context.requestId, context.receivedAt);
}

async function handleGetBrand(res, context, id) {
  const result = await productService.getProductBrand(context.getPool(), {
    installationId: context.requestContext.installationId,
    id,
  });
  if (!result.ok) return sendServiceError(res, result, context);
  sendSuccess(res, result.brand, context.requestId, context.receivedAt);
}

async function handleCreateBrand(req, res, context) {
  const payload = await readPayload(req, res, context);
  if (payload === null) return;
  await executeIdempotentCreate(req, res, context, {
    route: '/api/product-brands',
    payload,
    create: async (client) => productService.createProductBrand(client, {
      installationId: context.requestContext.installationId,
      payload,
      createdBy: context.requestContext.actorId,
    }),
    resourceType: 'product_brand',
    getResourceId: (brand) => brand.id,
    metadata: (brand) => ({ code: brand.code }),
  });
}

async function handlePatchBrand(req, res, context, id) {
  const payload = await readPayload(req, res, context);
  if (payload === null) return;
  await executePatch(res, context, {
    update: (client) => productService.updateProductBrand(client, {
      id,
      installationId: context.requestContext.installationId,
      payload,
      updatedBy: context.requestContext.actorId,
    }),
    resourceType: 'product_brand',
    getEntity: (result) => result.brand,
    getAction: (result) => result.action ?? 'update',
    metadata: (brand) => ({ code: brand.code }),
  });
}

async function handleListProducts(req, res, context) {
  const url = new URL(`http://localhost${req.url}`);
  let active, catalogVisible, orderable, limit, offset;
  try {
    active = parseBooleanParam(url.searchParams.get('active'));
    catalogVisible = parseBooleanParam(url.searchParams.get('catalogVisible'));
    orderable = parseBooleanParam(url.searchParams.get('orderable'));
    limit = parsePositiveIntParam(url.searchParams.get('limit'), 100, 1000);
    offset = parsePositiveIntParam(url.searchParams.get('offset'), 0, 10000);
  } catch (error) {
    sendError(res, createError(error.code, error.publicMessage, {}, false, error.statusCode), context.requestId, context.receivedAt);
    return;
  }

  const result = await productService.listProducts(context.getPool(), {
    installationId: context.requestContext.installationId,
    search: url.searchParams.get('search'),
    active,
    catalogVisible,
    orderable,
    categoryId: url.searchParams.get('categoryId'),
    brandId: url.searchParams.get('brandId'),
    limit,
    offset,
  });
  if (!result.ok) return sendServiceError(res, result, context);
  sendSuccess(res, result.products, context.requestId, context.receivedAt);
}

async function handleGetProduct(res, context, id) {
  const result = await productService.getProduct(context.getPool(), {
    installationId: context.requestContext.installationId,
    id,
  });
  if (!result.ok) return sendServiceError(res, result, context);
  sendSuccess(res, result.product, context.requestId, context.receivedAt);
}

async function handleCreateProduct(req, res, context) {
  const payload = await readPayload(req, res, context);
  if (payload === null) return;
  await executeIdempotentCreate(req, res, context, {
    route: '/api/products',
    payload,
    create: async (client) => productService.createProduct(client, {
      installationId: context.requestContext.installationId,
      payload,
      createdBy: context.requestContext.actorId,
    }),
    resourceType: 'product',
    getResourceId: (product) => product.id,
    metadata: (product) => ({ code: product.code }),
  });
}

async function handlePatchProduct(req, res, context, id) {
  const payload = await readPayload(req, res, context);
  if (payload === null) return;
  await executePatch(res, context, {
    update: (client) => productService.updateProduct(client, {
      id,
      installationId: context.requestContext.installationId,
      payload,
      updatedBy: context.requestContext.actorId,
    }),
    resourceType: 'product',
    getEntity: (result) => result.product,
    getAction: (result) => result.action ?? 'update',
    metadata: (product) => ({ code: product.code }),
  });
}

async function handleListVariants(res, context, productId) {
  const result = await productService.listProductVariants(context.getPool(), {
    installationId: context.requestContext.installationId,
    productId,
  });
  if (!result.ok) return sendServiceError(res, result, context);
  sendSuccess(res, result.variants, context.requestId, context.receivedAt);
}

async function handleCreateVariant(req, res, context, productId) {
  const payload = await readPayload(req, res, context);
  if (payload === null) return;
  await executeIdempotentCreate(req, res, context, {
    route: `/api/products/${productId}/variants`,
    payload,
    create: async (client) => productService.createProductVariant(client, {
      installationId: context.requestContext.installationId,
      productId,
      payload,
      createdBy: context.requestContext.actorId,
    }),
    resourceType: 'product_variant',
    getResourceId: (variant) => variant.id,
    metadata: (variant) => ({ sku: variant.sku, productId }),
  });
}

async function handlePatchVariant(req, res, context, productId, variantId) {
  const payload = await readPayload(req, res, context);
  if (payload === null) return;
  await executePatch(res, context, {
    update: (client) => productService.updateProductVariant(client, {
      productId,
      variantId,
      installationId: context.requestContext.installationId,
      payload,
      updatedBy: context.requestContext.actorId,
    }),
    resourceType: 'product_variant',
    getEntity: (result) => result.variant,
    getAction: (result) => result.action ?? 'update',
    metadata: (variant) => ({ sku: variant.sku, productId }),
  });
}

async function handleImportProducts(req, res, context) {
  const payload = await readPayload(req, res, context);
  if (payload === null) return;
  await executeIdempotentCreate(req, res, context, {
    route: '/api/products/import',
    payload,
    create: async (client) => productService.importProducts(client, {
      installationId: context.requestContext.installationId,
      payload,
      createdBy: context.requestContext.actorId,
    }),
    resourceType: 'product_import',
    getResourceId: () => context.requestId,
    metadata: (result) => ({ imported: result.imported }),
  });
}

export async function handleProductRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  const isProductPath = pathname === '/api/product-categories'
    || pathname.startsWith('/api/product-categories/')
    || pathname === '/api/product-brands'
    || pathname.startsWith('/api/product-brands/')
    || pathname === '/api/products'
    || pathname.startsWith('/api/products/');

  if (!isProductPath) return false;

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
    method === 'GET' ? options.PERMISSIONS.coreProductRead : options.PERMISSIONS.coreProductWrite,
  );
  if (!permission.ok) {
    sendError(res, createError('FORBIDDEN', 'Permission denied', {}, false, 403), options.requestId, options.receivedAt);
    return true;
  }

  const context = { ...options, requestContext };

  if (pathname === '/api/product-categories' && method === 'GET') {
    await handleListCategories(req, res, context);
    return true;
  }
  if (pathname === '/api/product-categories' && method === 'POST') {
    await handleCreateCategory(req, res, context);
    return true;
  }
  const categoryMatch = pathname.match(/^\/api\/product-categories\/([^/]+)$/);
  if (categoryMatch && method === 'GET') {
    await handleGetCategory(res, context, categoryMatch[1]);
    return true;
  }
  if (categoryMatch && method === 'PATCH') {
    await handlePatchCategory(req, res, context, categoryMatch[1]);
    return true;
  }

  if (pathname === '/api/product-brands' && method === 'GET') {
    await handleListBrands(req, res, context);
    return true;
  }
  if (pathname === '/api/product-brands' && method === 'POST') {
    await handleCreateBrand(req, res, context);
    return true;
  }
  const brandMatch = pathname.match(/^\/api\/product-brands\/([^/]+)$/);
  if (brandMatch && method === 'GET') {
    await handleGetBrand(res, context, brandMatch[1]);
    return true;
  }
  if (brandMatch && method === 'PATCH') {
    await handlePatchBrand(req, res, context, brandMatch[1]);
    return true;
  }

  if (pathname === '/api/products' && method === 'GET') {
    await handleListProducts(req, res, context);
    return true;
  }
  if (pathname === '/api/products' && method === 'POST') {
    await handleCreateProduct(req, res, context);
    return true;
  }
  if (pathname === '/api/products/import' && method === 'POST') {
    await handleImportProducts(req, res, context);
    return true;
  }

  const productMatch = pathname.match(/^\/api\/products\/([^/]+)$/);
  if (productMatch && method === 'GET') {
    await handleGetProduct(res, context, productMatch[1]);
    return true;
  }
  if (productMatch && method === 'PATCH') {
    await handlePatchProduct(req, res, context, productMatch[1]);
    return true;
  }

  const variantsMatch = pathname.match(/^\/api\/products\/([^/]+)\/variants$/);
  if (variantsMatch && method === 'GET') {
    await handleListVariants(res, context, variantsMatch[1]);
    return true;
  }
  if (variantsMatch && method === 'POST') {
    await handleCreateVariant(req, res, context, variantsMatch[1]);
    return true;
  }

  const variantMatch = pathname.match(/^\/api\/products\/([^/]+)\/variants\/([^/]+)$/);
  if (variantMatch && method === 'PATCH') {
    await handlePatchVariant(req, res, context, variantMatch[1], variantMatch[2]);
    return true;
  }

  sendError(res, createError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), options.requestId, options.receivedAt);
  return true;
}
