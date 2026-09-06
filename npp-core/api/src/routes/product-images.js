import { createHash } from 'node:crypto';
import { createSuccessEnvelope } from '@npp/contracts';
import { sendJson, sendSuccess, sendError } from '../http-utils.js';
import { readJsonBody, normalizeIdempotencyKey } from '../idempotency.js';
import { buildAuditRecord, insertAuditRecord, withAuditOutboxTransaction } from '../audit-outbox.js';
import { createSharedProductImageStorage, PRODUCT_IMAGE_CONTENT_TYPE, SHARED_PRODUCT_IMAGE_PREFIX } from '../storage/product-images.js';
import * as productCrudService from '../services/product-with-inventory-policy.js';

const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function apiError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function storageStatus(error) {
  const status = Number(error?.statusCode);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 503;
}

function requireIdempotency(req) {
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
      message: 'Idempotency-Key must use 1-128 safe characters',
    };
  }
}

async function payload(req, res, context) {
  try {
    return await readJsonBody(req);
  } catch (error) {
    sendError(res, apiError(error.code, error.publicMessage, {}, false, error.statusCode), context.requestId, context.receivedAt);
    return null;
  }
}

function readImageBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let overflow = false;
    req.on('data', (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maxBytes) {
        overflow = true;
        chunks.length = 0;
        return;
      }
      if (!overflow) chunks.push(bytes);
    });
    req.on('end', () => {
      if (overflow || size < 1) {
        reject(apiError('INVALID_PRODUCT_IMAGE_SIZE', 'Dung lượng ảnh sản phẩm không hợp lệ', { maxBytes }, false, overflow ? 413 : 400));
        return;
      }
      resolve(Buffer.concat(chunks, size));
    });
    req.on('error', () => {
      reject(apiError('INVALID_PRODUCT_IMAGE_REQUEST', 'Không đọc được dữ liệu ảnh sản phẩm', {}, false, 400));
    });
  });
}

async function getProduct(context, productId) {
  if (!UUID_PATTERN.test(String(productId ?? ''))) {
    return { ok: false, code: 'PRODUCT_NOT_FOUND', message: 'Sản phẩm không tồn tại' };
  }
  return productCrudService.getProduct(context.getPool(), {
    installationId: context.requestContext.installationId,
    id: productId,
  });
}

function imageBaseUrl(config) {
  const raw = String(config.r2PublicBaseUrl ?? '').trim();
  if (!raw) throw Object.assign(new Error('PRODUCT_IMAGE_PUBLIC_URL_MISSING'), {
    code: 'PRODUCT_IMAGE_STORAGE_UNAVAILABLE',
    publicMessage: 'Kho ảnh sản phẩm chưa cấu hình địa chỉ xem ảnh',
    statusCode: 503,
  });
  return `${raw.replace(/\/+$/, '')}/${SHARED_PRODUCT_IMAGE_PREFIX.replace(/\/$/, '')}`;
}

async function handleImageIndex(res, context) {
  try {
    const storage = createSharedProductImageStorage(context.config);
    const codes = await storage.listImageCodes();
    sendSuccess(res, {
      baseUrl: imageBaseUrl(context.config),
      codes,
    }, context.requestId, context.receivedAt);
  } catch (error) {
    sendError(
      res,
      apiError(
        error?.code || 'PRODUCT_IMAGE_STORAGE_UNAVAILABLE',
        error?.publicMessage || 'Không tải được danh sách ảnh sản phẩm',
        {},
        Boolean(error?.retryable ?? true),
        storageStatus(error),
      ),
      context.requestId,
      context.receivedAt,
    );
  }
}

async function handlePrepare(req, res, context, productId) {
  const body = await payload(req, res, context);
  if (body === null) return;
  const byteSize = Number(body.byteSize);
  const mimeType = String(body.mimeType ?? '').trim().toLowerCase();
  const maxBytes = Math.min(PRODUCT_IMAGE_MAX_BYTES, Number(context.config.r2MaxObjectBytes || PRODUCT_IMAGE_MAX_BYTES));
  if (mimeType !== PRODUCT_IMAGE_CONTENT_TYPE) {
    return sendError(res, apiError('INVALID_PRODUCT_IMAGE_TYPE', 'Ảnh sản phẩm phải được chuyển sang WebP trước khi tải lên', {}, false, 400), context.requestId, context.receivedAt);
  }
  if (!Number.isInteger(byteSize) || byteSize < 1 || byteSize > maxBytes) {
    return sendError(res, apiError('INVALID_PRODUCT_IMAGE_SIZE', 'Dung lượng ảnh sản phẩm không hợp lệ', { maxBytes }, false, 400), context.requestId, context.receivedAt);
  }

  try {
    const found = await getProduct(context, productId);
    if (!found.ok) {
      return sendError(res, apiError(found.code, found.message, {}, false, 404), context.requestId, context.receivedAt);
    }
    const storage = createSharedProductImageStorage(context.config);
    const upload = await storage.createUploadUrl({ productCode: found.product.code, expiresIn: 300 });
    sendSuccess(res, {
      productId: found.product.id,
      productCode: found.product.code,
      publicUrl: storage.imageUrl(found.product.code),
      uploadUrl: upload.url,
      uploadHeaders: upload.headers,
      expiresIn: upload.expiresIn,
    }, context.requestId, context.receivedAt);
  } catch (error) {
    sendError(
      res,
      apiError(
        error?.code || 'PRODUCT_IMAGE_STORAGE_UNAVAILABLE',
        error?.publicMessage || 'Không chuẩn bị được ảnh sản phẩm',
        {},
        Boolean(error?.retryable ?? true),
        storageStatus(error),
      ),
      context.requestId,
      context.receivedAt,
    );
  }
}

