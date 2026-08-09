import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { PERMISSION_REGISTRY } from './access/permissions.js';
import { buildAuditRecord, insertAuditRecord, withAuditOutboxTransaction } from './audit-outbox.js';
import * as defaultRepo from './db/repositories/internal-workforce-auth.js';

const scryptAsync = promisify(scrypt);
const SESSION_TOKEN_PREFIX = 'nppusr.';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOGIN_PATTERN = /^[a-z0-9._-]+$/;
const SOURCE_APP_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const PASSWORD_MIN_LENGTH = 10;
const PASSWORD_MAX_LENGTH = 256;
const MAX_USER_SCOPE_COUNT = 10_000;
const LOCK_THRESHOLD = 5;
const LOCK_SECONDS = 15 * 60;
const SCRYPT_KEY_LENGTH = 64;
const FAKE_SALT = Buffer.from('npp-phase-9-9-login-timing-salt');
const OWNER_ROLE = 'system:security-owner';
const IMPLEMENTATION_OWNER_ROLE = 'system:implementation-owner';

function text(value) {
  return String(value ?? '').trim();
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function authFailure(code = 'INTERNAL_AUTH_REQUIRED', statusCode = 401) {
  return Object.freeze({ ok: false, code, statusCode });
}

function normalizeLogin(value) {
  const loginName = text(value).toLowerCase();
  return LOGIN_PATTERN.test(loginName) && loginName.length <= 128 ? loginName : '';
}

function normalizeSourceApp(value) {
  const sourceApp = text(value).toLowerCase();
  return SOURCE_APP_PATTERN.test(sourceApp) ? sourceApp : 'internal-web';
}

function parseBearerToken(req) {
  const header = text(req?.headers?.authorization);
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || '';
}

function parseInternalSessionToken(token) {
  if (!token.startsWith(SESSION_TOKEN_PREFIX)) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'nppusr' || !UUID_PATTERN.test(parts[1])) return false;
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(parts[2])) return false;
  return Object.freeze({ sessionId: parts[1], tokenHash: sha256(token) });
}

function constantTimeTextMatch(left, right) {
  const a = Buffer.from(sha256(left), 'hex');
  const b = Buffer.from(sha256(right), 'hex');
  return timingSafeEqual(a, b);
}

function isFutureDate(value, referenceDate) {
  if (!value) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() > referenceDate.getTime();
}

