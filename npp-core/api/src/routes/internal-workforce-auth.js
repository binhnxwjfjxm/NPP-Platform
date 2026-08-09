import { readJsonBody } from '../idempotency.js';
import { sendError, sendSuccess } from '../http-utils.js';
import { buildAuditRecord, insertAuditRecord, withAuditOutboxTransaction } from '../audit-outbox.js';
import {
  canManageSecurityOwners,
  reconcileSecurityOwners,
  replaceInternalUserScopes,
  revokeInternalSession,
  revokeInternalUserSessions,
  setInternalUserCredential,
} from '../internal-workforce-auth.js';

function createError(code, message, statusCode = 500, retryable = false, details = {}) {
  return { code, message, statusCode, retryable, details };
}

function publicMessage(code) {
  switch (code) {
    case 'INTERNAL_AUTH_INVALID_CREDENTIALS':
      return 'Tên đăng nhập hoặc mật khẩu không đúng';
    case 'INTERNAL_AUTH_OWNER_CODE_INVALID':
      return 'Mã xác minh không đúng';
    case 'INTERNAL_AUTH_OWNER_CHALLENGE_UNAVAILABLE':
      return 'Xác minh truy cập web chưa sẵn sàng';
    case 'INTERNAL_AUTH_SESSION_EXPIRED':
      return 'Phiên đăng nhập đã hết hạn';
    case 'INTERNAL_AUTH_SESSION_REVOKED':
    case 'INTERNAL_AUTH_SESSION_INVALID':
      return 'Phiên đăng nhập không còn hiệu lực';
    case 'INTERNAL_AUTH_PASSWORD_INVALID':
      return 'Mật khẩu phải có từ 10 đến 256 ký tự';
    case 'USER_NOT_FOUND':
      return 'Người dùng không tồn tại hoặc không hoạt động';
    case 'INVALID_SCOPE':
      return 'Phạm vi được cấp không hợp lệ';
    case 'SCOPE_OUTSIDE_INSTALLATION':
      return 'Phạm vi được cấp không thuộc installation hiện tại';
    case 'TERRITORY_SCOPE_NOT_CONFIGURED':
      return 'Phạm vi địa bàn chưa có registry canonical để cấp quyền';
    case 'SECURITY_OWNER_PROTECTED':
      return 'Security Owner chỉ được thay đổi bởi Security Owner hoặc bootstrap';
    case 'INVALID_SESSION_ID':
      return 'Phiên đăng nhập không hợp lệ';
    case 'SECURITY_OWNER_CONFIG_INCOMPLETE':
      return 'Cấu hình Security Owner chưa đầy đủ';
    case 'SECURITY_OWNER_USER_NOT_FOUND':
      return 'Chưa tìm thấy đủ tài khoản Security Owner canonical';
    case 'SECURITY_OWNER_IDENTITY_AMBIGUOUS':
      return 'Danh tính Security Owner chưa đủ duy nhất để liên kết';
    case 'SECURITY_OWNER_USER_INACTIVE':
      return 'Tài khoản Security Owner phải đang hoạt động';
    default:
      return 'Yêu cầu xác thực nội bộ thất bại';
  }
}

function sendServiceError(res, result, requestId, receivedAt) {
  sendError(
    res,
    createError(
      result.code || 'INTERNAL_AUTH_FAILED',
      publicMessage(result.code),
      result.statusCode || 400,
      result.statusCode === 503,
    ),
    requestId,
    receivedAt,
  );
}

async function bodyOrError(req, res, options) {
  try {
    return { ok: true, payload: await readJsonBody(req) };
  } catch (error) {
    sendError(
      res,
      createError(error.code, error.publicMessage, error.statusCode ?? 400, false),
      options.requestId,
      options.receivedAt,
    );
    return { ok: false, payload: null };
  }
}

