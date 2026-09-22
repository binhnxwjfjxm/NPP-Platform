import { createSuccessEnvelope } from '@npp/contracts';
import { readJsonBody, normalizeIdempotencyKey } from '../idempotency.js';
import { sendJson, sendSuccess, sendError } from '../http-utils.js';
import { buildAuditRecord, insertAuditRecord, withAuditOutboxTransaction } from '../audit-outbox.js';
import * as faceService from '../services/workforce-face.js';
import * as workforceService from '../services/workforce.js';

const ROUTES = new Set([
  '/api/workforce/face/templates',
  '/api/workforce/face/devices',
  '/api/workforce/face/device',
  '/api/workforce/face/recognize',
  '/api/workforce/face/attendance',
]);

function createError(code, message, details = {}, retryable = false, statusCode = 500) {
  return { code, message, details, retryable, statusCode };
}

function statusFor(result) {
  if (Number.isInteger(result?.statusCode)) return result.statusCode;
  if (['EMPLOYEE_NOT_FOUND', 'ATTENDANCE_POINT_NOT_FOUND'].includes(result?.code)) return 404;
  if (['FACE_DEVICE_UNAUTHORIZED'].includes(result?.code)) return 401;
  if (['SCOPE_FORBIDDEN', 'FORBIDDEN'].includes(result?.code)) return 403;
  if (['FACE_NOT_RECOGNIZED', 'FACE_MATCH_AMBIGUOUS', 'FACE_TEMPLATE_INVALID'].includes(result?.code)) return 422;
  if (['ATTENDANCE_ALREADY_COMPLETE', 'ATTENDANCE_TOO_SOON', 'ATTENDANCE_DUPLICATE_SCAN'].includes(result?.code)) return 409;
  return 400;
}

function failureResponse(result, options) {
  return {
    statusCode: statusFor(result),
    contentType: 'application/json',
    requestId: options.requestId,
    body: {
      error: {
        code: result.code,
        message: result.message,
        retryable: Boolean(result.retryable),
        details: {},
      },
      requestId: options.requestId,
      receivedAt: options.receivedAt,
    },
  };
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

async function payloadOrError(req, res, options) {
  try {
    return { ok: true, payload: await readJsonBody(req) };
  } catch (error) {
    sendError(
      res,
      createError(error.code, error.publicMessage, {}, false, error.statusCode ?? 400),
      options.requestId,
      options.receivedAt,
    );
    return { ok: false, payload: null };
  }
}

function companyScope(requestContext) {
  return requestContext.scopeAuthority === 'COMPANY';
}

function adminContext(req, res, options, permission) {
  const auth = options.authenticate(req, options.config);
  if (!auth?.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, createError('UNAUTHORIZED', 'Cần đăng nhập', {}, false, 401), options.requestId, options.receivedAt);
    return null;
  }
  const requestContext = options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
  if (!options.authorize(requestContext, permission).ok) {
    sendError(res, createError('FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này', {}, false, 403), options.requestId, options.receivedAt);
    return null;
  }
  return requestContext;
}

function faceDeviceToken(req) {
  const value = req.headers['x-npp-face-device-token'];
  return Array.isArray(value) ? value[0] : value;
}

