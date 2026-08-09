import { createSuccessEnvelope } from '@npp/contracts';
import { sendJson, sendSuccess, sendError } from '../http-utils.js';
import { readJsonBody, normalizeIdempotencyKey } from '../idempotency.js';
import { buildAuditRecord, insertAuditRecord, withAuditOutboxTransaction } from '../audit-outbox.js';
import { canManageSecurityOwners, guardSecurityOwnerEmployeeMutation } from '../internal-workforce-auth.js';
import * as employeeService from '../services/employee.js';

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
  if (result.code === 'NOT_FOUND' || result.code === 'BRANCH_NOT_FOUND') return 404;
  if (result.code === 'SECURITY_OWNER_PROTECTED') return 403;
  if (result.code === 'DUPLICATE_CODE' || result.code === 'CONFLICT' || result.code === 'BRANCH_INACTIVE') return 409;
  return 400;
}

async function handleList(req, res, context) {
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
    const result = await employeeService.listEmployees(context.getPool(), {
      installationId: context.requestContext.installationId,
      active,
      branchId: url.searchParams.get('branchId'),
      limit,
      offset,
    });
    if (!result.ok) {
      sendError(res, createError(result.code, result.message, {}, false, serviceStatus(result)), context.requestId, context.receivedAt);
      return;
    }
    sendSuccess(res, result.employees, context.requestId, context.receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_ERROR', 'Failed to list employees', {}, true, 500), context.requestId, context.receivedAt);
  }
}

async function handleGetById(req, res, context, id) {
  try {
    const result = await employeeService.getEmployee(context.getPool(), {
      installationId: context.requestContext.installationId,
      id,
    });
    if (!result.ok) {
      sendError(res, createError(result.code, result.message, {}, false, serviceStatus(result)), context.requestId, context.receivedAt);
      return;
    }
    sendSuccess(res, result.employee, context.requestId, context.receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_ERROR', 'Failed to fetch employee', {}, true, 500), context.requestId, context.receivedAt);
  }
}

async function handleCreate(req, res, context) {
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
    const execution = await context.executeRequestWithIdempotency({
      idempotencyStore: context.idempotencyStore,
      req,
      requestContext: context.requestContext,
      requestId: context.requestId,
      receivedAt: context.receivedAt,
      route: '/api/employees',
      payload,
      onProcess: async () => {
        const result = await withAuditOutboxTransaction({
          adapter: context.getPool(),
          mutate: async (client) => {
            const serviceResult = await employeeService.createEmployee(client, {
              installationId: context.requestContext.installationId,
              payload,
              createdBy: context.requestContext.actorId,
            });
            if (!serviceResult.ok) return { serviceResult, skipAudit: true };

            const employee = serviceResult.employee;
            await insertAuditRecord(client, buildAuditRecord({
              requestContext: context.requestContext,
              action: 'create',
              resourceType: 'employee',
              resourceId: employee.id,
              afterData: employee,
              metadata: { code: employee.code },
            }));
            return { employee };
          },
        });

        if (result.skipAudit) {
          return {
            statusCode: serviceStatus(result.serviceResult),
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
          body: createSuccessEnvelope(result.employee, context.requestId, context.receivedAt),
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
    sendError(res, createError('IDEMPOTENCY_STORAGE_ERROR', 'Idempotency storage unavailable', {}, true, 503), context.requestId, context.receivedAt);
  }
}

async function handlePatch(req, res, context, id) {
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendError(res, createError(error.code, error.publicMessage, {}, false, error.statusCode), context.requestId, context.receivedAt);
    return;
  }

  try {
    const result = await withAuditOutboxTransaction({
      adapter: context.getPool(),
      mutate: async (client) => {
        const protection = await guardSecurityOwnerEmployeeMutation(client, {
          installationId: context.requestContext.installationId,
          employeeId: id,
          allowSecurityOwnerMutation: canManageSecurityOwners(context.requestContext),
        });
        if (!protection.ok) {
          throw Object.assign(new Error('EMPLOYEE_UPDATE_FAILED'), {
            serviceResult: {
              ...protection,
              message: 'Security Owner employee được bảo vệ khỏi thay đổi bởi quản trị viên thông thường',
            },
          });
        }

        const serviceResult = typeof payload.isActive === 'boolean'
          ? await employeeService.updateEmployeeStatus(client, {
            id,
            installationId: context.requestContext.installationId,
            isActive: payload.isActive,
            updatedBy: context.requestContext.actorId,
            expectedUpdatedAt: payload.expectedUpdatedAt,
          })
          : await employeeService.updateEmployee(client, {
            id,
            installationId: context.requestContext.installationId,
            payload,
            updatedBy: context.requestContext.actorId,
          });

        if (!serviceResult.ok) {
          throw Object.assign(new Error('EMPLOYEE_UPDATE_FAILED'), { serviceResult });
        }

        const employee = serviceResult.employee;
        if (serviceResult.changed === false) return { employee };

        await insertAuditRecord(client, buildAuditRecord({
          requestContext: context.requestContext,
          action: typeof payload.isActive === 'boolean'
            ? (payload.isActive ? 'activate' : 'deactivate')
            : 'update',
          resourceType: 'employee',
          resourceId: employee.id,
          beforeData: serviceResult.beforeData ?? null,
          afterData: employee,
          metadata: { code: employee.code },
        }));
        return { employee };
      },
    });

    sendSuccess(res, result.employee, context.requestId, context.receivedAt);
  } catch (error) {
    if (error?.serviceResult) {
      sendError(
        res,
        createError(error.serviceResult.code, error.serviceResult.message, {}, Boolean(error.serviceResult.retryable), serviceStatus(error.serviceResult)),
        context.requestId,
        context.receivedAt,
      );
      return;
    }
    sendError(res, createError('INTERNAL_ERROR', 'Failed to update employee', {}, true, 500), context.requestId, context.receivedAt);
  }
}

export async function handleEmployeeRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  if (pathname !== '/api/employees' && !pathname.startsWith('/api/employees/')) return false;

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
    method === 'GET' ? options.PERMISSIONS.coreEmployeeRead : options.PERMISSIONS.coreEmployeeWrite,
  );
  if (!permission.ok) {
    sendError(res, createError('FORBIDDEN', 'Permission denied', {}, false, 403), options.requestId, options.receivedAt);
    return true;
  }

  const context = { ...options, requestContext };
  if (pathname === '/api/employees' && method === 'GET') {
    await handleList(req, res, context);
    return true;
  }
  if (pathname === '/api/employees' && method === 'POST') {
    await handleCreate(req, res, context);
    return true;
  }

  const match = pathname.match(/^\/api\/employees\/([^/]+)$/);
  if (match && method === 'GET') {
    await handleGetById(req, res, context, match[1]);
    return true;
  }
  if (match && method === 'PATCH') {
    await handlePatch(req, res, context, match[1]);
    return true;
  }

  sendError(res, createError('METHOD_NOT_ALLOWED', 'Method not allowed', {}, false, 405), options.requestId, options.receivedAt);
  return true;
}
