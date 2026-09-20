import { createSuccessEnvelope } from '@npp/contracts';
import { sendJson, sendSuccess, sendError } from '../http-utils.js';
import { readJsonBody, normalizeIdempotencyKey } from '../idempotency.js';
import { buildAuditRecord, insertAuditRecord, withAuditOutboxTransaction } from '../audit-outbox.js';
import * as workforceService from '../services/workforce.js';

function createError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(result) {
  if (result.code === 'EMPLOYEE_NOT_FOUND' || result.code === 'POLICY_NOT_FOUND') return 404;
  if (result.code === 'SCOPE_FORBIDDEN') return 403;
  if ([
    'POLICY_CODE_EXISTS', 'POLICY_VERSION_CONFLICT', 'POLICY_EFFECTIVE_DATE_CONFLICT',
    'ASSIGNMENT_EFFECTIVE_DATE_CONFLICT', 'SCHEDULE_CONFLICT',
  ].includes(result.code)) return 409;
  return 400;
}

function requireIdempotencyKey(req) {
  const raw = req.headers['idempotency-key'];
  if (raw === undefined || raw === null) {
    return { ok: false, code: 'MISSING_IDEMPOTENCY_KEY', message: 'Thiếu khóa chống xử lý trùng yêu cầu' };
  }
  try {
    normalizeIdempotencyKey(raw);
    return { ok: true };
  } catch (error) {
    return { ok: false, code: error.code ?? 'INVALID_IDEMPOTENCY_KEY', message: 'Khóa chống xử lý trùng không hợp lệ' };
  }
}

function isCompanyScope(requestContext) {
  return requestContext.scopeAuthority === 'COMPANY';
}

async function requireEmployeeScope(client, requestContext, employeeId) {
  const result = await workforceService.getEmployeeScopeRecord(client, {
    installationId: requestContext.installationId,
    employeeId,
  });
  if (!result.ok) return result;
  if (isCompanyScope(requestContext)) return result;
  const allowed = new Set(requestContext.scopes.branchIds ?? []);
  if (!result.employee.branch_id || !allowed.has(String(result.employee.branch_id))) {
    return { ok: false, code: 'SCOPE_FORBIDDEN', message: 'Bạn không có quyền thao tác nhân sự ngoài phạm vi được cấp' };
  }
  return result;
}

