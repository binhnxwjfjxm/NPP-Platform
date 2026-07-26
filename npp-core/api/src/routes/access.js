import { createSuccessEnvelope } from '@npp/contracts';
import { sendJson, sendSuccess, sendError } from '../http-utils.js';
import { readJsonBody, normalizeIdempotencyKey, executeRequestWithIdempotency } from '../idempotency.js';
import { buildAuditRecord, insertAuditRecord, withAuditOutboxTransaction } from '../audit-outbox.js';
import * as accessService from '../services/access.js';

function createError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function parseBooleanParam(value) {
  if (value === null) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw Object.assign(new Error('INVALID_QUERY_PARAMETER'), {
    code: 'INVALID_QUERY_PARAMETER',
    publicMessage: 'Tham số truy vấn phải là true hoặc false',
    statusCode: 400,
  });
}

function parsePositiveIntParam(value, defaultValue, maxValue) {
  if (value === null) return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > maxValue) {
    throw Object.assign(new Error('INVALID_QUERY_PARAMETER'), {
      code: 'INVALID_QUERY_PARAMETER',
      publicMessage: `Tham số truy vấn phải là số nguyên từ 0 đến ${maxValue}`,
      statusCode: 400,
    });
  }
  return parsed;
}

function requireIdempotencyKey(req) {
  const raw = req.headers['idempotency-key'];
  if (raw === undefined || raw === null) {
    return { ok: false, code: 'MISSING_IDEMPOTENCY_KEY', message: 'Bắt buộc có header Idempotency-Key' };
  }
  try {
    normalizeIdempotencyKey(raw);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      code: error.code ?? 'INVALID_IDEMPOTENCY_KEY',
      message: 'Idempotency-Key phải dài 1-128 ký tự và chỉ được chứa chữ cái, số, dấu chấm, gạch dưới hoặc gạch ngang',
    };
  }
}

function serviceStatus(result) {
  switch (result.code) {
    case 'NOT_FOUND':
      return 404;
    case 'DUPLICATE_CODE':
    case 'CONFLICT':
    case 'CODE_IMMUTABLE':
      return 409;
    case 'INVALID_PERMISSION_KEY':
    case 'INVALID_INPUT':
    case 'INVALID_CODE':
    case 'INVALID_NAME':
    case 'INVALID_DESCRIPTION':
    case 'INVALID_ACTIVE_STATUS':
    case 'INVALID_ID':
    case 'MISSING_EXPECTED_UPDATED_AT':
    case 'INVALID_EXPECTED_UPDATED_AT':
      return 400;
    default:
      return 400;
  }
}

function normalizedPermissionKeys(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean))].sort()
    : [];
}

function permissionSetsDiffer(beforeData, afterData) {
  const before = normalizedPermissionKeys(beforeData?.permission_keys);
  const after = normalizedPermissionKeys(afterData?.permission_keys);
  return before.length !== after.length || before.some((key, index) => key !== after[index]);
}

export function deriveRoleAuditAction(serviceResult) {
  if (serviceResult?.changed === false) return 'noop';

  const beforeData = serviceResult?.beforeData;
  const afterData = serviceResult?.role;

  if (beforeData && afterData && beforeData.is_active !== afterData.is_active) {
    return afterData.is_active ? 'activate' : 'deactivate';
  }
  if (permissionSetsDiffer(beforeData, afterData)) return 'replace_permissions';
  return 'update';
}