async function executeIdempotentImageMutation(req, res, context, {
  route,
  body,
  product,
  action,
  process,
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
        try {
          const result = await process();
          await withAuditOutboxTransaction({
            adapter: context.getPool(),
            mutate: async (client) => {
              await insertAuditRecord(client, buildAuditRecord({
                requestContext: context.requestContext,
                action,
                resourceType: 'product_image',
                resourceId: product.id,
                afterData: {
                  productId: product.id,
                  productCode: product.code,
                  imagePresent: action !== 'delete',
                  byteSize: result.byteSize ?? null,
                },
                metadata: {
                  productCode: product.code,
                  source: 'shared_r2_product_image',
                },
              }));
              return { ok: true };
            },
          });
          return {
            statusCode: 200,
            contentType: 'application/json',
            requestId: context.requestId,
            body: createSuccessEnvelope(result, context.requestId, context.receivedAt),
          };
        } catch (error) {
          return {
            statusCode: storageStatus(error),
            contentType: 'application/json',
            requestId: context.requestId,
            body: {
              error: {
                code: error?.code || 'PRODUCT_IMAGE_STORAGE_UNAVAILABLE',
                message: error?.publicMessage || 'Không cập nhật được ảnh sản phẩm',
                retryable: Boolean(error?.retryable ?? true),
                details: {},
              },
              requestId: context.requestId,
              receivedAt: context.receivedAt,
            },
          };
        }
      },
    });
    res.setHeader('Cache-Control', 'no-store');
    sendJson(res, execution.response.statusCode, execution.response.body, execution.response.requestId ?? context.requestId, execution.response.contentType);
  } catch {
    sendError(res, apiError('IDEMPOTENCY_STORAGE_ERROR', 'Không thể bảo đảm chống xử lý trùng', {}, true, 503), context.requestId, context.receivedAt);
  }
}

async function handleUpload(req, res, context, productId) {
  const contentType = String(req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== PRODUCT_IMAGE_CONTENT_TYPE) {
    return sendError(res, apiError('INVALID_PRODUCT_IMAGE_TYPE', 'Ảnh sản phẩm phải được chuyển sang WebP trước khi tải lên', {}, false, 400), context.requestId, context.receivedAt);
  }
  const found = await getProduct(context, productId);
  if (!found.ok) {
    return sendError(res, apiError(found.code, found.message, {}, false, 404), context.requestId, context.receivedAt);
  }
  const maxBytes = Math.min(PRODUCT_IMAGE_MAX_BYTES, Number(context.config.r2MaxObjectBytes || PRODUCT_IMAGE_MAX_BYTES));
  let imageBytes;
  try {
    imageBytes = await readImageBody(req, maxBytes);
  } catch (error) {
    return sendError(res, error, context.requestId, context.receivedAt);
  }
  const contentSha256 = createHash('sha256').update(imageBytes).digest('hex');
  const storage = createSharedProductImageStorage(context.config);
  await executeIdempotentImageMutation(req, res, context, {
    route: `/api/products/${productId}/image/upload`,
    body: { byteSize: imageBytes.length, contentType: PRODUCT_IMAGE_CONTENT_TYPE, contentSha256 },
    product: found.product,
    action: 'update',
    process: async () => {
      await storage.putImage({ productCode: found.product.code, body: imageBytes });
      const head = await storage.headImage({ productCode: found.product.code });
      if (head.contentType !== PRODUCT_IMAGE_CONTENT_TYPE || head.size !== imageBytes.length) {
        throw Object.assign(new Error('PRODUCT_IMAGE_UPLOAD_VERIFY_FAILED'), {
          code: 'PRODUCT_IMAGE_UPLOAD_VERIFY_FAILED',
          publicMessage: 'Ảnh đã tải lên nhưng chưa xác minh được đầy đủ',
          statusCode: 503,
          retryable: true,
        });
      }
      return {
        productId: found.product.id,
        productCode: found.product.code,
        imageUrl: storage.imageUrl(found.product.code),
        byteSize: head.size,
      };
    },
  });
}