function failureResponse(result, context) {
  return {
    statusCode: statusFor(result),
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

async function parsePayload(req, res, context) {
  try {
    return { ok: true, payload: await readJsonBody(req) };
  } catch (error) {
    sendError(res, createError(error.code, error.publicMessage, {}, false, error.statusCode), context.requestId, context.receivedAt);
    return { ok: false, payload: null };
  }
}

async function runIdempotentMutation(req, res, context, { route, payload, mutate, successStatus = 200 }) {
  const key = requireIdempotencyKey(req);
  if (!key.ok) {
    sendError(res, createError(key.code, key.message, {}, false, 400), context.requestId, context.receivedAt);
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
        const result = await withAuditOutboxTransaction({
          adapter: context.getPool(),
          mutate: async (client) => {
            const mutation = await mutate(client);
            if (!mutation.ok) return { mutation, skipAudit: true };
            await insertAuditRecord(client, buildAuditRecord(mutation.audit));
            return mutation;
          },
        });
        if (result.skipAudit) return failureResponse(result.mutation, context);
        return {
          statusCode: successStatus,
          contentType: 'application/json',
          requestId: context.requestId,
          body: createSuccessEnvelope(result.data, context.requestId, context.receivedAt),
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
    sendError(res, createError('WORKFORCE_MUTATION_UNAVAILABLE', 'Không thể lưu thay đổi nhân sự lúc này', {}, true, 503), context.requestId, context.receivedAt);
  }
}

async function handlePolicies(req, res, context, method) {
  if (method === 'GET') {
    const result = await workforceService.listWorkPolicies(context.getPool(), {
      installationId: context.requestContext.installationId,
    });
    sendSuccess(res, result.policies, context.requestId, context.receivedAt);
    return;
  }
  const parsed = await parsePayload(req, res, context);
  if (!parsed.ok) return;
  const payload = parsed.payload;
  await runIdempotentMutation(req, res, context, {
    route: '/api/workforce/policies',
    payload,
    successStatus: 201,
    mutate: async (client) => {
      const result = await workforceService.createWorkPolicyVersion(client, {
        installationId: context.requestContext.installationId,
        payload,
        actorId: context.requestContext.actorId,
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: result.policy,
        audit: {
          requestContext: context.requestContext,
          action: result.action === 'version' ? 'version' : 'create',
          resourceType: 'work-policy',
          resourceId: result.policy.id,
          beforeData: result.beforePolicy ?? null,
          afterData: result.policy,
          metadata: { code: result.policy.code, version: result.policy.version },
        },
      };
    },
  });
}

async function handleAssignments(req, res, context, method) {
  if (method === 'GET') {
    const url = new URL(`http://localhost${req.url}`);
    const employeeId = String(url.searchParams.get('employeeId') ?? '').trim();
    const scope = await requireEmployeeScope(context.getPool(), context.requestContext, employeeId);
    if (!scope.ok) {
      sendError(res, createError(scope.code, scope.message, {}, false, statusFor(scope)), context.requestId, context.receivedAt);
      return;
    }
    const result = await workforceService.listEmployeePolicyAssignments(context.getPool(), {
      installationId: context.requestContext.installationId,
      employeeId,
    });
    sendSuccess(res, result.assignments, context.requestId, context.receivedAt);
    return;
  }

  const parsed = await parsePayload(req, res, context);
  if (!parsed.ok) return;
  const payload = parsed.payload;
  await runIdempotentMutation(req, res, context, {
    route: '/api/workforce/assignments',
    payload,
    successStatus: 201,
    mutate: async (client) => {
      const scope = await requireEmployeeScope(client, context.requestContext, String(payload?.employeeId ?? ''));
      if (!scope.ok) return scope;
      const result = await workforceService.assignWorkPolicy(client, {
        installationId: context.requestContext.installationId,
        payload,
        actorId: context.requestContext.actorId,
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: result.assignment,
        audit: {
          requestContext: context.requestContext,
          action: 'assign',
          resourceType: 'employee-work-policy',
          resourceId: result.assignment.id,
          beforeData: result.beforeAssignment ?? null,
          afterData: result.assignment,
          metadata: { employeeId: result.employee.id, policyId: result.assignment.work_policy_id },
        },
      };
    },
  });
}

async function handleSchedules(req, res, context, method) {
  if (method === 'GET') {
    const url = new URL(`http://localhost${req.url}`);
    const employeeId = String(url.searchParams.get('employeeId') ?? '').trim() || null;
    const dateFrom = String(url.searchParams.get('from') ?? '').trim();
    const dateTo = String(url.searchParams.get('to') ?? '').trim();
    if (employeeId) {
      const scope = await requireEmployeeScope(context.getPool(), context.requestContext, employeeId);
      if (!scope.ok) {
        sendError(res, createError(scope.code, scope.message, {}, false, statusFor(scope)), context.requestId, context.receivedAt);
        return;
      }
    }
    const branchIds = isCompanyScope(context.requestContext)
      ? null
      : [...(context.requestContext.scopes.branchIds ?? [])];
    if (!employeeId && Array.isArray(branchIds) && branchIds.length === 0) {
      sendSuccess(res, [], context.requestId, context.receivedAt);
      return;
    }
    const result = await workforceService.listWorkSchedules(context.getPool(), {
      installationId: context.requestContext.installationId,
      employeeId,
      dateFrom,
      dateTo,
      branchIds,
    });
    if (!result.ok) {
      sendError(res, createError(result.code, result.message, {}, false, statusFor(result)), context.requestId, context.receivedAt);
      return;
    }
    sendSuccess(res, result.schedules, context.requestId, context.receivedAt);
    return;
  }

  const parsed = await parsePayload(req, res, context);
  if (!parsed.ok) return;
  const payload = parsed.payload;
  await runIdempotentMutation(req, res, context, {
    route: '/api/workforce/schedules',
    payload,
    mutate: async (client) => {
      const scope = await requireEmployeeScope(client, context.requestContext, String(payload?.employeeId ?? ''));
      if (!scope.ok) return scope;
      const result = await workforceService.upsertWorkSchedule(client, {
        installationId: context.requestContext.installationId,
        payload,
        actorId: context.requestContext.actorId,
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: result.schedule,
        audit: {
          requestContext: context.requestContext,
          action: result.action,
          resourceType: 'work-schedule',
          resourceId: result.schedule.id,
          beforeData: result.beforeSchedule,
          afterData: result.schedule,
          metadata: { employeeId: result.employee.id, workDate: result.schedule.work_date },
        },
      };
    },
  });
}

export async function handleWorkforceRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  if (!pathname.startsWith('/api/workforce/')) return false;
  const route = pathname.slice('/api/workforce'.length);
  if (!['/policies', '/assignments', '/schedules'].includes(route)) return false;

  const auth = options.authenticate(req, options.config);
  if (!auth.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, createError('UNAUTHORIZED', 'Cần đăng nhập', {}, false, 401), options.requestId, options.receivedAt);
    return true;
  }
  const requestContext = options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  const method = String(req.method || 'GET').toUpperCase();
  if (!['GET', 'POST'].includes(method)) {
    sendError(res, createError('METHOD_NOT_ALLOWED', 'Thao tác không được hỗ trợ', {}, false, 405), options.requestId, options.receivedAt);
    return true;
  }

  const permissionKey = route === '/schedules'
    ? (method === 'GET' ? options.PERMISSIONS.coreWorkScheduleRead : options.PERMISSIONS.coreWorkScheduleManage)
    : (method === 'GET' ? options.PERMISSIONS.coreWorkPolicyRead : options.PERMISSIONS.coreWorkPolicyManage);
  const permission = options.authorize(requestContext, permissionKey);
  if (!permission.ok) {
    sendError(res, createError('FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này', {}, false, 403), options.requestId, options.receivedAt);
    return true;
  }

  const context = { ...options, requestContext };
  try {
    if (route === '/policies') await handlePolicies(req, res, context, method);
    else if (route === '/assignments') await handleAssignments(req, res, context, method);
    else await handleSchedules(req, res, context, method);
  } catch {
    sendError(res, createError('WORKFORCE_UNAVAILABLE', 'Dữ liệu nhân sự tạm thời chưa sẵn sàng', {}, true, 503), options.requestId, options.receivedAt);
  }
  return true;
}