async function derivePassword(password, salt) {
  return scryptAsync(password, salt, SCRYPT_KEY_LENGTH, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}

export async function hashInternalPassword(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw Object.assign(new Error('INTERNAL_AUTH_PASSWORD_INVALID'), {
      code: 'INTERNAL_AUTH_PASSWORD_INVALID',
      statusCode: 400,
    });
  }
  const salt = randomBytes(16);
  const derived = await derivePassword(password, salt);
  return `scrypt$v1$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
}

export async function verifyInternalPassword(password, storedHash) {
  if (typeof password !== 'string' || typeof storedHash !== 'string') return false;
  const parts = storedHash.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt' || parts[1] !== 'v1') return false;
  try {
    const salt = Buffer.from(parts[2], 'base64url');
    const expected = Buffer.from(parts[3], 'base64url');
    if (salt.length < 8 || expected.length !== SCRYPT_KEY_LENGTH) return false;
    const actual = Buffer.from(await derivePassword(password, salt));
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

async function fakePasswordWork(password) {
  const candidate = typeof password === 'string' ? password.slice(0, PASSWORD_MAX_LENGTH) : '';
  await derivePassword(candidate || 'invalid-password', FAKE_SALT);
}

function normalizeScopes(scopes = {}) {
  const normalize = (value) => [...new Set(
    (Array.isArray(value) ? value : [])
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => UUID_PATTERN.test(item)),
  )];
  return {
    branchIds: normalize(scopes.branchIds),
    warehouseIds: normalize(scopes.warehouseIds),
    territoryIds: normalize(scopes.territoryIds),
  };
}

function invalidScopePayload(scopes) {
  if (!scopes || typeof scopes !== 'object') return true;
  let totalScopeCount = 0;
  for (const key of ['branchIds', 'warehouseIds', 'territoryIds']) {
    const values = scopes[key] ?? [];
    if (!Array.isArray(values)) return true;
    totalScopeCount += values.length;
    if (totalScopeCount > MAX_USER_SCOPE_COUNT) return true;
    if (values.some((item) => typeof item !== 'string' || !UUID_PATTERN.test(item.trim()))) return true;
  }
  return false;
}

async function resolveAuthorization(repo, client, { installationId, userId }) {
  const authorization = await repo.loadUserAuthorization(client, { installationId, userId });
  const roles = [...new Set(authorization.roles ?? [])];
  const permissions = [...new Set(authorization.permissionKeys ?? [])]
    .filter((permission) => PERMISSION_REGISTRY.has(permission));
  const scopes = normalizeScopes(authorization.scopes);

  if (authorization.ownerKind === 'PERMANENT' || authorization.ownerKind === 'TEMPORARY') {
    roles.push(authorization.ownerKind === 'PERMANENT' ? OWNER_ROLE : IMPLEMENTATION_OWNER_ROLE);
    for (const permission of PERMISSION_REGISTRY) {
      if (!permissions.includes(permission)) permissions.push(permission);
    }
    const ownerScopes = await repo.loadInstallationOwnerScopes(client, { installationId });
    for (const branchId of ownerScopes.branchIds ?? []) {
      if (!scopes.branchIds.includes(String(branchId))) scopes.branchIds.push(String(branchId));
    }
    for (const warehouseId of ownerScopes.warehouseIds ?? []) {
      if (!scopes.warehouseIds.includes(String(warehouseId))) scopes.warehouseIds.push(String(warehouseId));
    }
  }

  return Object.freeze({
    roles: Object.freeze(roles),
    permissions: Object.freeze(permissions),
    scopes: Object.freeze({
      branchIds: Object.freeze(scopes.branchIds),
      warehouseIds: Object.freeze(scopes.warehouseIds),
      territoryIds: Object.freeze(scopes.territoryIds),
    }),
    ownerKind: authorization.ownerKind ?? null,
  });
}

function challengeResult(config, ownerCode) {
  if (!config.webOwnerChallengeRequired) return { ok: true };
  if (!config.allowFixedOwnerCode) {
    return { ok: false, code: 'INTERNAL_AUTH_OWNER_CHALLENGE_UNAVAILABLE', statusCode: 503 };
  }
  if (!constantTimeTextMatch(text(ownerCode), config.testCode)) {
    return { ok: false, code: 'INTERNAL_AUTH_OWNER_CODE_INVALID', statusCode: 401 };
  }
  return { ok: true };
}

export function canManageSecurityOwners(requestContext = {}) {
  const roles = Array.isArray(requestContext.roles) ? requestContext.roles : [];
  return roles.includes('bootstrap')
    || roles.includes(OWNER_ROLE)
    || roles.includes(IMPLEMENTATION_OWNER_ROLE);
}

export async function guardSecurityOwnerUserMutation(client, {
  repo = defaultRepo,
  installationId,
  userId,
  allowSecurityOwnerMutation = false,
}) {
  if (allowSecurityOwnerMutation || !UUID_PATTERN.test(text(userId))) return { ok: true };
  const binding = await repo.getSecurityOwnerBindingForUser(client, { installationId, userId });
  return binding
    ? { ok: false, code: 'SECURITY_OWNER_PROTECTED', statusCode: 403 }
    : { ok: true };
}

export async function guardSecurityOwnerEmployeeMutation(client, {
  repo = defaultRepo,
  installationId,
  employeeId,
  allowSecurityOwnerMutation = false,
}) {
  if (allowSecurityOwnerMutation || !UUID_PATTERN.test(text(employeeId))) return { ok: true };
  const binding = await repo.getSecurityOwnerBindingForEmployee(client, { installationId, employeeId });
  return binding
    ? { ok: false, code: 'SECURITY_OWNER_PROTECTED', statusCode: 403 }
    : { ok: true };
}

export function createInternalWorkforceAuthenticator({
  config,
  pool,
  repo = defaultRepo,
  now = () => new Date(),
} = {}) {
  if (!config || !pool || typeof pool.query !== 'function') throw new Error('INTERNAL_AUTH_ADAPTER_INVALID');

  async function login(payload = {}) {
    if (!config.enabled) return authFailure('INTERNAL_AUTH_NOT_CONFIGURED', 503);
    const loginName = normalizeLogin(payload.loginName ?? payload.login_name);
    const password = typeof payload.password === 'string' ? payload.password : '';
    if (!loginName || !password) {
      await fakePasswordWork(password);
      return authFailure('INTERNAL_AUTH_INVALID_CREDENTIALS');
    }

    const identity = await repo.findLoginIdentity(pool, {
      installationId: payload.installationId,
      loginName,
    });
    if (!identity || !identity.password_hash) {
      await fakePasswordWork(password);
      return authFailure('INTERNAL_AUTH_INVALID_CREDENTIALS');
    }

    const actorId = `user:${identity.user_id}`;
    const sessionId = randomUUID();
    const sourceApp = normalizeSourceApp(payload.sourceApp);
    const requestContext = {
      installationId: payload.installationId,
      actorId,
      employeeId: identity.employee_id,
      sourceApp,
      requestId: text(payload.requestId) || `auth_${sessionId}`,
    };

    const auditDeniedLogin = async (client, failure) => {
      await insertAuditRecord(client, buildAuditRecord({
        requestContext,
        action: 'login_denied',
        resourceType: 'internal_user',
        resourceId: identity.user_id,
        afterData: {
          userId: identity.user_id,
          employeeId: identity.employee_id,
          sourceApp,
          accessChannel: 'WEB',
          outcome: 'DENIED',
          reasonCode: failure.code,
        },
      }));
      return { denied: failure };
    };

    if (!identity.user_is_active || !identity.employee_is_active) {
      await fakePasswordWork(password);
      const failure = authFailure('INTERNAL_AUTH_INVALID_CREDENTIALS');
      const denied = await withAuditOutboxTransaction({
        adapter: pool,
        mutate: (client) => auditDeniedLogin(client, failure),
      });
      return denied.denied ?? failure;
    }

    const token = `${SESSION_TOKEN_PREFIX}${sessionId}.${randomBytes(32).toString('base64url')}`;
    const issuedAt = now();
    const expiresAt = new Date(issuedAt.getTime() + (config.sessionTtlSeconds * 1000));

    const transactionResult = await withAuditOutboxTransaction({
      adapter: pool,
      mutate: async (client) => {
        const credential = await repo.lockCredentialForLogin(client, {
          installationId: payload.installationId,
          userId: identity.user_id,
        });
        if (!credential || isFutureDate(credential.locked_until, now())) {
          await fakePasswordWork(password);
          return auditDeniedLogin(client, authFailure('INTERNAL_AUTH_INVALID_CREDENTIALS'));
        }

        const passwordOk = await verifyInternalPassword(password, credential.password_hash);
        if (!passwordOk) {
          await repo.recordPasswordFailure(client, {
            installationId: payload.installationId,
            userId: identity.user_id,
            lockThreshold: LOCK_THRESHOLD,
            lockSeconds: LOCK_SECONDS,
          });
          return auditDeniedLogin(client, authFailure('INTERNAL_AUTH_INVALID_CREDENTIALS'));
        }

        const ownerBinding = typeof repo.getSecurityOwnerBindingForUser === 'function'
          ? await repo.getSecurityOwnerBindingForUser(client, {
              installationId: payload.installationId,
              userId: identity.user_id,
            })
          : { owner_kind: 'UNKNOWN' };
        if (ownerBinding) {
          const challenge = challengeResult(config, payload.ownerCode);
          if (!challenge.ok) {
            if (challenge.code === 'INTERNAL_AUTH_OWNER_CODE_INVALID') {
              await repo.recordPasswordFailure(client, {
                installationId: payload.installationId,
                userId: identity.user_id,
                lockThreshold: LOCK_THRESHOLD,
                lockSeconds: LOCK_SECONDS,
              });
            }
            return auditDeniedLogin(client, authFailure(challenge.code, challenge.statusCode));
          }
        }

        await repo.resetPasswordFailures(client, {
          installationId: payload.installationId,
          userId: identity.user_id,
          updatedBy: actorId,
        });
        const authorization = await resolveAuthorization(repo, client, {
          installationId: payload.installationId,
          userId: identity.user_id,
        });
        const session = await repo.insertSession(client, {
          sessionId,
          installationId: payload.installationId,
          userId: identity.user_id,
          tokenHash: sha256(token),
          sourceApp,
          expiresAt: expiresAt.toISOString(),
        });
        await insertAuditRecord(client, buildAuditRecord({
          requestContext,
          action: 'login',
          resourceType: 'internal_session',
          resourceId: sessionId,
          afterData: {
            userId: identity.user_id,
            employeeId: identity.employee_id,
            sourceApp,
            accessChannel: 'WEB',
            expiresAt: session.expires_at,
            ownerKind: authorization.ownerKind,
          },
        }));
        return { session, authorization };
      },
    });

    if (transactionResult.denied) return transactionResult.denied;

    return Object.freeze({
      ok: true,
      token,
      session: Object.freeze({
        id: transactionResult.session.id,
        createdAt: transactionResult.session.created_at,
        expiresAt: transactionResult.session.expires_at,
        sourceApp,
        accessChannel: 'WEB',
      }),
      user: Object.freeze({
        id: identity.user_id,
        loginName: identity.login_name,
        employeeId: identity.employee_id,
        employeeFullName: identity.employee_full_name,
        roles: transactionResult.authorization.roles,
        permissions: transactionResult.authorization.permissions,
        scopes: transactionResult.authorization.scopes,
        ownerKind: transactionResult.authorization.ownerKind,
      }),
    });
  }

  async function resolveRequest(req, { installationId }) {
    if (!config.enabled) return null;
    const token = parseBearerToken(req);
    const parsed = parseInternalSessionToken(token);
    if (parsed === null) return null;
    if (parsed === false) return authFailure('INTERNAL_AUTH_SESSION_INVALID');

    const session = await repo.findActiveSession(pool, {
      sessionId: parsed.sessionId,
      installationId,
      tokenHash: parsed.tokenHash,
    });
    if (!session || session.revoked_at) return authFailure('INTERNAL_AUTH_SESSION_INVALID');
    if (!session.user_is_active || !session.employee_is_active) return authFailure('INTERNAL_AUTH_SESSION_REVOKED');
    if (new Date(session.expires_at).getTime() <= now().getTime()) return authFailure('INTERNAL_AUTH_SESSION_EXPIRED');

    const authorization = await resolveAuthorization(repo, pool, {
      installationId,
      userId: session.user_id,
    });
    return Object.freeze({
      ok: true,
      principal: Object.freeze({
        actorId: `user:${session.user_id}`,
        employeeId: session.employee_id,
        roles: authorization.roles,
        permissions: authorization.permissions,
        scopes: authorization.scopes,
        sourceApp: session.source_app,
      }),
      session: Object.freeze({
        id: session.session_id,
        userId: session.user_id,
        loginName: session.login_name,
        employeeFullName: session.employee_full_name,
        expiresAt: session.expires_at,
        sourceApp: session.source_app,
        ownerKind: authorization.ownerKind,
      }),
    });
  }

  return Object.freeze({ login, resolveRequest });
}

export async function setInternalUserCredential(client, {
  repo = defaultRepo,
  installationId,
  userId,
  password,
  actorId,
  allowSecurityOwnerMutation = false,
}) {
  if (!UUID_PATTERN.test(text(userId))) {
    return { ok: false, code: 'INVALID_USER_ID', statusCode: 400 };
  }
  if (!await repo.userExistsForInstallation(client, { installationId, userId })) {
    return { ok: false, code: 'USER_NOT_FOUND', statusCode: 404 };
  }
  const protection = await guardSecurityOwnerUserMutation(client, {
    repo,
    installationId,
    userId,
    allowSecurityOwnerMutation,
  });
  if (!protection.ok) return protection;

  let passwordHash;
  try {
    passwordHash = await hashInternalPassword(password);
  } catch (error) {
    return { ok: false, code: error.code ?? 'INTERNAL_AUTH_PASSWORD_INVALID', statusCode: 400 };
  }
  await repo.upsertCredential(client, { installationId, userId, passwordHash, actorId });
  const revokedSessionCount = await repo.revokeAllUserSessions(client, { installationId, userId, revokedBy: actorId });
  return { ok: true, userId, revokedSessionCount };
}

export async function replaceInternalUserScopes(client, {
  repo = defaultRepo,
  installationId,
  userId,
  scopes,
  actorId,
  allowSecurityOwnerMutation = false,
}) {
  if (!UUID_PATTERN.test(text(userId))) return { ok: false, code: 'INVALID_USER_ID', statusCode: 400 };
  if (!await repo.userExistsForInstallation(client, { installationId, userId })) {
    return { ok: false, code: 'USER_NOT_FOUND', statusCode: 404 };
  }
  const protection = await guardSecurityOwnerUserMutation(client, {
    repo,
    installationId,
    userId,
    allowSecurityOwnerMutation,
  });
  if (!protection.ok) return protection;
  if (invalidScopePayload(scopes)) return { ok: false, code: 'INVALID_SCOPE', statusCode: 400 };
  const normalized = normalizeScopes(scopes);
  if (normalized.territoryIds.length > 0) {
    return { ok: false, code: 'TERRITORY_SCOPE_NOT_CONFIGURED', statusCode: 400 };
  }
  const validation = await repo.validateUserScopeIds(client, { installationId, scopes: normalized });
  if (validation.missingBranchIds.length || validation.missingWarehouseIds.length) {
    return { ok: false, code: 'SCOPE_OUTSIDE_INSTALLATION', statusCode: 400 };
  }
  await repo.replaceUserScopes(client, {
    installationId,
    userId,
    scopes: normalized,
    createdBy: actorId,
  });
  return { ok: true, userId, scopes: normalized };
}

export async function revokeInternalUserSessions(client, {
  repo = defaultRepo,
  installationId,
  userId,
  actorId,
  allowSecurityOwnerMutation = false,
}) {
  if (!UUID_PATTERN.test(text(userId))) return { ok: false, code: 'INVALID_USER_ID', statusCode: 400 };
  if (!await repo.userExistsForInstallation(client, { installationId, userId })) {
    return { ok: false, code: 'USER_NOT_FOUND', statusCode: 404 };
  }
  const protection = await guardSecurityOwnerUserMutation(client, {
    repo,
    installationId,
    userId,
    allowSecurityOwnerMutation,
  });
  if (!protection.ok) return protection;
  const revokedSessionCount = await repo.revokeAllUserSessions(client, {
    installationId,
    userId,
    revokedBy: actorId,
  });
  return { ok: true, userId, revokedSessionCount };
}

export async function revokeInternalSession(client, {
  repo = defaultRepo,
  installationId,
  sessionId,
  userId,
  actorId,
}) {
  if (!UUID_PATTERN.test(text(sessionId)) || !UUID_PATTERN.test(text(userId))) {
    return { ok: false, code: 'INVALID_SESSION_ID', statusCode: 400 };
  }
  const revoked = await repo.revokeSession(client, {
    sessionId,
    installationId,
    userId,
    revokedBy: actorId,
  });
  return { ok: true, revoked: Boolean(revoked) };
}

export async function reconcileSecurityOwners(client, {
  repo = defaultRepo,
  config,
  installationId,
  actorId,
}) {
  if ((config.securityOwnerEmails?.length ?? 0) < 2) {
    return { ok: false, code: 'SECURITY_OWNER_CONFIG_INCOMPLETE', statusCode: 409 };
  }
  const requested = [
    ...config.securityOwnerEmails.map((email) => ({ email, ownerKind: 'PERMANENT' })),
    ...config.implementationOwnerEmails.map((email) => ({ email, ownerKind: 'TEMPORARY' })),
  ];
  const candidates = await repo.findOwnerCandidatesByEmails(client, {
    installationId,
    emails: requested.map((item) => item.email),
  });
  const byEmail = new Map();
  for (const row of candidates) {
    const email = String(row.email).toLowerCase();
    const rows = byEmail.get(email) ?? [];
    rows.push(row);
    byEmail.set(email, rows);
  }

  const bindings = [];
  for (const request of requested) {
    const rows = byEmail.get(request.email) ?? [];
    if (rows.length === 0) return { ok: false, code: 'SECURITY_OWNER_USER_NOT_FOUND', statusCode: 409 };
    if (rows.length !== 1) return { ok: false, code: 'SECURITY_OWNER_IDENTITY_AMBIGUOUS', statusCode: 409 };
    if (!rows[0].user_is_active || !rows[0].employee_is_active) {
      return { ok: false, code: 'SECURITY_OWNER_USER_INACTIVE', statusCode: 409 };
    }
    bindings.push({ userId: rows[0].user_id, ownerKind: request.ownerKind });
  }

  const before = await repo.listSecurityOwnerBindings(client, { installationId });
  await repo.replaceSecurityOwnerBindings(client, { installationId, bindings, actorId });
  return {
    ok: true,
    permanentOwnerCount: bindings.filter((item) => item.ownerKind === 'PERMANENT').length,
    temporaryOwnerCount: bindings.filter((item) => item.ownerKind === 'TEMPORARY').length,
    previousBindingCount: before.length,
    bindingCount: bindings.length,
  };
}

export const INTERNAL_SECURITY_OWNER_ROLE = OWNER_ROLE;
export const INTERNAL_IMPLEMENTATION_OWNER_ROLE = IMPLEMENTATION_OWNER_ROLE;