async function handleListPermissions(req, res, context) {
  try {
    const permissions = await accessService.listPermissions(context.getPool());
    sendSuccess(res, permissions, context.requestId, context.receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_ERROR', 'Không thể tải danh mục quyền', {}, true, 500), context.requestId, context.receivedAt);
  }
}

async function handleListRoles(req, res, context) {
  const url = new URL(`http://localhost${req.url}`);
  let active;
  let limit;
  let offset;
  try {
    active = parseBooleanParam(url.searchParams.get('active'));
    limit = parsePositiveIntParam(url.searchParams.get('limit'), 100, 1000);
    offset = parsePositiveIntParam(url.searchParams.get('offset'), 0, 10_000_000);
  } catch (error) {
    sendError(res, createError(error.code, error.publicMessage, {}, false, error.statusCode), context.requestId, context.receivedAt);
    return;
  }

  const search = url.searchParams.get('q') ?? url.searchParams.get('search') ?? '';
  try {
    const result = await accessService.listRoles(context.getPool(), {
      installationId: context.requestContext.installationId,
      active,
      search,
      limit,
      offset,
    });
    sendSuccess(res, result.roles, context.requestId, context.receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_ERROR', 'Không thể tải danh sách vai trò', {}, true, 500), context.requestId, context.receivedAt);
  }
}

async function handleGetRole(req, res, context, id) {
  try {
    const result = await accessService.getRole(context.getPool(), {
      installationId: context.requestContext.installationId,
      id,
    });
    if (!result.ok) {
      sendError(res, createError(result.code, result.message, {}, false, serviceStatus(result)), context.requestId, context.receivedAt);
      return;
    }
    sendSuccess(res, result.role, context.requestId, context.receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_ERROR', 'Không thể tải vai trò', {}, true, 500), context.requestId, context.receivedAt);
  }
}

async function handleCreateRole(req, res, context) {
  const keyResult = requireIdempotencyKey(req);
  if (!keyResult.ok) {
    sendError(res, createError(keyResult.code, keyResult.message, {}, false, 400), context.requestId, context.receivedAt);
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendError(res, createError(error.code, error.publicMessage, {}, false, error.statusCode), context.requestId, context.receivedAt);
    return;
  }

  try {
    const execution = await executeRequestWithIdempotency({
      idempotencyStore: context.idempotencyStore,
      req,
      requestContext: context.requestContext,
      requestId: context.requestId,
      receivedAt: context.receivedAt,
      route: '/api/access/roles',
      payload,
      onProcess: async () => {
        const result = await withAuditOutboxTransaction({
          adapter: context.getPool(),
          mutate: async (client) => {
            const serviceResult = await accessService.createRole(client, {
              installationId: context.requestContext.installationId,
              payload,
              createdBy: context.requestContext.actorId,
            });

            if (!serviceResult.ok) {
              return { skipAudit: true, serviceResult };
            }

            const role = serviceResult.role;
            await insertAuditRecord(client, buildAuditRecord({
              requestContext: context.requestContext,
              action: 'create',
              resourceType: 'role',
              resourceId: role.id,
              afterData: role,
              metadata: { code: role.code, permissionCount: role.permission_keys.length },
            }));
            return { role };
          },
        });

        if (result.skipAudit) {
          return {
            statusCode: serviceStatus(result.serviceResult) || 400,
            contentType: 'application/json',
            requestId: context.requestId,
            body: {
              error: {
                code: result.serviceResult.code,
                message: result.serviceResult.message,
                retryable: Boolean(result.serviceResult.retryable),
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
          body: createSuccessEnvelope(result.role, context.requestId, context.receivedAt),
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
    sendError(res, createError('IDEMPOTENCY_STORAGE_ERROR', 'Kho idempotency tạm thời không sẵn sàng', {}, true, 503), context.requestId, context.receivedAt);
  }
}

async function handlePatchRole(req, res, context, id) {
  const keyResult = requireIdempotencyKey(req);
  if (!keyResult.ok) {
    sendError(res, createError(keyResult.code, keyResult.message, {}, false, 400), context.requestId, context.receivedAt);
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendError(res, createError(error.code, error.publicMessage, {}, false, error.statusCode), context.requestId, context.receivedAt);
    return;
  }

  const expectedUpdatedAt = payload?.expectedUpdatedAt;
  if (typeof expectedUpdatedAt !== 'string' || !expectedUpdatedAt.trim()) {
    sendError(res, createError('MISSING_EXPECTED_UPDATED_AT', 'expectedUpdatedAt là bắt buộc cho thao tác cập nhật', {}, false, 400), context.requestId, context.receivedAt);
    return;
  }

  try {
    const execution = await executeRequestWithIdempotency({
      idempotencyStore: context.idempotencyStore,
      req,
      requestContext: context.requestContext,
      requestId: context.requestId,
      receivedAt: context.receivedAt,
      route: `/api/access/roles/${id}`,
      payload,
      onProcess: async () => {
        const result = await withAuditOutboxTransaction({
          adapter: context.getPool(),
          mutate: async (client) => {
            const serviceResult = await accessService.updateRole(client, {
              id,
              installationId: context.requestContext.installationId,
              payload,
              updatedBy: context.requestContext.actorId,
            });

            if (!serviceResult.ok) {
              return {
                skipAudit: true,
                serviceResult,
              };
            }

            const role = serviceResult.role;
            await insertAuditRecord(client, buildAuditRecord({
              requestContext: context.requestContext,
              action: deriveRoleAuditAction(serviceResult),
              resourceType: 'role',
              resourceId: role.id,
              beforeData: serviceResult.beforeData ?? null,
              afterData: role,
              metadata: { code: role.code, permissionCount: role.permission_keys.length },
            }));

            return { role };
          },
        });

        if (result.skipAudit) {
          return {
            statusCode: serviceStatus(result.serviceResult) || 400,
            contentType: 'application/json',
            requestId: context.requestId,
            body: {
              error: {
                code: result.serviceResult.code,
                message: result.serviceResult.message,
                retryable: Boolean(result.serviceResult.retryable),
                details: {},
              },
              requestId: context.requestId,
              receivedAt: context.receivedAt,
            },
          };
        }

        return {
          statusCode: 200,
          contentType: 'application/json',
          requestId: context.requestId,
          body: createSuccessEnvelope(result.role, context.requestId, context.receivedAt),
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
    sendError(res, createError('INTERNAL_ERROR', 'Không thể cập nhật vai trò', {}, true, 500), context.requestId, context.receivedAt);
  }
}

export async function handleAccessRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  if (!pathname.startsWith('/api/access/')) return false;

  const authResult = options.authenticate(req, options.config);
  if (!authResult.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, createError('UNAUTHORIZED', 'Cần xác thực', {}, false, 401), options.requestId, options.receivedAt);
    return true;
  }

  const requestContext = options.createContext({
    config: options.config,
    principal: authResult.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });

  const method = String(req.method || 'GET').toUpperCase();
  const permission = pathname === '/api/access/permissions'
    ? options.authorize(requestContext, options.PERMISSIONS.corePermissionRead)
    : options.authorize(
      requestContext,
      method === 'GET' ? options.PERMISSIONS.coreRoleRead : options.PERMISSIONS.coreRoleWrite,
    );

  if (!permission.ok) {
    sendError(res, createError('FORBIDDEN', 'Không có quyền truy cập', {}, false, 403), options.requestId, options.receivedAt);
    return true;
  }

  const context = { ...options, requestContext };
  if (pathname === '/api/access/permissions' && method === 'GET') {
    await handleListPermissions(req, res, context);
    return true;
  }
  if (pathname === '/api/access/roles' && method === 'GET') {
    await handleListRoles(req, res, context);
    return true;
  }
  if (pathname === '/api/access/roles' && method === 'POST') {
    await handleCreateRole(req, res, context);
    return true;
  }

  const match = pathname.match(/^\/api\/access\/roles\/([^/]+)$/);
  if (match && method === 'GET') {
    await handleGetRole(req, res, context, match[1]);
    return true;
  }
  if (match && method === 'PATCH') {
    await handlePatchRole(req, res, context, match[1]);
    return true;
  }

  sendError(res, createError('METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ', {}, false, 405), options.requestId, options.receivedAt);
  return true;
}