function internalSessionContext(options) {
  const auth = options.internalAuthResult;
  if (!auth?.ok) return null;
  return options.createContext({
    config: options.config,
    principal: auth.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
}

function authenticatedContext(req, options) {
  const authResult = options.authenticate(req, options.config);
  if (!authResult?.ok) return null;
  return options.createContext({
    config: options.config,
    principal: authResult.principal,
    requestId: options.requestId,
    receivedAt: options.receivedAt,
  });
}

function requirePermission(options, requestContext, permission) {
  const result = options.authorize(requestContext, permission);
  return Boolean(result?.ok);
}

async function runAuditedMutation(options, requestContext, {
  action,
  resourceType,
  resourceId,
  mutate,
  auditAfter,
}) {
  return withAuditOutboxTransaction({
    adapter: options.getPool(),
    mutate: async (client) => {
      const result = await mutate(client);
      if (!result.ok) return { failed: true, result };
      await insertAuditRecord(client, buildAuditRecord({
        requestContext,
        action,
        resourceType,
        resourceId: resourceId ?? result.userId ?? null,
        afterData: auditAfter(result),
      }));
      return { result };
    },
  });
}

async function handleLogin(req, res, options) {
  if (String(req.method || '').toUpperCase() !== 'POST') {
    sendError(res, createError('METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ', 405), options.requestId, options.receivedAt);
    return;
  }
  const body = await bodyOrError(req, res, options);
  if (!body.ok) return;
  const payload = body.payload;
  try {
    const result = await options.internalAuth.login({
      ...payload,
      installationId: options.config.installationId,
      requestId: options.requestId,
    });
    if (!result.ok) {
      sendServiceError(res, result, options.requestId, options.receivedAt);
      return;
    }
    sendSuccess(res, {
      token: result.token,
      session: result.session,
      user: result.user,
    }, options.requestId, options.receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_AUTH_UNAVAILABLE', 'Xác thực nội bộ tạm thời không khả dụng', 503, true), options.requestId, options.receivedAt);
  }
}

async function handleMe(req, res, options) {
  if (String(req.method || '').toUpperCase() !== 'GET') {
    sendError(res, createError('METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ', 405), options.requestId, options.receivedAt);
    return;
  }
  const requestContext = internalSessionContext(options);
  if (!requestContext) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, createError('UNAUTHORIZED', 'Cần đăng nhập', 401), options.requestId, options.receivedAt);
    return;
  }
  sendSuccess(res, {
    actorId: requestContext.actorId,
    employeeId: requestContext.employeeId,
    roles: requestContext.roles,
    permissions: requestContext.permissions,
    scopes: requestContext.scopes,
    sourceApp: requestContext.sourceApp,
    session: options.internalAuthResult.session,
  }, options.requestId, options.receivedAt);
}

async function handleLogout(req, res, options) {
  if (String(req.method || '').toUpperCase() !== 'POST') {
    sendError(res, createError('METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ', 405), options.requestId, options.receivedAt);
    return;
  }
  const requestContext = internalSessionContext(options);
  const auth = options.internalAuthResult;
  if (!requestContext || !auth?.session) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    sendError(res, createError('UNAUTHORIZED', 'Cần đăng nhập', 401), options.requestId, options.receivedAt);
    return;
  }
  try {
    const transaction = await runAuditedMutation(options, requestContext, {
      action: 'logout',
      resourceType: 'internal_session',
      resourceId: auth.session.id,
      mutate: (client) => revokeInternalSession(client, {
        installationId: requestContext.installationId,
        sessionId: auth.session.id,
        userId: auth.session.userId,
        actorId: requestContext.actorId,
      }),
      auditAfter: (result) => ({ revoked: result.revoked }),
    });
    if (transaction.failed) {
      sendServiceError(res, transaction.result, options.requestId, options.receivedAt);
      return;
    }
    sendSuccess(res, { loggedOut: true, revoked: transaction.result.revoked }, options.requestId, options.receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_AUTH_UNAVAILABLE', 'Không thể đăng xuất phiên hiện tại', 503, true), options.requestId, options.receivedAt);
  }
}

async function handleCredential(req, res, options, userId) {
  if (String(req.method || '').toUpperCase() !== 'PUT') {
    sendError(res, createError('METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ', 405), options.requestId, options.receivedAt);
    return;
  }
  const requestContext = authenticatedContext(req, options);
  if (!requestContext) {
    sendError(res, createError('UNAUTHORIZED', 'Cần xác thực', 401), options.requestId, options.receivedAt);
    return;
  }
  if (!requirePermission(options, requestContext, options.PERMISSIONS.coreUserWrite)) {
    sendError(res, createError('FORBIDDEN', 'Không có quyền cập nhật thông tin đăng nhập', 403), options.requestId, options.receivedAt);
    return;
  }
  const body = await bodyOrError(req, res, options);
  if (!body.ok) return;
  const payload = body.payload;
  try {
    const transaction = await runAuditedMutation(options, requestContext, {
      action: 'set_credential',
      resourceType: 'user',
      resourceId: userId,
      mutate: (client) => setInternalUserCredential(client, {
        installationId: requestContext.installationId,
        userId,
        password: payload?.password,
        actorId: requestContext.actorId,
        allowSecurityOwnerMutation: canManageSecurityOwners(requestContext),
      }),
      auditAfter: (result) => ({ credentialUpdated: true, revokedSessionCount: result.revokedSessionCount }),
    });
    if (transaction.failed) {
      sendServiceError(res, transaction.result, options.requestId, options.receivedAt);
      return;
    }
    sendSuccess(res, {
      userId,
      credentialUpdated: true,
      revokedSessionCount: transaction.result.revokedSessionCount,
    }, options.requestId, options.receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_AUTH_UNAVAILABLE', 'Không thể cập nhật thông tin đăng nhập', 503, true), options.requestId, options.receivedAt);
  }
}

async function handleScopes(req, res, options, userId) {
  if (String(req.method || '').toUpperCase() !== 'PUT') {
    sendError(res, createError('METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ', 405), options.requestId, options.receivedAt);
    return;
  }
  const requestContext = authenticatedContext(req, options);
  if (!requestContext) {
    sendError(res, createError('UNAUTHORIZED', 'Cần xác thực', 401), options.requestId, options.receivedAt);
    return;
  }
  if (!requirePermission(options, requestContext, options.PERMISSIONS.coreUserRoleWrite)) {
    sendError(res, createError('FORBIDDEN', 'Không có quyền cập nhật phạm vi', 403), options.requestId, options.receivedAt);
    return;
  }
  const body = await bodyOrError(req, res, options);
  if (!body.ok) return;
  const payload = body.payload;
  try {
    const transaction = await runAuditedMutation(options, requestContext, {
      action: 'replace_scopes',
      resourceType: 'user',
      resourceId: userId,
      mutate: (client) => replaceInternalUserScopes(client, {
        installationId: requestContext.installationId,
        userId,
        scopes: payload?.scopes,
        actorId: requestContext.actorId,
        allowSecurityOwnerMutation: canManageSecurityOwners(requestContext),
      }),
      auditAfter: (result) => ({ scopes: result.scopes }),
    });
    if (transaction.failed) {
      sendServiceError(res, transaction.result, options.requestId, options.receivedAt);
      return;
    }
    sendSuccess(res, { userId, scopes: transaction.result.scopes }, options.requestId, options.receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_AUTH_UNAVAILABLE', 'Không thể cập nhật phạm vi', 503, true), options.requestId, options.receivedAt);
  }
}

async function handleRevokeUser(req, res, options, userId) {
  if (String(req.method || '').toUpperCase() !== 'POST') {
    sendError(res, createError('METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ', 405), options.requestId, options.receivedAt);
    return;
  }
  const requestContext = authenticatedContext(req, options);
  if (!requestContext) {
    sendError(res, createError('UNAUTHORIZED', 'Cần xác thực', 401), options.requestId, options.receivedAt);
    return;
  }
  if (!requirePermission(options, requestContext, options.PERMISSIONS.coreUserWrite)) {
    sendError(res, createError('FORBIDDEN', 'Không có quyền thu hồi phiên', 403), options.requestId, options.receivedAt);
    return;
  }
  try {
    const transaction = await runAuditedMutation(options, requestContext, {
      action: 'revoke_sessions',
      resourceType: 'user',
      resourceId: userId,
      mutate: (client) => revokeInternalUserSessions(client, {
        installationId: requestContext.installationId,
        userId,
        actorId: requestContext.actorId,
        allowSecurityOwnerMutation: canManageSecurityOwners(requestContext),
      }),
      auditAfter: (result) => ({ revokedSessionCount: result.revokedSessionCount }),
    });
    if (transaction.failed) {
      sendServiceError(res, transaction.result, options.requestId, options.receivedAt);
      return;
    }
    sendSuccess(res, { userId, revokedSessionCount: transaction.result.revokedSessionCount }, options.requestId, options.receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_AUTH_UNAVAILABLE', 'Không thể thu hồi phiên', 503, true), options.requestId, options.receivedAt);
  }
}

async function handleOwnerReconcile(req, res, options) {
  if (String(req.method || '').toUpperCase() !== 'POST') {
    sendError(res, createError('METHOD_NOT_ALLOWED', 'Phương thức không được hỗ trợ', 405), options.requestId, options.receivedAt);
    return;
  }
  const requestContext = authenticatedContext(req, options);
  if (!requestContext) {
    sendError(res, createError('UNAUTHORIZED', 'Cần xác thực', 401), options.requestId, options.receivedAt);
    return;
  }
  if (!requirePermission(options, requestContext, options.PERMISSIONS.coreUserRoleWrite) || !canManageSecurityOwners(requestContext)) {
    sendError(res, createError('FORBIDDEN', 'Chỉ Security Owner hoặc bootstrap mới được đồng bộ Owner', 403), options.requestId, options.receivedAt);
    return;
  }
  try {
    const transaction = await runAuditedMutation(options, requestContext, {
      action: 'reconcile_security_owners',
      resourceType: 'security_owner_binding',
      resourceId: requestContext.installationId,
      mutate: (client) => reconcileSecurityOwners(client, {
        config: options.internalAuthConfig,
        installationId: requestContext.installationId,
        actorId: requestContext.actorId,
      }),
      auditAfter: (result) => ({
        permanentOwnerCount: result.permanentOwnerCount,
        temporaryOwnerCount: result.temporaryOwnerCount,
        previousBindingCount: result.previousBindingCount,
        bindingCount: result.bindingCount,
      }),
    });
    if (transaction.failed) {
      sendServiceError(res, transaction.result, options.requestId, options.receivedAt);
      return;
    }
    sendSuccess(res, {
      permanentOwnerCount: transaction.result.permanentOwnerCount,
      temporaryOwnerCount: transaction.result.temporaryOwnerCount,
      bindingCount: transaction.result.bindingCount,
    }, options.requestId, options.receivedAt);
  } catch {
    sendError(res, createError('INTERNAL_AUTH_UNAVAILABLE', 'Không thể đồng bộ Security Owner', 503, true), options.requestId, options.receivedAt);
  }
}

export async function handleInternalWorkforceAuthRoutes(req, res, options) {
  const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  if (!(pathname === '/api/internal-auth' || pathname.startsWith('/api/internal-auth/'))) return false;

  res.setHeader('Cache-Control', 'no-store');

  if (!options.internalAuthConfig?.enabled) {
    sendError(res, createError('INTERNAL_AUTH_NOT_CONFIGURED', 'Xác thực nội bộ chưa được bật', 503), options.requestId, options.receivedAt);
    return true;
  }

  if (pathname === '/api/internal-auth/login') {
    await handleLogin(req, res, options);
    return true;
  }
  if (pathname === '/api/internal-auth/me') {
    await handleMe(req, res, options);
    return true;
  }
  if (pathname === '/api/internal-auth/logout') {
    await handleLogout(req, res, options);
    return true;
  }
  if (pathname === '/api/internal-auth/security-owners/reconcile') {
    await handleOwnerReconcile(req, res, options);
    return true;
  }

  const credentialMatch = pathname.match(/^\/api\/internal-auth\/users\/([^/]+)\/credential$/);
  if (credentialMatch) {
    await handleCredential(req, res, options, credentialMatch[1]);
    return true;
  }
  const scopesMatch = pathname.match(/^\/api\/internal-auth\/users\/([^/]+)\/scopes$/);
  if (scopesMatch) {
    await handleScopes(req, res, options, scopesMatch[1]);
    return true;
  }
  const revokeMatch = pathname.match(/^\/api\/internal-auth\/users\/([^/]+)\/revoke$/);
  if (revokeMatch) {
    await handleRevokeUser(req, res, options, revokeMatch[1]);
    return true;
  }

  sendError(res, createError('NOT_FOUND', 'Route not found', 404), options.requestId, options.receivedAt);
  return true;
}