function deviceRequestContext(options, device) {
  return options.createContext({
    config: options.config,
    principal: {
      actorId: `face-device:${device.id}`,
      employeeId: null,
      roles: ['attendance-face-device'],
      permissions: [],
      scopes: { branchIds: [String(device.branch_id)] },
      scopeAuthority: 'ASSIGNED',
      sourceApp: 'attendance-android',
    },
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
}

async function authenticatedDevice(req, res, options) {
  const result = await faceService.authenticateFaceDevice(options.getPool(), {
    installationId: options.config.installationId,
    credential: faceDeviceToken(req),
  });
  if (!result.ok) {
    sendError(
      res,
      createError(result.code, result.message, {}, Boolean(result.retryable), statusFor(result)),
      options.requestId,
      options.receivedAt,
    );
    return null;
  }
  return result.device;
}

async function runMutation(req, res, options, {
  requestContext,
  route,
  payload,
  successStatus = 200,
  mutate,
}) {
  const key = requireIdempotencyKey(req);
  if (!key.ok) {
    sendError(res, createError(key.code, key.message, {}, false, 400), options.requestId, options.receivedAt);
    return;
  }
  try {
    const execution = await options.executeRequestWithIdempotency({
      idempotencyStore: options.idempotencyStore,
      req,
      requestContext,
      requestId: options.requestId,
      receivedAt: options.receivedAt,
      route,
      payload,
      onProcess: async () => {
        const result = await withAuditOutboxTransaction({
          adapter: options.getPool(),
          mutate: async (client) => {
            const mutation = await mutate(client);
            if (!mutation.ok) return { mutation, skipAudit: true };
            if (mutation.audit) {
              await insertAuditRecord(client, buildAuditRecord(mutation.audit));
            }
            return mutation;
          },
        });
        if (result.skipAudit) return failureResponse(result.mutation, options);
        return {
          statusCode: successStatus,
          contentType: 'application/json',
          requestId: options.requestId,
          body: createSuccessEnvelope(result.data, options.requestId, options.receivedAt),
        };
      },
    });
    res.setHeader('Cache-Control', 'no-store');
    sendJson(
      res,
      execution.response.statusCode,
      execution.response.body,
      execution.response.requestId ?? options.requestId,
      execution.response.contentType,
    );
  } catch {
    sendError(
      res,
      createError('FACE_SERVICE_UNAVAILABLE', 'Dịch vụ nhận diện khuôn mặt tạm thời chưa sẵn sàng', {}, true, 503),
      options.requestId,
      options.receivedAt,
    );
  }
}

async function handleTemplates(req, res, options, method) {
  const permission = method === 'GET'
    ? options.PERMISSIONS.coreEmployeeRead
    : options.PERMISSIONS.coreEmployeeWrite;
  const requestContext = adminContext(req, res, options, permission);
  if (!requestContext) return;

  if (method === 'GET') {
    const url = new URL(req.url, 'http://localhost');
    const result = await faceService.listFaceTemplateStatus(options.getPool(), {
      installationId: requestContext.installationId,
      employeeId: url.searchParams.get('employeeId')?.trim() || null,
      branchIds: [...(requestContext.scopes.branchIds ?? [])],
      companyScope: companyScope(requestContext),
    });
    if (!result.ok) {
      sendError(res, createError(result.code, result.message, {}, false, statusFor(result)), options.requestId, options.receivedAt);
      return;
    }
    sendSuccess(res, { templates: result.templates }, options.requestId, options.receivedAt);
    return;
  }

  const parsed = await payloadOrError(req, res, options);
  if (!parsed.ok) return;
  await runMutation(req, res, options, {
    requestContext,
    route: '/api/workforce/face/templates',
    payload: parsed.payload,
    successStatus: 201,
    mutate: async (client) => {
      const result = await faceService.enrollFaceTemplate(client, {
        installationId: requestContext.installationId,
        payload: parsed.payload,
        actorId: requestContext.actorId,
        branchIds: [...(requestContext.scopes.branchIds ?? [])],
        companyScope: companyScope(requestContext),
        env: options.env ?? process.env,
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: { template: result.template },
        audit: {
          requestContext,
          action: result.before ? 'replace-face-template' : 'enroll-face-template',
          resourceType: 'employee-face-template',
          resourceId: result.template.id,
          beforeData: result.before,
          afterData: result.template,
          metadata: {
            employeeId: result.template.employeeId,
            modelCode: result.template.modelCode,
            version: result.template.version,
          },
        },
      };
    },
  });
}

async function handleDevices(req, res, options) {
  const requestContext = adminContext(req, res, options, options.PERMISSIONS.coreAttendancePointManage);
  if (!requestContext) return;
  const parsed = await payloadOrError(req, res, options);
  if (!parsed.ok) return;
  await runMutation(req, res, options, {
    requestContext,
    route: '/api/workforce/face/devices',
    payload: parsed.payload,
    successStatus: 201,
    mutate: async (client) => {
      const result = await faceService.provisionFaceDevice(client, {
        installationId: requestContext.installationId,
        payload: parsed.payload,
        actorId: requestContext.actorId,
        branchIds: [...(requestContext.scopes.branchIds ?? [])],
        companyScope: companyScope(requestContext),
      });
      if (!result.ok) return result;
      const publicDevice = {
        id: result.device.id,
        name: result.device.name,
        branchId: result.device.branch_id,
        branchName: result.device.branch_name,
        attendancePointId: result.device.attendance_point_id,
        attendancePointName: result.device.branch_name ?? result.device.point_name,
      };
      return {
        ok: true,
        data: { device: publicDevice, credential: result.credential },
        audit: {
          requestContext,
          action: 'provision-face-device',
          resourceType: 'attendance-face-device',
          resourceId: result.device.id,
          beforeData: null,
          afterData: publicDevice,
          metadata: {
            branchId: result.device.branch_id,
            attendancePointId: result.device.attendance_point_id,
          },
        },
      };
    },
  });
}

async function handleDeviceInfo(req, res, options) {
  const device = await authenticatedDevice(req, res, options);
  if (!device) return;
  sendSuccess(res, {
    id: device.id,
    name: device.name,
    branchId: device.branch_id,
    branchName: device.branch_name,
    attendancePointId: device.attendance_point_id,
    attendancePointName: device.branch_name ?? device.point_name,
  }, options.requestId, options.receivedAt);
}

async function handleRecognize(req, res, options) {
  const device = await authenticatedDevice(req, res, options);
  if (!device) return;
  const parsed = await payloadOrError(req, res, options);
  if (!parsed.ok) return;
  const result = await faceService.recognizeFace(options.getPool(), {
    installationId: options.config.installationId,
    device,
    embedding: parsed.payload?.embedding,
    modelCode: parsed.payload?.modelCode,
    env: options.env ?? process.env,
  });
  if (!result.ok) {
    sendError(res, createError(result.code, result.message, {}, Boolean(result.retryable), statusFor(result)), options.requestId, options.receivedAt);
    return;
  }
  sendSuccess(res, { employee: result.match }, options.requestId, options.receivedAt);
}

async function handleAttendance(req, res, options) {
  const device = await authenticatedDevice(req, res, options);
  if (!device) return;
  const parsed = await payloadOrError(req, res, options);
  if (!parsed.ok) return;
  const requestContext = deviceRequestContext(options, device);

  await runMutation(req, res, options, {
    requestContext,
    route: '/api/workforce/face/attendance',
    payload: parsed.payload,
    successStatus: 201,
    mutate: async (client) => {
      const recognized = await faceService.recognizeFace(client, {
        installationId: requestContext.installationId,
        device,
        embedding: parsed.payload?.embedding,
        modelCode: parsed.payload?.modelCode,
        env: options.env ?? process.env,
      });
      if (!recognized.ok) return recognized;
      const result = await workforceService.recordFaceAttendance(client, {
        installationId: requestContext.installationId,
        employeeId: recognized.match.employeeId,
        payload: parsed.payload,
        actorId: requestContext.actorId,
        requestId: requestContext.requestId,
        device,
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: {
          employee: recognized.match,
          event: result.event,
          workDate: result.workDate,
          point: result.point,
        },
        audit: {
          requestContext,
          action: result.event.event_type === 'CHECK_IN'
            ? 'check-in'
            : result.event.event_type === 'TEMP_EXIT'
              ? 'temporary-exit'
              : result.event.event_type === 'RETURN'
                ? 'return-to-work'
                : 'check-out',
          resourceType: 'attendance-event',
          resourceId: result.event.id,
          beforeData: null,
          afterData: result.event,
          metadata: {
            employeeId: recognized.match.employeeId,
            workDate: result.workDate,
            attendancePointId: device.attendance_point_id,
            eventType: result.event.event_type,
            movementReason: result.event.movement_reason ?? null,
            source: 'FACE',
            deviceId: device.id,
          },
        },
      };
    },
  });
}

export async function handleWorkforceFaceRoutes(req, res, options) {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (!ROUTES.has(pathname)) return false;

  const method = String(req.method || 'GET').toUpperCase();
  const allowed = (
    (pathname === '/api/workforce/face/templates' && ['GET', 'POST'].includes(method))
    || (pathname === '/api/workforce/face/devices' && method === 'POST')
    || (pathname === '/api/workforce/face/device' && method === 'GET')
    || (pathname === '/api/workforce/face/recognize' && method === 'POST')
    || (pathname === '/api/workforce/face/attendance' && method === 'POST')
  );
  if (!allowed) {
    sendError(res, createError('METHOD_NOT_ALLOWED', 'Thao tác không được hỗ trợ', {}, false, 405), options.requestId, options.receivedAt);
    return true;
  }

  try {
    if (pathname === '/api/workforce/face/templates') await handleTemplates(req, res, options, method);
    else if (pathname === '/api/workforce/face/devices') await handleDevices(req, res, options);
    else if (pathname === '/api/workforce/face/device') await handleDeviceInfo(req, res, options);
    else if (pathname === '/api/workforce/face/recognize') await handleRecognize(req, res, options);
    else await handleAttendance(req, res, options);
  } catch {
    sendError(
      res,
      createError('FACE_SERVICE_UNAVAILABLE', 'Dịch vụ nhận diện khuôn mặt tạm thời chưa sẵn sàng', {}, true, 503),
      options.requestId,
      options.receivedAt,
    );
  }
  return true;
}
