import { createSuccessEnvelope } from '@npp/contracts';
import { sendJson, sendSuccess, sendError } from '../http-utils.js';
import { readJsonBody, normalizeIdempotencyKey } from '../idempotency.js';
import { buildAuditRecord, insertAuditRecord, withAuditOutboxTransaction } from '../audit-outbox.js';
import * as workforceService from '../services/workforce.js';
import * as workforcePlanningService from '../services/workforce-planning.js';
import * as attendanceTimesheetService from '../services/attendance-timesheet.js';
import * as attendanceAdjustmentService from '../services/attendance-adjustments.js';
import * as leaveManagementService from '../services/leave-management.js';
import * as attendanceViolationService from '../services/attendance-violations.js';

function createError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(result) {
  if (['EMPLOYEE_NOT_FOUND', 'POLICY_NOT_FOUND', 'SHIFT_TEMPLATE_NOT_FOUND', 'WEEK_TEMPLATE_NOT_FOUND', 'ATTENDANCE_POINT_NOT_FOUND', 'BRANCH_NOT_FOUND', 'ADJUSTMENT_REQUEST_NOT_FOUND', 'LEAVE_TYPE_NOT_FOUND', 'LEAVE_REQUEST_NOT_FOUND', 'VIOLATION_CASE_NOT_FOUND', 'ATTENDANCE_DAY_NOT_FOUND'].includes(result.code)) return 404;
  if (result.code === 'QR_TOKEN_EXPIRED') return 410;
  if (result.code === 'SCOPE_FORBIDDEN') return 403;
  if ([
    'POLICY_CODE_EXISTS', 'POLICY_VERSION_CONFLICT', 'POLICY_EFFECTIVE_DATE_CONFLICT',
    'SHIFT_TEMPLATE_CODE_EXISTS', 'WEEK_TEMPLATE_CODE_EXISTS',
    'ASSIGNMENT_EFFECTIVE_DATE_CONFLICT', 'BOOTSTRAP_ASSIGNMENT_EXISTS', 'SCHEDULE_CONFLICT', 'ATTENDANCE_POINT_CODE_EXISTS',
    'ATTENDANCE_ALREADY_COMPLETE', 'ATTENDANCE_TOO_SOON', 'ATTENDANCE_DUPLICATE_SCAN',
    'ATTENDANCE_PERIOD_LOCKED', 'ATTENDANCE_ADJUSTMENT_PENDING',
    'ADJUSTMENT_REQUEST_CONFLICT', 'ATTENDANCE_PERIOD_LOCK_OVERLAP',
    'LEAVE_TYPE_CODE_EXISTS', 'LEAVE_TYPE_CONFLICT', 'LEAVE_REQUEST_OVERLAP', 'LEAVE_REQUEST_CONFLICT',
    'LEAVE_BALANCE_INSUFFICIENT', 'LEAVE_BALANCE_LEDGER_MISSING', 'LEAVE_NO_SCHEDULED_WORKDAYS', 'EMPLOYEE_NOT_EMPLOYED_ON_LEAVE_DATE',
    'VIOLATION_CASE_EXISTS', 'VIOLATION_CASE_CONFLICT', 'VIOLATION_CHANGED',
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

async function handleAssignmentCoverage(req, res, context) {
  const url = new URL(`http://localhost${req.url}`);
  const workDate = String(url.searchParams.get('date') ?? '').trim();
  const branchId = String(url.searchParams.get('branchId') ?? '').trim() || null;
  const branchIds = isCompanyScope(context.requestContext)
    ? null
    : [...(context.requestContext.scopes.branchIds ?? [])];
  if (branchId && Array.isArray(branchIds) && !branchIds.includes(branchId)) {
    sendError(res, createError('SCOPE_FORBIDDEN', 'Chi nhánh nằm ngoài phạm vi được cấp', {}, false, 403), context.requestId, context.receivedAt);
    return;
  }
  const result = await workforceService.listWorkPolicyCoverage(context.getPool(), {
    installationId: context.requestContext.installationId,
    workDate,
    branchId,
    branchIds,
  });
  if (!result.ok) {
    sendError(res, createError(result.code, result.message, {}, false, statusFor(result)), context.requestId, context.receivedAt);
    return;
  }
  sendSuccess(res, result.coverage, context.requestId, context.receivedAt);
}

async function handleBulkAssignments(req, res, context) {
  const parsed = await parsePayload(req, res, context);
  if (!parsed.ok) return;
  const payload = parsed.payload;
  await runIdempotentMutation(req, res, context, {
    route: '/api/workforce/assignments/bulk',
    payload,
    successStatus: 201,
    mutate: async (client) => {
      const branchIds = isCompanyScope(context.requestContext)
        ? null
        : [...(context.requestContext.scopes.branchIds ?? [])];
      const result = await workforceService.assignWorkPolicyBulk(client, {
        installationId: context.requestContext.installationId,
        payload,
        actorId: context.requestContext.actorId,
        branchIds,
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: {
          affectedCount: result.affectedCount,
          bootstrap: result.bootstrap,
          targetMode: result.targetMode,
          workPolicyId: result.workPolicyId,
          effectiveFrom: result.effectiveFrom,
        },
        audit: {
          requestContext: context.requestContext,
          action: result.bootstrap ? 'bootstrap-bulk-assign' : 'bulk-assign',
          resourceType: 'employee-work-policy-bulk',
          resourceId: result.workPolicyId,
          beforeData: null,
          afterData: {
            affectedCount: result.affectedCount,
            targetMode: result.targetMode,
            workPolicyId: result.workPolicyId,
            effectiveFrom: result.effectiveFrom,
            bootstrap: result.bootstrap,
          },
          metadata: {
            affectedCount: result.affectedCount,
            targetMode: result.targetMode,
            effectiveFrom: result.effectiveFrom,
            reason: result.reason,
          },
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


async function handleSchedulePlanning(req, res, context, method) {
  if (method === 'GET') {
    const result = await workforcePlanningService.getSchedulePlanningCatalog(context.getPool(), {
      installationId: context.requestContext.installationId,
    });
    if (!result.ok) {
      sendError(res, createError(result.code, result.message, {}, false, statusFor(result)), context.requestId, context.receivedAt);
      return;
    }
    sendSuccess(res, result.data, context.requestId, context.receivedAt);
    return;
  }

  const parsed = await parsePayload(req, res, context);
  if (!parsed.ok) return;
  const payload = parsed.payload;
  const branchIds = isCompanyScope(context.requestContext)
    ? null
    : [...(context.requestContext.scopes.branchIds ?? [])];

  await runIdempotentMutation(req, res, context, {
    route: '/api/workforce/schedule-planning',
    payload,
    mutate: async (client) => {
      const result = await workforcePlanningService.mutateSchedulePlanning(client, {
        installationId: context.requestContext.installationId,
        payload,
        actorId: context.requestContext.actorId,
        branchIds,
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: result.data,
        audit: {
          requestContext: context.requestContext,
          ...result.audit,
        },
      };
    },
  });
}


async function handleAttendanceTimesheet(req, res, context, { selfOnly, capabilities }) {
  const url = new URL(`http://localhost${req.url}`);
  const requestedEmployeeId = String(url.searchParams.get('employeeId') ?? '').trim() || null;
  const requestedBranchId = String(url.searchParams.get('branchId') ?? '').trim() || null;
  let employeeId = requestedEmployeeId;
  let branchIds = null;
  let branchOptionIds = null;

  if (selfOnly) {
    const ownEmployeeId = String(context.requestContext.employeeId ?? '').trim();
    if (!ownEmployeeId) {
      sendError(res, createError('EMPLOYEE_ID_REQUIRED', 'Tài khoản chưa liên kết hồ sơ nhân sự', {}, false, 400), context.requestId, context.receivedAt);
      return;
    }
    if (requestedEmployeeId && requestedEmployeeId !== ownEmployeeId) {
      sendError(res, createError('SCOPE_FORBIDDEN', 'Bạn chỉ có thể xem bảng công của chính mình', {}, false, 403), context.requestId, context.receivedAt);
      return;
    }
    const own = await workforceService.getEmployeeScopeRecord(context.getPool(), {
      installationId: context.requestContext.installationId,
      employeeId: ownEmployeeId,
    });
    if (!own.ok) {
      sendError(res, createError(own.code, own.message, {}, false, statusFor(own)), context.requestId, context.receivedAt);
      return;
    }
    employeeId = ownEmployeeId;
    branchOptionIds = own.employee.branch_id ? [String(own.employee.branch_id)] : [];
    if (requestedBranchId && !branchOptionIds.includes(requestedBranchId)) {
      sendError(res, createError('SCOPE_FORBIDDEN', 'Chi nhánh nằm ngoài phạm vi được cấp', {}, false, 403), context.requestId, context.receivedAt);
      return;
    }
  } else {
    // Historical Timesheet scope is enforced by effective-dated branch assignment inside the
    // Timesheet repository. Current shared.employees.branch_id must not authorize historical rows.
    branchIds = isCompanyScope(context.requestContext)
      ? null
      : [...(context.requestContext.scopes.branchIds ?? [])];
    branchOptionIds = branchIds;
    if (requestedBranchId && Array.isArray(branchIds) && !branchIds.includes(requestedBranchId)) {
      sendError(res, createError('SCOPE_FORBIDDEN', 'Chi nhánh nằm ngoài phạm vi được cấp', {}, false, 403), context.requestId, context.receivedAt);
      return;
    }
  }

  const result = await attendanceTimesheetService.listAttendanceTimesheet(context.getPool(), {
    installationId: context.requestContext.installationId,
    view: url.searchParams.get('view'),
    dateFrom: url.searchParams.get('from'),
    dateTo: url.searchParams.get('to'),
    employeeId,
    employeeQuery: url.searchParams.get('employeeQuery'),
    branchId: requestedBranchId,
    branchIds,
    branchOptionIds,
    companyScope: !selfOnly && isCompanyScope(context.requestContext),
    selfOnly,
    limit: url.searchParams.get('limit'),
    offset: url.searchParams.get('offset'),
  });
  if (!result.ok) {
    sendError(res, createError(result.code, result.message, {}, false, statusFor(result)), context.requestId, context.receivedAt);
    return;
  }
  sendSuccess(res, { ...result.timesheet, capabilities }, context.requestId, context.receivedAt);
}

async function handleAttendanceAdjustments(req, res, context, method, { selfOnly }) {
  if (method === 'GET') {
    const url = new URL(`http://localhost${req.url}`);
    const result = await attendanceAdjustmentService.listAdjustmentRequests(context.getPool(), {
      installationId: context.requestContext.installationId,
      selfOnly,
      ownEmployeeId: context.requestContext.employeeId,
      companyScope: isCompanyScope(context.requestContext),
      branchIds: [...(context.requestContext.scopes.branchIds ?? [])],
      rawEmployeeId: url.searchParams.get('employeeId'),
      rawEmployeeQuery: url.searchParams.get('employeeQuery'),
      rawBranchId: url.searchParams.get('branchId'),
      rawStatus: url.searchParams.get('status'),
      rawDateFrom: url.searchParams.get('from'),
      rawDateTo: url.searchParams.get('to'),
      rawLimit: url.searchParams.get('limit'),
      rawOffset: url.searchParams.get('offset'),
    });
    if (!result.ok) {
      sendError(res, createError(result.code, result.message, {}, false, statusFor(result)), context.requestId, context.receivedAt);
      return;
    }
    sendSuccess(res, {
      ...result.data,
      capabilities: {
        selfOnly,
        canSubmitOwn: context.canSubmitOwnAdjustment,
        canManage: context.canManageAdjustments,
        canLock: context.canLockPeriods,
      },
    }, context.requestId, context.receivedAt);
    return;
  }

  const parsed = await parsePayload(req, res, context);
  if (!parsed.ok) return;
  const payload = parsed.payload;
  await runIdempotentMutation(req, res, context, {
    route: '/api/workforce/attendance/adjustments',
    payload,
    successStatus: 201,
    mutate: async (client) => {
      const result = await attendanceAdjustmentService.submitSelfAdjustmentRequest(client, {
        requestContext: context.requestContext,
        payload,
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: result.request,
        audit: {
          requestContext: context.requestContext,
          action: 'submit-adjustment',
          resourceType: 'attendance-adjustment-request',
          resourceId: result.request.id,
          beforeData: null,
          afterData: result.request,
          metadata: { employeeId: result.request.employee_id, workDate: result.request.work_date },
        },
      };
    },
  });
}

async function handleAttendanceAdjustmentReview(req, res, context) {
  const parsed = await parsePayload(req, res, context);
  if (!parsed.ok) return;
  const payload = parsed.payload;
  await runIdempotentMutation(req, res, context, {
    route: '/api/workforce/attendance/adjustments/review',
    payload,
    mutate: async (client) => {
      const result = await attendanceAdjustmentService.reviewAdjustmentRequest(client, {
        requestContext: context.requestContext,
        payload,
        companyScope: isCompanyScope(context.requestContext),
        branchIds: [...(context.requestContext.scopes.branchIds ?? [])],
        allowLockedOverride: context.canLockPeriods,
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: { request: result.request, events: result.events },
        audit: {
          requestContext: context.requestContext,
          action: result.request.status === 'APPROVED' ? 'approve-adjustment' : 'reject-adjustment',
          resourceType: 'attendance-adjustment-request',
          resourceId: result.request.id,
          beforeData: { request: result.beforeRequest, events: result.beforeEvents },
          afterData: { request: result.request, events: result.events },
          metadata: {
            employeeId: result.request.employee_id,
            workDate: result.request.work_date,
            reviewReason: result.request.review_reason,
            lockedOverride: result.lockedOverride,
          },
        },
      };
    },
  });
}

async function handleAttendanceDirectAdjustment(req, res, context) {
  const parsed = await parsePayload(req, res, context);
  if (!parsed.ok) return;
  const payload = parsed.payload;
  await runIdempotentMutation(req, res, context, {
    route: '/api/workforce/attendance/adjustments/direct',
    payload,
    successStatus: 201,
    mutate: async (client) => {
      const result = await attendanceAdjustmentService.directAdjustment(client, {
        requestContext: context.requestContext,
        payload,
        companyScope: isCompanyScope(context.requestContext),
        branchIds: [...(context.requestContext.scopes.branchIds ?? [])],
        allowLockedOverride: context.canLockPeriods,
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: { request: result.request, events: result.events },
        audit: {
          requestContext: context.requestContext,
          action: 'direct-adjustment',
          resourceType: 'attendance-adjustment-request',
          resourceId: result.request.id,
          beforeData: { events: result.beforeEvents },
          afterData: { request: result.request, events: result.events },
          metadata: {
            employeeId: result.request.employee_id,
            workDate: result.request.work_date,
            reason: result.request.reason,
            lockedOverride: result.lockedOverride,
          },
        },
      };
    },
  });
}

async function handleAttendancePeriodLocks(req, res, context, method) {
  if (method === 'GET') {
    const url = new URL(`http://localhost${req.url}`);
    const result = await attendanceAdjustmentService.listPeriodLocks(context.getPool(), {
      installationId: context.requestContext.installationId,
      companyScope: isCompanyScope(context.requestContext),
      branchIds: [...(context.requestContext.scopes.branchIds ?? [])],
      rawBranchId: url.searchParams.get('branchId'),
      rawDateFrom: url.searchParams.get('from'),
      rawDateTo: url.searchParams.get('to'),
    });
    if (!result.ok) {
      sendError(res, createError(result.code, result.message, {}, false, statusFor(result)), context.requestId, context.receivedAt);
      return;
    }
    sendSuccess(res, { ...result.data, canLock: context.canLockPeriods }, context.requestId, context.receivedAt);
    return;
  }
  const parsed = await parsePayload(req, res, context);
  if (!parsed.ok) return;
  const payload = parsed.payload;
  await runIdempotentMutation(req, res, context, {
    route: '/api/workforce/attendance/period-locks',
    payload,
    successStatus: 201,
    mutate: async (client) => {
      const result = await attendanceAdjustmentService.createPeriodLock(client, {
        requestContext: context.requestContext,
        payload,
        companyScope: isCompanyScope(context.requestContext),
        branchIds: [...(context.requestContext.scopes.branchIds ?? [])],
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: result.lock,
        audit: {
          requestContext: context.requestContext,
          action: 'lock-period',
          resourceType: 'attendance-period-lock',
          resourceId: result.lock.id,
          beforeData: null,
          afterData: result.lock,
          metadata: {
            branchId: result.lock.branch_id,
            periodStart: result.lock.period_start,
            periodEnd: result.lock.period_end,
          },
        },
      };
    },
  });
}


async function handleLeaveTypes(req, res, context, method) {
  if (method === 'GET') {
    const result = await leaveManagementService.listLeaveTypes(context.getPool(), {
      installationId: context.requestContext.installationId,
      includeInactive: context.canManageLeaveTypes,
    });
    sendSuccess(res, {
      leaveTypes: result.leaveTypes,
      capabilities: { canManage: context.canManageLeaveTypes },
    }, context.requestId, context.receivedAt);
    return;
  }
  const parsed = await parsePayload(req, res, context);
  if (!parsed.ok) return;
  const payload = parsed.payload;
  await runIdempotentMutation(req, res, context, {
    route: '/api/workforce/leave-types',
    payload,
    successStatus: 201,
    mutate: async (client) => {
      const result = await leaveManagementService.createLeaveType(client, {
        installationId: context.requestContext.installationId,
        payload,
        actorId: context.requestContext.actorId,
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: result.leaveType,
        audit: {
          requestContext: context.requestContext,
          action: 'create-leave-type',
          resourceType: 'leave-type',
          resourceId: result.leaveType.id,
          beforeData: null,
          afterData: result.leaveType,
          metadata: { code: result.leaveType.code },
        },
      };
    },
  });
}

async function handleLeaveTypeUpdate(req, res, context, options = {}) {
  const parsed = await parsePayload(req, res, context);
  if (!parsed.ok) return;
  const payload = parsed.payload;
  const command = new URL('http://localhost' + req.url).searchParams.get('operation');
  const balanceEntry = options.balanceEntry ?? (command === 'balance-entry' || payload?.operation === 'balance-entry');
  await runIdempotentMutation(req, res, context, {
    route: balanceEntry ? '/api/workforce/leave/balances/entries' : '/api/workforce/leave-types/update',
    payload,
    successStatus: balanceEntry ? 201 : 200,
    mutate: async (client) => {
      if (balanceEntry) {
        const result = await leaveManagementService.postLeaveBalanceEntry(client, {
          requestContext: context.requestContext,
          payload,
          companyScope: isCompanyScope(context.requestContext),
          branchIds: [...(context.requestContext.scopes.branchIds ?? [])],
        });
        if (!result.ok) return result;
        return {
          ok: true,
          data: result.entry,
          audit: {
            requestContext: context.requestContext,
            action: 'post-leave-balance-entry',
            resourceType: 'leave-balance-entry',
            resourceId: result.entry.id,
            beforeData: null,
            afterData: result.entry,
            metadata: {
              employeeId: result.entry.employee_id,
              leaveTypeId: result.entry.leave_type_id,
              entryType: result.entry.entry_type,
              effectiveDate: result.entry.effective_date,
            },
          },
        };
      }
      const result = await leaveManagementService.updateLeaveType(client, {
        installationId: context.requestContext.installationId,
        payload,
        actorId: context.requestContext.actorId,
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: result.leaveType,
        audit: {
          requestContext: context.requestContext,
          action: 'update-leave-type',
          resourceType: 'leave-type',
          resourceId: result.leaveType.id,
          beforeData: result.beforeLeaveType,
          afterData: result.leaveType,
          metadata: { code: result.leaveType.code, version: result.leaveType.version },
        },
      };
    },
  });
}

async function handleLeaveBalanceEntry(req, res, context) {
  const parsed = await parsePayload(req, res, context);
  if (!parsed.ok) return;
  const payload = parsed.payload;
  await runIdempotentMutation(req, res, context, {
    route: '/api/workforce/leave/balances/entries',
    payload,
    successStatus: 201,
    mutate: async (client) => {
      const result = await leaveManagementService.postLeaveBalanceEntry(client, {
        requestContext: context.requestContext,
        payload,
        companyScope: isCompanyScope(context.requestContext),
        branchIds: [...(context.requestContext.scopes.branchIds ?? [])],
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: result.entry,
        audit: {
          requestContext: context.requestContext,
          action: 'post-leave-balance-entry',
          resourceType: 'leave-balance-entry',
          resourceId: result.entry.id,
          beforeData: null,
          afterData: result.entry,
          metadata: {
            employeeId: result.entry.employee_id,
            leaveTypeId: result.entry.leave_type_id,
            entryType: result.entry.entry_type,
            effectiveDate: result.entry.effective_date,
          },
        },
      };
    },
  });
}

async function handleLeaveBalances(req, res, context, { selfOnly }) {
  const url = new URL('http://localhost' + req.url);
  const result = await leaveManagementService.listLeaveBalances(context.getPool(), {
    installationId: context.requestContext.installationId,
    selfOnly,
    ownEmployeeId: context.requestContext.employeeId,
    companyScope: isCompanyScope(context.requestContext),
    branchIds: [...(context.requestContext.scopes.branchIds ?? [])],
    rawEmployeeId: url.searchParams.get('employeeId'),
    rawEmployeeQuery: url.searchParams.get('employeeQuery'),
    rawLeaveTypeId: url.searchParams.get('leaveTypeId'),
    rawAsOfDate: url.searchParams.get('asOfDate'),
  });
  if (!result.ok) {
    sendError(res, createError(result.code, result.message, {}, false, statusFor(result)), context.requestId, context.receivedAt);
    return;
  }
  sendSuccess(res, {
    ...result.data,
    capabilities: { selfOnly, canManage: context.canManageLeaveTypes },
  }, context.requestId, context.receivedAt);
}

async function handleLeaveRequests(req, res, context, method, { selfOnly }) {
  if (method === 'GET') {
    const url = new URL('http://localhost' + req.url);
    const result = await leaveManagementService.listLeaveRequests(context.getPool(), {
      installationId: context.requestContext.installationId,
      selfOnly,
      ownEmployeeId: context.requestContext.employeeId,
      companyScope: isCompanyScope(context.requestContext),
      branchIds: [...(context.requestContext.scopes.branchIds ?? [])],
      rawEmployeeId: url.searchParams.get('employeeId'),
      rawEmployeeQuery: url.searchParams.get('employeeQuery'),
      rawBranchId: url.searchParams.get('branchId'),
      rawStatus: url.searchParams.get('status'),
      rawDateFrom: url.searchParams.get('from'),
      rawDateTo: url.searchParams.get('to'),
      rawLimit: url.searchParams.get('limit'),
      rawOffset: url.searchParams.get('offset'),
    });
    if (!result.ok) {
      sendError(res, createError(result.code, result.message, {}, false, statusFor(result)), context.requestId, context.receivedAt);
      return;
    }
    sendSuccess(res, {
      ...result.data,
      capabilities: {
        selfOnly,
        canSubmitOwn: context.canSubmitOwnLeave,
        canApprove: context.canApproveLeaves,
        canManageTypes: context.canManageLeaveTypes,
      },
    }, context.requestId, context.receivedAt);
    return;
  }

  const parsed = await parsePayload(req, res, context);
  if (!parsed.ok) return;
  const payload = parsed.payload;
  await runIdempotentMutation(req, res, context, {
    route: '/api/workforce/leave/requests',
    payload,
    successStatus: 201,
    mutate: async (client) => {
      const result = await leaveManagementService.submitLeaveRequest(client, {
        requestContext: context.requestContext,
        payload,
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: result.request,
        audit: {
          requestContext: context.requestContext,
          action: 'submit-leave',
          resourceType: 'leave-request',
          resourceId: result.request.id,
          beforeData: null,
          afterData: result.request,
          metadata: {
            employeeId: result.request.employee_id,
            dateFrom: result.request.date_from,
            dateTo: result.request.date_to,
            dayPart: result.request.day_part,
            autoApproved: result.autoApproved,
          },
        },
      };
    },
  });
}

async function handleLeaveRequestReview(req, res, context) {
  const parsed = await parsePayload(req, res, context);
  if (!parsed.ok) return;
  const payload = parsed.payload;
  await runIdempotentMutation(req, res, context, {
    route: '/api/workforce/leave/requests/review',
    payload,
    mutate: async (client) => {
      const result = await leaveManagementService.reviewLeaveRequest(client, {
        requestContext: context.requestContext,
        payload,
        companyScope: isCompanyScope(context.requestContext),
        branchIds: [...(context.requestContext.scopes.branchIds ?? [])],
        allowLockedOverride: context.canLockPeriods,
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: result.request,
        audit: {
          requestContext: context.requestContext,
          action: result.request.status === 'APPROVED' ? 'approve-leave' : 'reject-leave',
          resourceType: 'leave-request',
          resourceId: result.request.id,
          beforeData: result.beforeRequest,
          afterData: result.request,
          metadata: {
            employeeId: result.request.employee_id,
            dateFrom: result.request.date_from,
            dateTo: result.request.date_to,
            reviewReason: result.request.review_reason,
            lockedOverride: result.lockedOverride,
          },
        },
      };
    },
  });
}

async function handleLeaveRequestCancel(req, res, context, { selfOnly }) {
  const parsed = await parsePayload(req, res, context);
  if (!parsed.ok) return;
  const payload = parsed.payload;
  await runIdempotentMutation(req, res, context, {
    route: '/api/workforce/leave/requests/cancel',
    payload,
    mutate: async (client) => {
      const result = await leaveManagementService.cancelLeaveRequest(client, {
        requestContext: context.requestContext,
        payload,
        selfOnly,
        companyScope: isCompanyScope(context.requestContext),
        branchIds: [...(context.requestContext.scopes.branchIds ?? [])],
        allowLockedOverride: context.canLockPeriods,
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: result.request,
        audit: {
          requestContext: context.requestContext,
          action: 'cancel-leave',
          resourceType: 'leave-request',
          resourceId: result.request.id,
          beforeData: result.beforeRequest,
          afterData: result.request,
          metadata: {
            employeeId: result.request.employee_id,
            dateFrom: result.request.date_from,
            dateTo: result.request.date_to,
            cancelReason: result.request.cancel_reason,
            lockedOverride: result.lockedOverride,
          },
        },
      };
    },
  });
}

async function handleAttendanceViolations(req, res, context, { selfOnly }) {
  const url = new URL(req.url, 'http://localhost');
  const result = await attendanceViolationService.listViolationHandling(context.getPool(), {
    installationId: context.requestContext.installationId,
    selfOnly,
    ownEmployeeId: context.requestContext.employeeId,
    companyScope: isCompanyScope(context.requestContext),
    branchIds: [...(context.requestContext.scopes.branchIds ?? [])],
    rawEmployeeId: url.searchParams.get('employeeId'),
    rawEmployeeQuery: url.searchParams.get('employeeQuery'),
    rawBranchId: url.searchParams.get('branchId'),
    rawDateFrom: url.searchParams.get('from'),
    rawDateTo: url.searchParams.get('to'),
    rawLimit: url.searchParams.get('limit'),
    rawOffset: url.searchParams.get('offset'),
  });
  if (!result.ok) {
    sendError(res, createError(result.code, result.message, {}, false, statusFor(result)), context.requestId, context.receivedAt);
    return;
  }
  sendSuccess(res, {
    ...result.data,
    capabilities: {
      selfOnly,
      canExplain: context.canExplainOwnViolation,
      canReview: context.canResolveViolations,
    },
  }, context.requestId, context.receivedAt);
}

async function handleViolationExplanation(req, res, context) {
  const parsed = await parsePayload(req, res, context);
  if (!parsed.ok) return;
  const payload = parsed.payload;
  await runIdempotentMutation(req, res, context, {
    route: '/api/workforce/attendance/violations/explain',
    payload,
    successStatus: 201,
    mutate: async (client) => {
      const result = await attendanceViolationService.submitViolationExplanation(client, {
        requestContext: context.requestContext,
        payload,
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: result.case,
        audit: {
          requestContext: context.requestContext,
          action: 'submit-explanation',
          resourceType: 'attendance-violation-case',
          resourceId: result.case.id,
          beforeData: null,
          afterData: result.case,
          metadata: {
            employeeId: result.case.employee_id,
            workDate: result.case.work_date,
            violationKind: result.case.violation_kind,
          },
        },
      };
    },
  });
}

async function handleViolationReview(req, res, context) {
  const parsed = await parsePayload(req, res, context);
  if (!parsed.ok) return;
  const payload = parsed.payload;
  await runIdempotentMutation(req, res, context, {
    route: '/api/workforce/attendance/violations/review',
    payload,
    mutate: async (client) => {
      const result = await attendanceViolationService.reviewViolationCase(client, {
        requestContext: context.requestContext,
        payload,
        companyScope: isCompanyScope(context.requestContext),
        branchIds: [...(context.requestContext.scopes.branchIds ?? [])],
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: result.case,
        audit: {
          requestContext: context.requestContext,
          action: result.case.status === 'RESOLVED' ? 'conclude-violation' : 'start-violation-review',
          resourceType: 'attendance-violation-case',
          resourceId: result.case.id,
          beforeData: result.beforeCase,
          afterData: result.case,
          metadata: {
            employeeId: result.case.employee_id,
            workDate: result.case.work_date,
            violationKind: result.case.violation_kind,
            outcome: result.case.outcome,
          },
        },
      };
    },
  });
}

async function requirePointScope(client, requestContext, pointId) {
  const point = await workforceService.listAttendancePointManagement(client, {
    installationId: requestContext.installationId,
    branchIds: isCompanyScope(requestContext) ? null : [...(requestContext.scopes.branchIds ?? [])],
  });
  if (!point.ok) return point;
  const matched = point.points.find((item) => item.id === pointId);
  return matched
    ? { ok: true, point: matched }
    : { ok: false, code: 'SCOPE_FORBIDDEN', message: 'Bạn không có quyền quản lý điểm chấm công này' };
}

async function handleAttendanceToday(req, res, context) {
  const result = await workforceService.getAttendanceToday(context.getPool(), {
    installationId: context.requestContext.installationId,
    employeeId: context.requestContext.employeeId,
  });
  if (!result.ok) {
    sendError(res, createError(result.code, result.message, {}, false, statusFor(result)), context.requestId, context.receivedAt);
    return;
  }
  sendSuccess(res, result.today, context.requestId, context.receivedAt);
}

async function handleAttendancePoints(req, res, context, method) {
  const branchIds = isCompanyScope(context.requestContext)
    ? null
    : [...(context.requestContext.scopes.branchIds ?? [])];
  if (method === 'GET') {
    const result = await workforceService.listAttendancePointManagement(context.getPool(), {
      installationId: context.requestContext.installationId,
      branchIds,
    });
    sendSuccess(res, {
      points: result.points,
      branches: result.branches,
      companyScope: isCompanyScope(context.requestContext),
    }, context.requestId, context.receivedAt);
    return;
  }

  const parsed = await parsePayload(req, res, context);
  if (!parsed.ok) return;
  const branchId = String(parsed.payload?.branchId ?? '').trim();
  if (!branchId) {
    sendError(res, createError('WORKPLACE_REQUIRED', 'Vui lòng chọn nơi làm việc', {}, false, 400), context.requestId, context.receivedAt);
    return;
  }
  if (!isCompanyScope(context.requestContext) && !new Set(branchIds).has(branchId)) {
    sendError(res, createError('SCOPE_FORBIDDEN', 'Bạn không có quyền thiết lập mã QR cho nơi làm việc này', {}, false, 403), context.requestId, context.receivedAt);
    return;
  }

  const mutationPayload = { branchId };
  await runIdempotentMutation(req, res, context, {
    route: '/api/workforce/attendance/points',
    payload: mutationPayload,
    successStatus: 201,
    mutate: async (client) => {
      const result = await workforceService.createAttendancePoint(client, {
        installationId: context.requestContext.installationId,
        payload: mutationPayload,
        actorId: context.requestContext.actorId,
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: result.point,
        audit: {
          requestContext: context.requestContext,
          action: result.reused ? 'reuse' : 'create',
          resourceType: 'attendance-point',
          resourceId: result.point.id,
          beforeData: null,
          afterData: result.point,
          metadata: { branchId: result.point.branch_id },
        },
      };
    },
  });
}

async function handleAttendanceQrToken(req, res, context) {
  const parsed = await parsePayload(req, res, context);
  if (!parsed.ok) return;
  const payload = parsed.payload;
  const pointId = String(payload?.attendancePointId ?? '').trim();
  const scope = await requirePointScope(context.getPool(), context.requestContext, pointId);
  if (!scope.ok) {
    sendError(res, createError(scope.code, scope.message, {}, false, statusFor(scope)), context.requestId, context.receivedAt);
    return;
  }
  await runIdempotentMutation(req, res, context, {
    route: '/api/workforce/attendance/qr-token',
    payload,
    successStatus: 201,
    mutate: async (client) => {
      const result = await workforceService.createAttendanceQrToken(client, {
        installationId: context.requestContext.installationId,
        attendancePointId: pointId,
        actorId: context.requestContext.actorId,
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: result.token,
        audit: {
          requestContext: context.requestContext,
          action: 'issue-qr',
          resourceType: 'attendance-qr-token',
          resourceId: result.auditToken.id,
          beforeData: null,
          afterData: result.auditToken,
          metadata: { attendancePointId: pointId, pointCode: result.point.code },
        },
      };
    },
  });
}

async function handleAttendanceRecord(req, res, context) {
  const parsed = await parsePayload(req, res, context);
  if (!parsed.ok) return;
  const payload = parsed.payload;
  await runIdempotentMutation(req, res, context, {
    route: '/api/workforce/attendance/record',
    payload,
    successStatus: 201,
    mutate: async (client) => {
      const result = await workforceService.recordAttendance(client, {
        installationId: context.requestContext.installationId,
        employeeId: context.requestContext.employeeId,
        payload,
        actorId: context.requestContext.actorId,
        requestId: context.requestId,
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: { event: result.event, workDate: result.workDate, point: result.point },
        audit: {
          requestContext: context.requestContext,
          action: result.event.event_type === 'CHECK_IN' ? 'check-in' : result.event.event_type === 'TEMP_EXIT' ? 'temporary-exit' : result.event.event_type === 'RETURN' ? 'return-to-work' : 'check-out',
          resourceType: 'attendance-event',
          resourceId: result.event.id,
          beforeData: null,
          afterData: result.event,
          metadata: {
            employeeId: context.requestContext.employeeId,
            workDate: result.workDate,
            attendancePointId: result.point?.id ?? null,
            eventType: result.event.event_type,
            movementReason: result.event.movement_reason ?? null,
          },
        },
      };
    },
  });
}

export async function handleWorkforceRoutes(req, res, options) {
  const pathname = new URL(`http://localhost${req.url}`).pathname;
  if (!pathname.startsWith('/api/workforce/')) return false;
  const route = pathname.slice('/api/workforce'.length);
  if (!['/policies', '/assignments', '/assignments/coverage', '/assignments/bulk', '/schedules', '/schedule-planning', '/attendance/today', '/attendance/timesheet', '/attendance/record', '/attendance/points', '/attendance/qr-token', '/attendance/adjustments', '/attendance/adjustments/review', '/attendance/adjustments/direct', '/attendance/period-locks', '/leave-types', '/leave-types/update', '/leave/requests', '/leave/requests/review', '/leave/requests/cancel', '/attendance/violations', '/attendance/violations/explain', '/attendance/violations/review'].includes(route)) return false;

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
  const routeAllowsMethod = (
    (route === '/attendance/today' && method === 'GET')
    || (route === '/attendance/timesheet' && method === 'GET')
    || (route === '/attendance/record' && method === 'POST')
    || (route === '/attendance/qr-token' && method === 'POST')
    || (route === '/attendance/points' && ['GET', 'POST'].includes(method))
    || (route === '/attendance/adjustments' && ['GET', 'POST'].includes(method))
    || (route === '/attendance/adjustments/review' && method === 'POST')
    || (route === '/attendance/adjustments/direct' && method === 'POST')
    || (route === '/attendance/period-locks' && ['GET', 'POST'].includes(method))
    || (route === '/attendance/violations' && method === 'GET')
    || (route === '/attendance/violations/explain' && method === 'POST')
    || (route === '/attendance/violations/review' && method === 'POST')
    || (route === '/leave-types' && ['GET', 'POST'].includes(method))
    || (route === '/leave-types/update' && method === 'POST')
    || (route === '/leave/requests' && ['GET', 'POST'].includes(method))
    || (route === '/leave/requests/review' && method === 'POST')
    || (route === '/leave/requests/cancel' && method === 'POST')
    || (['/policies', '/assignments', '/schedules', '/schedule-planning'].includes(route) && ['GET', 'POST'].includes(method))
    || (route === '/assignments/coverage' && method === 'GET')
    || (route === '/assignments/bulk' && method === 'POST')
  );
  if (!routeAllowsMethod) {
    sendError(res, createError('METHOD_NOT_ALLOWED', 'Thao tác không được hỗ trợ', {}, false, 405), options.requestId, options.receivedAt);
    return true;
  }

  const canManageAdjustments = options.authorize(requestContext, options.PERMISSIONS.coreAttendanceAdjust).ok;
  const canSubmitOwnAdjustment = options.authorize(requestContext, options.PERMISSIONS.coreAttendanceSelfAdjustRequest).ok;
  const canLockPeriods = options.authorize(requestContext, options.PERMISSIONS.coreAttendanceLock).ok;
  const canExplainOwnViolation = options.authorize(requestContext, options.PERMISSIONS.coreAttendanceViolationSelfExplain).ok;
  const canResolveViolations = options.authorize(requestContext, options.PERMISSIONS.coreAttendanceViolationResolve).ok;
  const canSelfReadLeaves = options.authorize(requestContext, options.PERMISSIONS.coreLeaveSelfRead).ok;
  const canSubmitOwnLeave = options.authorize(requestContext, options.PERMISSIONS.coreLeaveSelfRequest).ok;
  const canReadLeaves = options.authorize(requestContext, options.PERMISSIONS.coreLeaveRead).ok;
  const canApproveLeaves = options.authorize(requestContext, options.PERMISSIONS.coreLeaveApprove).ok;
  const canManageLeaveTypes = options.authorize(requestContext, options.PERMISSIONS.coreLeaveTypeManage).ok;
  let timesheetSelfOnly = false;
  let adjustmentSelfOnly = false;
  let leaveRequestSelfOnly = false;
  let violationSelfOnly = false;
  let permission;
  if (route === '/attendance/timesheet') {
    permission = options.authorize(requestContext, options.PERMISSIONS.coreAttendanceRead);
    if (!permission.ok) {
      permission = options.authorize(requestContext, options.PERMISSIONS.coreAttendanceSelfRead);
      timesheetSelfOnly = permission.ok;
    }
  } else if (route === '/attendance/adjustments') {
    if (method === 'GET') {
      permission = canManageAdjustments ? { ok: true } : { ok: canSubmitOwnAdjustment };
      adjustmentSelfOnly = !canManageAdjustments && canSubmitOwnAdjustment;
    } else {
      permission = { ok: canSubmitOwnAdjustment };
      adjustmentSelfOnly = true;
    }
  } else if (route === '/attendance/adjustments/review' || route === '/attendance/adjustments/direct') {
    permission = { ok: canManageAdjustments };
  } else if (route === '/attendance/period-locks') {
    permission = { ok: method === 'POST' ? canLockPeriods : (canManageAdjustments || canLockPeriods) };
  } else if (route === '/attendance/violations') {
    const canReadScopedViolations = options.authorize(requestContext, options.PERMISSIONS.coreAttendanceRead).ok || canResolveViolations;
    const canReadOwnViolations = options.authorize(requestContext, options.PERMISSIONS.coreAttendanceSelfRead).ok || canExplainOwnViolation;
    permission = { ok: canReadScopedViolations || canReadOwnViolations };
    violationSelfOnly = !canReadScopedViolations;
  } else if (route === '/attendance/violations/explain') {
    permission = { ok: canExplainOwnViolation };
    violationSelfOnly = true;
  } else if (route === '/attendance/violations/review') {
    permission = { ok: canResolveViolations };
  } else if (route === '/leave-types') {
    permission = { ok: method === 'POST'
      ? canManageLeaveTypes
      : (canManageLeaveTypes || canReadLeaves || canApproveLeaves || canSelfReadLeaves || canSubmitOwnLeave) };
  } else if (route === '/leave-types/update') {
    permission = { ok: canManageLeaveTypes };
  } else if (route === '/leave/requests') {
    if (method === 'POST') {
      permission = { ok: canSubmitOwnLeave };
      leaveRequestSelfOnly = true;
    } else {
      const canReadScopedLeaves = canReadLeaves || canApproveLeaves;
      permission = { ok: canReadScopedLeaves || canSelfReadLeaves || canSubmitOwnLeave };
      leaveRequestSelfOnly = !canReadScopedLeaves;
    }
  } else if (route === '/leave/requests/review') {
    permission = { ok: canApproveLeaves };
  } else if (route === '/leave/requests/cancel') {
    permission = { ok: canApproveLeaves || canSubmitOwnLeave };
    leaveRequestSelfOnly = !canApproveLeaves;
  } else {
    const permissionKey = route === '/schedules' || route === '/schedule-planning'
      ? (method === 'GET' ? options.PERMISSIONS.coreWorkScheduleRead : options.PERMISSIONS.coreWorkScheduleManage)
      : route === '/attendance/today'
        ? options.PERMISSIONS.coreAttendanceSelfRead
        : route === '/attendance/record'
          ? options.PERMISSIONS.coreAttendanceSelfRecord
          : route === '/attendance/points' || route === '/attendance/qr-token'
            ? options.PERMISSIONS.coreAttendancePointManage
            : (method === 'GET' ? options.PERMISSIONS.coreWorkPolicyRead : options.PERMISSIONS.coreWorkPolicyManage);
    permission = options.authorize(requestContext, permissionKey);
  }
  if (!permission.ok) {
    sendError(res, createError('FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này', {}, false, 403), options.requestId, options.receivedAt);
    return true;
  }

  const context = {
    ...options, requestContext, canManageAdjustments, canSubmitOwnAdjustment, canLockPeriods,
    canSelfReadLeaves, canSubmitOwnLeave, canReadLeaves, canApproveLeaves, canManageLeaveTypes,
    canExplainOwnViolation, canResolveViolations,
  };
  try {
    if (route === '/policies') await handlePolicies(req, res, context, method);
    else if (route === '/assignments') await handleAssignments(req, res, context, method);
    else if (route === '/assignments/coverage') await handleAssignmentCoverage(req, res, context);
    else if (route === '/assignments/bulk') await handleBulkAssignments(req, res, context);
    else if (route === '/schedules') await handleSchedules(req, res, context, method);
    else if (route === '/schedule-planning') await handleSchedulePlanning(req, res, context, method);
    else if (route === '/attendance/today') await handleAttendanceToday(req, res, context);
    else if (route === '/attendance/timesheet') await handleAttendanceTimesheet(req, res, context, {
      selfOnly: timesheetSelfOnly,
      capabilities: {
        canSubmitOwn: canSubmitOwnAdjustment,
        canManage: canManageAdjustments,
        canLock: canLockPeriods,
      },
    });
    else if (route === '/attendance/record') await handleAttendanceRecord(req, res, context);
    else if (route === '/attendance/points') await handleAttendancePoints(req, res, context, method);
    else if (route === '/attendance/adjustments') await handleAttendanceAdjustments(req, res, context, method, { selfOnly: adjustmentSelfOnly });
    else if (route === '/attendance/adjustments/review') await handleAttendanceAdjustmentReview(req, res, context);
    else if (route === '/attendance/adjustments/direct') await handleAttendanceDirectAdjustment(req, res, context);
    else if (route === '/attendance/period-locks') await handleAttendancePeriodLocks(req, res, context, method);
    else if (route === '/attendance/violations') await handleAttendanceViolations(req, res, context, { selfOnly: violationSelfOnly });
    else if (route === '/attendance/violations/explain') await handleViolationExplanation(req, res, context);
    else if (route === '/attendance/violations/review') await handleViolationReview(req, res, context);
    else if (route === '/leave-types') await handleLeaveTypes(req, res, context, method);
    else if (route === '/leave-types/update') await handleLeaveTypeUpdate(req, res, context);
    else if (route === '/leave/requests') await handleLeaveRequests(req, res, context, method, { selfOnly: leaveRequestSelfOnly });
    else if (route === '/leave/requests/review') await handleLeaveRequestReview(req, res, context);
    else if (route === '/leave/requests/cancel') await handleLeaveRequestCancel(req, res, context, { selfOnly: leaveRequestSelfOnly });
    else await handleAttendanceQrToken(req, res, context);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'workforce_route_failed',
      requestId: options.requestId,
      route,
      method,
      errorName: error?.name ?? null,
      errorCode: typeof error?.code === 'string' ? error.code : null,
    }));
    sendError(res, createError('WORKFORCE_UNAVAILABLE', 'Dữ liệu nhân sự tạm thời chưa sẵn sàng', {}, true, 503), options.requestId, options.receivedAt);
  }
  return true;
}