async function handleCommit(req, res, context, productId) {
  const body = await payload(req, res, context);
  if (body === null) return;
  const expectedByteSize = Number(body.expectedByteSize);
  if (!Number.isInteger(expectedByteSize) || expectedByteSize < 1) {
    return sendError(res, apiError('INVALID_PRODUCT_IMAGE_SIZE', 'Dung lượng ảnh xác nhận không hợp lệ', {}, false, 400), context.requestId, context.receivedAt);
  }
  const found = await getProduct(context, productId);
  if (!found.ok) {
    return sendError(res, apiError(found.code, found.message, {}, false, 404), context.requestId, context.receivedAt);
  }
  const storage = createSharedProductImageStorage(context.config);
  await executeIdempotentImageMutation(req, res, context, {
    route: `/api/products/${productId}/image/commit`,
    body: { expectedByteSize },
    product: found.product,
    action: 'update',
    process: async () => {
      const head = await storage.headImage({ productCode: found.product.code });
      if (head.contentType !== PRODUCT_IMAGE_CONTENT_TYPE) {
        throw Object.assign(new Error('PRODUCT_IMAGE_CONTENT_TYPE_MISMATCH'), {
          code: 'PRODUCT_IMAGE_CONTENT_TYPE_MISMATCH',
          publicMessage: 'Ảnh tải lên không đúng định dạng WebP',
          statusCode: 409,
          retryable: false,
        });
      }
      if (head.size !== expectedByteSize) {
        throw Object.assign(new Error('PRODUCT_IMAGE_SIZE_MISMATCH'), {
          code: 'PRODUCT_IMAGE_SIZE_MISMATCH',
          publicMessage: 'Dung lượng ảnh tải lên không khớp',
          statusCode: 409,
          retryable: false,
        });
      }
      return {
        productId: found.product.id,
        productCode: found.product.code,
        imageUrl: storage.imageUrl(found.product.code),
        byteSize: head.size,
      };
    },
  });
}

async function handleDelete(req, res, context, productId) {
  const found = await getProduct(context, productId);
  if (!found.ok) {
    return sendError(res, apiError(found.code, found.message, {}, false, 404), context.requestId, context.receivedAt);
  }
  const storage = createSharedProductImageStorage(context.config);
  await executeIdempotentImageMutation(req, res, context, {
    route: `/api/products/${productId}/image`,
    body: { productId, action: 'delete' },
    product: found.product,
    action: 'delete',
    process: async () => {
      await storage.deleteImage({ productCode: found.product.code });
      return {
        productId: found.product.id,
        productCode: found.product.code,
        imageUrl: storage.imageUrl(found.product.code),
        deleted: true,
      };
    },
  });
}

export async function handleProductImageRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  const indexRoute = pathname === '/api/products/images';
  const match = pathname.match(/^\/api\/products\/([^/]+)\/image(?:\/(prepare|commit|upload))?$/);
  if (!indexRoute && !match) return false;

  const auth = options.authenticate(req, options.config);
  if (!auth.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, apiError('UNAUTHORIZED', 'Authorization required', {}, false, 401), options.requestId, options.receivedAt);
    return true;
  }
  const requestContext = options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  const method = String(req.method || 'GET').toUpperCase();
  const isRead = indexRoute && method === 'GET';
  const permission = options.authorize(requestContext, isRead ? options.PERMISSIONS.coreProductRead : options.PERMISSIONS.coreProductWrite);
  if (!permission.ok) {
    sendError(res, apiError('FORBIDDEN', 'Permission denied', {}, false, 403), options.requestId, options.receivedAt);
    return true;
  }
  const context = { ...options, requestContext };

  if (indexRoute && method === 'GET') {
    await handleImageIndex(res, context);
    return true;
  }
  if (match?.[2] === 'upload' && method === 'PUT') {
    await handleUpload(req, res, context, match[1]);
    return true;
  }
  if (match?.[2] === 'prepare' && method === 'POST') {
    await handlePrepare(req, res, context, match[1]);
    return true;
  }
  if (match?.[2] === 'commit' && method === 'POST') {
    await handleCommit(req, res, context, match[1]);
    return true;
  }
  if (match && !match[2] && method === 'DELETE') {
    await handleDelete(req, res, context, match[1]);
    return true;
  }

  sendError(res, apiError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), options.requestId, options.receivedAt);
  return true;
}
