import { randomUUID } from 'node:crypto';
import { createSuccessEnvelope } from '@npp/contracts';
import { sendJson, sendSuccess, sendError } from '../http-utils.js';
import { readJsonBody, normalizeIdempotencyKey } from '../idempotency.js';
import { buildAuditRecord, insertAuditRecord, withAuditOutboxTransaction } from '../audit-outbox.js';
import { createOptionalR2StorageAdapter } from '../storage/r2-adapter.js';
import { buildR2ObjectKey } from '../storage/object-key.js';
import * as customerService from '../services/customer.js';
import * as customerMediaRepository from '../db/repositories/customer-media.js';

const CUSTOMER_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
const CUSTOMER_MEDIA_VIEW_TTL_SECONDS = 300;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLIENT_UPLOAD_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const CUSTOMER_MEDIA_MIME_TYPES = new Set(['image/jpeg', 'image/webp', 'image/png']);

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
  if (['NOT_FOUND', 'GROUP_NOT_FOUND', 'EMPLOYEE_NOT_FOUND', 'CUSTOMER_MEDIA_NOT_FOUND'].includes(result.code)) return 404;
  if ([
    'DUPLICATE_CODE',
    'CONFLICT',
    'GROUP_INACTIVE',
    'EMPLOYEE_INACTIVE',
    'CUSTOMER_INACTIVE',
    'CUSTOMER_MEDIA_LIMIT_REACHED',
    'CUSTOMER_MEDIA_READ_ONLY',
    'CUSTOMER_MEDIA_CONTENT_TYPE_MISMATCH',
    'CUSTOMER_MEDIA_SIZE_MISMATCH',
  ].includes(result.code)) return 409;
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
            const entity = serviceResult.entity;
            await insertAuditRecord(client, buildAuditRecord({
              requestContext: context.requestContext,
              action: 'create',
              resourceType,
              resourceId: getResourceId(entity),
              afterData: entity,
              metadata: metadata(entity),
            }));
            return { entity };
          },
        });

        if (transactionResult.skipAudit) {
          return {
            statusCode: serviceStatus(transactionResult.serviceResult),
            contentType: 'application/json',
            requestId: context.requestId,
            body: {
              error: {
                code: transactionResult.serviceResult.code,
                message: transactionResult.serviceResult.message,
                retryable: Boolean(transactionResult.serviceResult.retryable),
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
  getEntity,
  getAction,
  metadata,
}) {
  try {
    const transactionResult = await withAuditOutboxTransaction({
      adapter: context.getPool(),
      mutate: async (client) => {
        const serviceResult = await update(client);
        if (!serviceResult.ok) {
          throw Object.assign(new Error('CUSTOMER_MASTER_UPDATE_FAILED'), { serviceResult });
        }
        const entity = getEntity(serviceResult);
        if (serviceResult.changed === false) return { entity };
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
    sendError(res, createError('INTERNAL_ERROR', 'Failed to update customer master data', {}, true, 500), context.requestId, context.receivedAt);
  }
}

function customerMediaStorage(context) {
  const storage = createOptionalR2StorageAdapter(context.config);
  if (!storage) {
    throw Object.assign(new Error('CUSTOMER_MEDIA_STORAGE_UNAVAILABLE'), {
      code: 'CUSTOMER_MEDIA_STORAGE_UNAVAILABLE',
      publicMessage: 'Kho ảnh khách hàng chưa sẵn sàng',
      statusCode: 503,
    });
  }
  return storage;
}

function customerMediaAudit(media) {
  return {
    id: media.id,
    customerId: media.customerId,
    sourceApp: media.sourceApp,
    mimeType: media.mimeType,
    expectedByteSize: media.expectedByteSize,
    actualByteSize: media.actualByteSize,
    width: media.width,
    height: media.height,
    status: media.status,
  };
}

function mediaExecutionError(result, context) {
  return {
    statusCode: serviceStatus(result),
    contentType: 'application/json',
    requestId: context.requestId,
    body: {
      error: {
        code: result.code,
        message: result.message,
        retryable: Boolean(result.retryable),
        details: {},
      },
      requestId: context.requestId,
      receivedAt: context.receivedAt,
    },
  };
}

async function executeIdempotentMediaMutation(req, context, {
  route,
  payload,
  action,
  beforeTransaction,
  mutate,
}) {
  const keyResult = requireIdempotencyKey(req);
  if (!keyResult.ok) return { invalidKey: keyResult };
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
        const prepared = beforeTransaction ? await beforeTransaction() : undefined;
        const transactionResult = await withAuditOutboxTransaction({
          adapter: context.getPool(),
          mutate: async (client) => {
            const result = await mutate(client, prepared);
            if (!result.ok) return { serviceResult: result, skipAudit: true };
            if (result.replayed === true || result.changed === false) {
              return { entity: result.media, replayed: true };
            }
            await insertAuditRecord(client, buildAuditRecord({
              requestContext: context.requestContext,
              action,
              resourceType: 'customer_media',
              resourceId: result.media.id,
              afterData: customerMediaAudit(result.media),
              metadata: { customerId: result.media.customerId, sourceApp: result.media.sourceApp },
            }));
            return { entity: result.media };
          },
        });
        if (transactionResult.skipAudit) return mediaExecutionError(transactionResult.serviceResult, context);
        return {
          statusCode: action === 'create' ? 201 : 200,
          contentType: 'application/json',
          requestId: context.requestId,
          body: createSuccessEnvelope(
            { id: transactionResult.entity.id, customerId: transactionResult.entity.customerId },
            context.requestId,
            context.receivedAt,
          ),
        };
      },
    });
    return { execution };
  } catch (error) {
    if (error?.code && error?.statusCode) return { executionError: error };
    return { storageError: true };
  }
}

async function handleListCustomerMedia(res, context, customerId) {
  try {
    const result = await customerMediaRepository.listReadyCustomerMedia(context.getPool(), {
      installationId: context.requestContext.installationId,
      customerId,
    });
    if (!result.ok) return sendServiceError(res, result, context);
    const storage = customerMediaStorage(context);
    const ttl = Math.min(CUSTOMER_MEDIA_VIEW_TTL_SECONDS, context.config.r2PresignedUrlMaxSeconds);
    const media = await Promise.all(result.media.map(async (item) => {
      const signed = await storage.createPresignedGetUrl({
        installationId: context.requestContext.installationId,
        key: item.objectKey,
        expiresIn: ttl,
      });
      return customerMediaRepository.customerMediaPublic(item, signed.url);
    }));
    sendSuccess(res, { media, maxPhotos: result.maxPhotos }, context.requestId, context.receivedAt);
  } catch (error) {
    sendError(
      res,
      createError(error?.code || 'CUSTOMER_MEDIA_UNAVAILABLE', error?.publicMessage || 'Không tải được ảnh khách hàng', {}, true, error?.statusCode || 503),
      context.requestId,
      context.receivedAt,
    );
  }
}

async function handlePrepareCustomerMedia(req, res, context, customerId, payload) {
  const clientUploadId = String(payload.clientUploadId ?? '').trim();
  const mimeType = String(payload.mimeType ?? '').trim().toLowerCase();
  const byteSize = Number(payload.byteSize);
  const maxBytes = Math.min(CUSTOMER_MEDIA_MAX_BYTES, Number(context.config.r2MaxObjectBytes || CUSTOMER_MEDIA_MAX_BYTES));
  if (!CLIENT_UPLOAD_ID_PATTERN.test(clientUploadId)) {
    return sendError(res, createError('INVALID_CLIENT_UPLOAD_ID', 'Mã tải ảnh không hợp lệ', {}, false, 400), context.requestId, context.receivedAt);
  }
  if (!CUSTOMER_MEDIA_MIME_TYPES.has(mimeType)) {
    return sendError(res, createError('INVALID_MEDIA_MIME_TYPE', 'Định dạng ảnh không hợp lệ', {}, false, 400), context.requestId, context.receivedAt);
  }
  if (!Number.isInteger(byteSize) || byteSize < 1 || byteSize > maxBytes) {
    return sendError(res, createError('INVALID_MEDIA_BYTE_SIZE', 'Dung lượng ảnh không hợp lệ', { maxBytes }, false, 400), context.requestId, context.receivedAt);
  }

  const id = randomUUID();
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const objectKey = buildR2ObjectKey({
    installationId: context.requestContext.installationId,
    namespace: 'images',
    filename: `customer-${customerId}-${id}.${extension}`,
    uuid: id,
  });
  const mutation = await executeIdempotentMediaMutation(req, context, {
    route: `/api/customers/${customerId}/media/prepare`,
    payload: { action: 'prepare', clientUploadId, mimeType, byteSize },
    action: 'create',
    mutate: (client) => customerMediaRepository.prepareCoreCustomerMedia(client, {
      id,
      installationId: context.requestContext.installationId,
      customerId,
      clientUploadId,
      objectKey,
      mimeType,
      expectedByteSize: byteSize,
      actorId: context.requestContext.actorId,
    }),
  });
  if (mutation.invalidKey) {
    return sendError(res, createError(mutation.invalidKey.code, mutation.invalidKey.message, {}, false, 400), context.requestId, context.receivedAt);
  }
  if (mutation.storageError) {
    return sendError(res, createError('IDEMPOTENCY_STORAGE_ERROR', 'Idempotency storage unavailable', {}, true, 503), context.requestId, context.receivedAt);
  }
  if (mutation.executionError) {
    return sendError(res, createError(mutation.executionError.code, mutation.executionError.publicMessage || 'Không chuẩn bị được ảnh', {}, false, mutation.executionError.statusCode), context.requestId, context.receivedAt);
  }
  if (mutation.execution.response.statusCode >= 400) {
    res.setHeader('Cache-Control', 'no-store');
    return sendJson(res, mutation.execution.response.statusCode, mutation.execution.response.body, context.requestId, 'application/json');
  }

  try {
    const mediaId = mutation.execution.response.body?.data?.id;
    const media = await customerMediaRepository.getCustomerMedia(context.getPool(), {
      installationId: context.requestContext.installationId,
      customerId,
      mediaId,
    });
    if (!media || media.sourceApp !== 'CORE' || media.status !== 'pending') {
      return sendError(res, createError('CUSTOMER_MEDIA_NOT_PENDING', 'Ảnh khách hàng không còn chờ tải', {}, false, 409), context.requestId, context.receivedAt);
    }
    const storage = customerMediaStorage(context);
    const ttl = Math.min(CUSTOMER_MEDIA_VIEW_TTL_SECONDS, context.config.r2PresignedUrlMaxSeconds);
    const signed = await storage.createPresignedPutUrl({
      installationId: context.requestContext.installationId,
      key: media.objectKey,
      contentType: media.mimeType,
      expiresIn: ttl,
    });
    sendJson(
      res,
      201,
      createSuccessEnvelope({ mediaId: media.id, putUrl: signed.url, mimeType: media.mimeType, expiresIn: signed.expiresIn }, context.requestId, context.receivedAt),
      context.requestId,
      'application/json',
    );
  } catch (error) {
    sendError(res, createError(error?.code || 'CUSTOMER_MEDIA_STORAGE_UNAVAILABLE', 'Không cấp được đường dẫn tải ảnh', {}, true, error?.statusCode || 503), context.requestId, context.receivedAt);
  }
}

async function handleFinalizeCustomerMedia(req, res, context, customerId, payload) {
  const mediaId = String(payload.mediaId ?? '').trim();
  const width = Number(payload.width);
  const height = Number(payload.height);
  if (!UUID_PATTERN.test(mediaId)) {
    return sendError(res, createError('INVALID_CUSTOMER_MEDIA_ID', 'Mã ảnh không hợp lệ', {}, false, 400), context.requestId, context.receivedAt);
  }
  if (!Number.isInteger(width) || width < 1 || width > 20000 || !Number.isInteger(height) || height < 1 || height > 20000) {
    return sendError(res, createError('INVALID_MEDIA_DIMENSIONS', 'Kích thước ảnh không hợp lệ', {}, false, 400), context.requestId, context.receivedAt);
  }

  let media;
  try {
    media = await customerMediaRepository.getCustomerMedia(context.getPool(), {
      installationId: context.requestContext.installationId,
      customerId,
      mediaId,
    });
    if (!media) return sendServiceError(res, { code: 'CUSTOMER_MEDIA_NOT_FOUND', message: 'Customer photo not found' }, context);
    if (media.sourceApp !== 'CORE') return sendServiceError(res, { code: 'CUSTOMER_MEDIA_READ_ONLY', message: 'MCP customer photos are managed by MCP' }, context);
  } catch {
    return sendError(res, createError('CUSTOMER_MEDIA_UNAVAILABLE', 'Không đọc được ảnh khách hàng', {}, true, 503), context.requestId, context.receivedAt);
  }

  const mutation = await executeIdempotentMediaMutation(req, context, {
    route: `/api/customers/${customerId}/media/finalize`,
    payload: { action: 'finalize', mediaId, width, height },
    action: 'update',
    beforeTransaction: async () => {
      const storage = customerMediaStorage(context);
      return storage.headObject({ installationId: context.requestContext.installationId, key: media.objectKey });
    },
    mutate: (client, head) => {
      const contentType = String(head.contentType || '').split(';')[0].trim().toLowerCase();
      return customerMediaRepository.finalizeCoreCustomerMedia(client, {
        installationId: context.requestContext.installationId,
        customerId,
        mediaId,
        actualByteSize: Number(head.size),
        mimeType: contentType,
        width,
        height,
        etag: head.etag,
        actorId: context.requestContext.actorId,
      });
    },
  });
  if (mutation.invalidKey) {
    return sendError(res, createError(mutation.invalidKey.code, mutation.invalidKey.message, {}, false, 400), context.requestId, context.receivedAt);
  }
  if (mutation.storageError) {
    return sendError(res, createError('IDEMPOTENCY_STORAGE_ERROR', 'Idempotency storage unavailable', {}, true, 503), context.requestId, context.receivedAt);
  }
  if (mutation.executionError) {
    return sendError(res, createError(mutation.executionError.code, mutation.executionError.publicMessage || 'Không hoàn tất được ảnh', {}, false, mutation.executionError.statusCode), context.requestId, context.receivedAt);
  }
  res.setHeader('Cache-Control', 'no-store');
  sendJson(
    res,
    mutation.execution.response.statusCode,
    mutation.execution.response.body,
    mutation.execution.response.requestId ?? context.requestId,
    mutation.execution.response.contentType,
  );
}

async function handleCustomerMediaPost(req, res, context, customerId) {
  const payload = await readPayload(req, res, context);
  if (payload === null) return;
  const action = String(payload.action ?? '').trim().toLowerCase();
  if (action === 'prepare') return handlePrepareCustomerMedia(req, res, context, customerId, payload);
  if (action === 'finalize') return handleFinalizeCustomerMedia(req, res, context, customerId, payload);
  sendError(res, createError('INVALID_CUSTOMER_MEDIA_ACTION', 'Thao tác ảnh khách hàng không hợp lệ', {}, false, 400), context.requestId, context.receivedAt);
}

async function handleListGroups(req, res, context) {
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
    const result = await customerService.listCustomerGroups(context.getPool(), {
      installationId: context.requestContext.installationId,
      search: url.searchParams.get('search'),
      active,
      limit,
      offset,
    });
    if (!result.ok) return sendServiceError(res, result, context);
    sendSuccess(res, result.groups, context.requestId, context.receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_ERROR', 'Failed to list customer groups', {}, true, 500), context.requestId, context.receivedAt);
  }
}

async function handleGetGroup(res, context, id) {
  try {
    const result = await customerService.getCustomerGroup(context.getPool(), {
      installationId: context.requestContext.installationId,
      id,
    });
    if (!result.ok) return sendServiceError(res, result, context);
    sendSuccess(res, result.group, context.requestId, context.receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_ERROR', 'Failed to fetch customer group', {}, true, 500), context.requestId, context.receivedAt);
  }
}

async function handleCreateGroup(req, res, context) {
  const payload = await readPayload(req, res, context);
  if (payload === null) return;
  await executeIdempotentCreate(req, res, context, {
    route: '/api/customer-groups',
    payload,
    create: async (client) => {
      const result = await customerService.createCustomerGroup(client, {
        installationId: context.requestContext.installationId,
        payload,
        createdBy: context.requestContext.actorId,
      });
      return result.ok ? { ok: true, entity: result.group } : result;
    },
    resourceType: 'customer_group',
    getResourceId: (group) => group.id,
    metadata: (group) => ({ code: group.code }),
  });
}

async function handlePatchGroup(req, res, context, id) {
  const payload = await readPayload(req, res, context);
  if (payload === null) return;
  await executePatch(res, context, {
    update: (client) => customerService.updateCustomerGroup(client, {
      id,
      installationId: context.requestContext.installationId,
      payload,
      updatedBy: context.requestContext.actorId,
    }),
    resourceType: 'customer_group',
    getEntity: (result) => result.group,
    getAction: (result) => result.action ?? 'update',
    metadata: (group) => ({ code: group.code }),
  });
}

async function handleListCustomers(req, res, context) {
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
    const result = await customerService.listCustomers(context.getPool(), {
      installationId: context.requestContext.installationId,
      search: url.searchParams.get('search'),
      active,
      groupId: url.searchParams.get('groupId'),
      limit,
      offset,
    });
    if (!result.ok) return sendServiceError(res, result, context);
    sendSuccess(res, result.customers, context.requestId, context.receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_ERROR', 'Failed to list customers', {}, true, 500), context.requestId, context.receivedAt);
  }
}

async function handleGetCustomer(res, context, id) {
  try {
    const result = await customerService.getCustomer(context.getPool(), {
      installationId: context.requestContext.installationId,
      id,
    });
    if (!result.ok) return sendServiceError(res, result, context);
    sendSuccess(res, result.customer, context.requestId, context.receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_ERROR', 'Failed to fetch customer', {}, true, 500), context.requestId, context.receivedAt);
  }
}

async function handleCreateCustomer(req, res, context) {
  const payload = await readPayload(req, res, context);
  if (payload === null) return;
  await executeIdempotentCreate(req, res, context, {
    route: '/api/customers',
    payload,
    create: async (client) => {
      const result = await customerService.createCustomer(client, {
        installationId: context.requestContext.installationId,
        payload,
        createdBy: context.requestContext.actorId,
      });
      return result.ok ? { ok: true, entity: result.customer } : result;
    },
    resourceType: 'customer',
    getResourceId: (customer) => customer.id,
    metadata: (customer) => ({ code: customer.code }),
  });
}

async function handlePatchCustomer(req, res, context, id) {
  const payload = await readPayload(req, res, context);
  if (payload === null) return;
  await executePatch(res, context, {
    update: (client) => customerService.updateCustomer(client, {
      id,
      installationId: context.requestContext.installationId,
      payload,
      updatedBy: context.requestContext.actorId,
    }),
    resourceType: 'customer',
    getEntity: (result) => result.customer,
    getAction: (result) => result.action ?? 'update',
    metadata: (customer) => ({ code: customer.code }),
  });
}

async function handleListAddresses(res, context, customerId) {
  try {
    const result = await customerService.listCustomerAddresses(context.getPool(), {
      installationId: context.requestContext.installationId,
      customerId,
    });
    if (!result.ok) return sendServiceError(res, result, context);
    sendSuccess(res, result.addresses, context.requestId, context.receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_ERROR', 'Failed to list customer addresses', {}, true, 500), context.requestId, context.receivedAt);
  }
}

async function handleCreateAddress(req, res, context, customerId) {
  const payload = await readPayload(req, res, context);
  if (payload === null) return;
  await executeIdempotentCreate(req, res, context, {
    route: `/api/customers/${customerId}/addresses`,
    payload,
    create: async (client) => {
      const result = await customerService.createCustomerAddress(client, {
        installationId: context.requestContext.installationId,
        customerId,
        payload,
        createdBy: context.requestContext.actorId,
      });
      return result.ok ? { ok: true, entity: result.address } : result;
    },
    resourceType: 'customer_address',
    getResourceId: (address) => address.id,
    metadata: (address) => ({ customerId: address.customer_id, label: address.label }),
  });
}

async function handlePatchAddress(req, res, context, customerId, addressId) {
  const payload = await readPayload(req, res, context);
  if (payload === null) return;
  await executePatch(res, context, {
    update: (client) => customerService.updateCustomerAddress(client, {
      installationId: context.requestContext.installationId,
      customerId,
      addressId,
      payload,
      updatedBy: context.requestContext.actorId,
    }),
    resourceType: 'customer_address',
    getEntity: (result) => result.address,
    getAction: () => 'update',
    metadata: (address) => ({ customerId: address.customer_id, label: address.label }),
  });
}

export async function handleCustomerRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  const isCustomerPath = pathname === '/api/customers'
    || pathname.startsWith('/api/customers/')
    || pathname === '/api/customer-groups'
    || pathname.startsWith('/api/customer-groups/');
  if (!isCustomerPath) return false;

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
    method === 'GET' ? options.PERMISSIONS.coreCustomerRead : options.PERMISSIONS.coreCustomerWrite,
  );
  if (!permission.ok) {
    sendError(res, createError('FORBIDDEN', 'Permission denied', {}, false, 403), options.requestId, options.receivedAt);
    return true;
  }

  const context = { ...options, requestContext };

  if (pathname === '/api/customer-groups' && method === 'GET') {
    await handleListGroups(req, res, context);
    return true;
  }
  if (pathname === '/api/customer-groups' && method === 'POST') {
    await handleCreateGroup(req, res, context);
    return true;
  }
  const groupMatch = pathname.match(/^\/api\/customer-groups\/([^/]+)$/);
  if (groupMatch && method === 'GET') {
    await handleGetGroup(res, context, groupMatch[1]);
    return true;
  }
  if (groupMatch && method === 'PATCH') {
    await handlePatchGroup(req, res, context, groupMatch[1]);
    return true;
  }

  if (pathname === '/api/customers' && method === 'GET') {
    await handleListCustomers(req, res, context);
    return true;
  }
  if (pathname === '/api/customers' && method === 'POST') {
    await handleCreateCustomer(req, res, context);
    return true;
  }

  const mediaMatch = pathname.match(/^\/api\/customers\/([^/]+)\/media$/);
  if (mediaMatch && method === 'GET') {
    await handleListCustomerMedia(res, context, mediaMatch[1]);
    return true;
  }
  if (mediaMatch && method === 'POST') {
    await handleCustomerMediaPost(req, res, context, mediaMatch[1]);
    return true;
  }

  const addressCollectionMatch = pathname.match(/^\/api\/customers\/([^/]+)\/addresses$/);
  if (addressCollectionMatch && method === 'GET') {
    await handleListAddresses(res, context, addressCollectionMatch[1]);
    return true;
  }
  if (addressCollectionMatch && method === 'POST') {
    await handleCreateAddress(req, res, context, addressCollectionMatch[1]);
    return true;
  }

  const addressMatch = pathname.match(/^\/api\/customers\/([^/]+)\/addresses\/([^/]+)$/);
  if (addressMatch && method === 'PATCH') {
    await handlePatchAddress(req, res, context, addressMatch[1], addressMatch[2]);
    return true;
  }

  const customerMatch = pathname.match(/^\/api\/customers\/([^/]+)$/);
  if (customerMatch && method === 'GET') {
    await handleGetCustomer(res, context, customerMatch[1]);
    return true;
  }
  if (customerMatch && method === 'PATCH') {
    await handlePatchCustomer(req, res, context, customerMatch[1]);
    return true;
  }

  sendError(res, createError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), options.requestId, options.receivedAt);
  return true;
}
