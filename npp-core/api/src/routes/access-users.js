import { createSuccessEnvelope } from '@npp/contracts';
import { sendJson, sendSuccess, sendError } from '../http-utils.js';
import { readJsonBody, normalizeIdempotencyKey, executeRequestWithIdempotency } from '../idempotency.js';
import { buildAuditRecord, insertAuditRecord, withAuditOutboxTransaction } from '../audit-outbox.js';
import * as accessService from '../services/access-users.js';

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
  switch (result?.code) {
    case 'NOT_FOUND':
      return 404;
    case 'DUPLICATE_LOGIN':
    case 'DUPLICATE_EMPLOYEE':
    case 'CONFLICT':
      return 409;
    case 'INVALID_INPUT':
    case 'INVALID_LOGIN_NAME':
    case 'INVALID_ACTIVE_STATUS':
    case 'INVALID_ID':
    case 'INVALID_EMPLOYEE_ID':
    case 'INVALID_ROLE_ID':
    case 'MISSING_EXPECTED_UPDATED_AT':
    case 'INVALID_EXPECTED_UPDATED_AT':
      return 400;
    default:
      return 400;
  }
}

function normalizedRoleIds(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean))].sort()
    : [];
}

function deriveUserAuditAction(serviceResult) {
  if (serviceResult?.changed === false) return 'noop';
  const before = serviceResult?.beforeData;
  const after = serviceResult?.user;
  if (!before || !after) return 'create';
  if (before.is_active !== after.is_active) return after.is_active ? 'activate' : 'deactivate';
  const beforeRoles = normalizedRoleIds(before.role_ids);
  const afterRoles = normalizedRoleIds(after.role_ids);
  if (beforeRoles.length !== afterRoles.length || beforeRoles.some((id, index) => id !== afterRoles[index])) {
    return 'replace_roles';
  }
  return 'update';
}

function serviceErrorBody(result, requestId, receivedAt) {
  return {
    error: {
      code: result.code,
      message: result.message,
      retryable: Boolean(result.retryable),
      details: {},
    },
    requestId,
    receivedAt,
  };
}

async function handleListUsers(req, res, context) {
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

  try {
    const result = await accessService.listUsers(context.getPool(), {
      installationId: context.requestContext.installationId,
      active,
      search: url.searchParams.get('q') ?? url.searchParams.get('search') ?? '',
      limit,
      offset,
    });
    sendSuccess(res, result.users, context.requestId, context.receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_ERROR', 'Không thể tải danh sách người dùng', {}, true, 500), context.requestId, context.receivedAt);
  }
}

async function handleGetUser(req, res, context, id) {
  try {
    const result = await accessService.getUser(context.getPool(), {
      installationId: context.requestContext.installationId,
      id,
    });
    if (!result.ok) {
      sendError(res, createError(result.code, result.message, {}, false, serviceStatus(result)), context.requestId, context.receivedAt);
      return;
    }
    sendSuccess(res, result.user, context.requestId, context.receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_ERROR', 'Không thể tải người dùng', {}, true, 500), context.requestId, context.receivedAt);
  }
}

async function executeUserMutation(req, res, context, {
  route,
  statusCode,
  action,
}) {
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
      route,
      payload,
      onProcess: async () => {
        const transactionResult = await withAuditOutboxTransaction({
          adapter: context.getPool(),
          mutate: async (client) => {
            const serviceResult = await action(client, payload);
            if (!serviceResult.ok) return { serviceResult };

            const user = serviceResult.user;
            await insertAuditRecord(client, buildAuditRecord({
              requestContext: context.requestContext,
              action: deriveUserAuditAction(serviceResult),
              resourceType: 'user',
              resourceId: user.id,
              beforeData: serviceResult.beforeData ?? null,
              afterData: user,
              metadata: { employeeId: user.employee_id, loginName: user.login_name },
            }));
            return { user };
          },
        });

        if (transactionResult.serviceResult) {
          return {
            statusCode: serviceStatus(transactionResult.serviceResult),
            contentType: 'application/json',
            requestId: context.requestId,
            body: serviceErrorBody(transactionResult.serviceResult, context.requestId, context.receivedAt),
          };
        }

        return {
          statusCode,
          contentType: 'application/json',
          requestId: context.requestId,
          body: createSuccessEnvelope(transactionResult.user, context.requestId, context.receivedAt),
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

function requiredPermission(pathname, method, permissions) {
  if (method === 'GET') return permissions.coreUserRead;
  if (/^\/api\/access\/users\/[^/]+\/roles$/.test(pathname) && method === 'PATCH') {
    return permissions.coreUserRoleWrite;
  }
  return permissions.coreUserWrite;
}

export async function handleAccessUserRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  if (!(pathname === '/api/access/users' || pathname.startsWith('/api/access/users/'))) return false;

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
  const permission = options.authorize(requestContext, requiredPermission(pathname, method, options.PERMISSIONS));
  if (!permission.ok) {
    sendError(res, createError('FORBIDDEN', 'Không có quyền truy cập', {}, false, 403), options.requestId, options.receivedAt);
    return true;
  }

  const context = { ...options, requestContext };
  if (pathname === '/api/access/users' && method === 'GET') {
    await handleListUsers(req, res, context);
    return true;
  }
  if (pathname === '/api/access/users' && method === 'POST') {
    await executeUserMutation(req, res, context, {
      route: '/api/access/users',
      statusCode: 201,
      action: (client, payload) => accessService.createUser(client, {
        installationId: requestContext.installationId,
        payload,
        createdBy: requestContext.actorId,
      }),
    });
    return true;
  }

  const rolesMatch = pathname.match(/^\/api\/access\/users\/([^/]+)\/roles$/);
  if (rolesMatch && method === 'PATCH') {
    await executeUserMutation(req, res, context, {
      route: `/api/access/users/${rolesMatch[1]}/roles`,
      statusCode: 200,
      action: (client, payload) => accessService.replaceUserRoles(client, {
        id: rolesMatch[1],
        installationId: requestContext.installationId,
        payload,
        updatedBy: requestContext.actorId,
      }),
    });
    return true;
  }

  const userMatch = pathname.match(/^\/api\/access\/users\/([^/]+)$/);
  if (userMatch && method === 'GET') {
    await handleGetUser(req, res, context, userMatch[1]);
    return true;
  }
  if (userMatch && method === 'PATCH') {
    await executeUserMutation(req, res, context, {
      route: `/api/access/users/${userMatch[1]}`,
      statusCode: 200,
      action: (client, payload) => accessService.updateUserStatus(client, {
        id: userMatch[1],
        installationId: requestContext.installationId,
        payload,
        updatedBy: requestContext.actorId,
      }),
    });
    return true;
  }

  sendError(res, createError('METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ', {}, false, 405), options.requestId, options.receivedAt);
  return true;
}
