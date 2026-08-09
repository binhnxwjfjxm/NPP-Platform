import assert from 'node:assert/strict';
import test from 'node:test';
import { loadInternalWorkforceAuthConfig } from '../src/internal-workforce-config.js';
import {
  createInternalWorkforceAuthenticator,
  hashInternalPassword,
  verifyInternalPassword,
  INTERNAL_SECURITY_OWNER_ROLE,
} from '../src/internal-workforce-auth.js';

const INSTALLATION_ID = 'npp-test';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const EMPLOYEE_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';

function auditPool() {
  const queries = [];
  const client = {
    async query(sql, values = []) {
      queries.push({ sql: String(sql), values });
      return { rows: [] };
    },
    async release() {},
  };
  return {
    queries,
    async query() { return { rows: [] }; },
    async connect() { return client; },
  };
}

function config(overrides = {}) {
  return loadInternalWorkforceAuthConfig({
    NODE_ENV: 'test',
    INTERNAL_AUTH_ENABLED: 'true',
    INTERNAL_SESSION_TTL_SECONDS: '3600',
    INTERNAL_WEB_OWNER_CHALLENGE_REQUIRED: 'true',
    ALLOW_FIXED_OWNER_CODE: 'true',
    SECURITY_OWNER_TEST_CODE: '654321',
    SECURITY_OWNER_EMAILS: 'owner1@example.test,owner2@example.test',
    IMPLEMENTATION_OWNER_EMAILS: 'implementation@example.test',
    ...overrides,
  });
}

test('production refuses fixed Security Owner challenge code', () => {
  assert.throws(() => loadInternalWorkforceAuthConfig({
    NODE_ENV: 'production',
    INTERNAL_AUTH_ENABLED: 'true',
    ALLOW_FIXED_OWNER_CODE: 'true',
    SECURITY_OWNER_TEST_CODE: '654321',
  }), /FIXED_OWNER_CODE_FORBIDDEN_IN_PRODUCTION/);
});

test('fixed challenge mode requires a non-trivial code', () => {
  assert.throws(() => loadInternalWorkforceAuthConfig({
    NODE_ENV: 'test',
    INTERNAL_AUTH_ENABLED: 'true',
    ALLOW_FIXED_OWNER_CODE: 'true',
    SECURITY_OWNER_TEST_CODE: '123',
  }), /FIXED_OWNER_CODE_INVALID/);
});

test('password hash verifies without storing plaintext', async () => {
  const password = 'Correct-Horse-99';
  const hashed = await hashInternalPassword(password);
  assert.match(hashed, /^scrypt\$v1\$/);
  assert.ok(!hashed.includes(password));
  assert.equal(await verifyInternalPassword(password, hashed), true);
  assert.equal(await verifyInternalPassword('wrong-password', hashed), false);
});

test('login creates a hashed opaque session and resolves Security Owner authority', async () => {
  const passwordHash = await hashInternalPassword('Correct-Horse-99');
  let insertedSession = null;
  const repo = {
    async findLoginIdentity() {
      return {
        user_id: USER_ID,
        login_name: 'owner.test',
        user_is_active: true,
        employee_id: EMPLOYEE_ID,
        employee_full_name: 'Owner Test',
        employee_is_active: true,
        password_hash: passwordHash,
        failed_attempts: 0,
        locked_until: null,
      };
    },
    async recordPasswordFailure() { throw new Error('unexpected failure'); },
    async resetPasswordFailures() {},
    async loadUserAuthorization() {
      return {
        roles: ['ACCOUNTING'],
        permissionKeys: ['core.employee.read'],
        scopes: { branchIds: [], warehouseIds: [], territoryIds: [] },
        ownerKind: 'PERMANENT',
      };
    },
    async loadInstallationOwnerScopes() {
      return {
        branchIds: ['44444444-4444-4444-8444-444444444444'],
        warehouseIds: ['55555555-5555-4555-8555-555555555555'],
      };
    },
    async insertSession(_client, input) {
      insertedSession = input;
      return {
        id: input.sessionId,
        created_at: '2026-08-09T04:00:00.000Z',
        expires_at: input.expiresAt,
      };
    },
  };
  const pool = auditPool();
  const authenticator = createInternalWorkforceAuthenticator({
    config: config(),
    pool,
    repo,
    now: () => new Date('2026-08-09T04:00:00.000Z'),
  });

  const result = await authenticator.login({
    installationId: INSTALLATION_ID,
    requestId: 'req_login_test',
    loginName: 'OWNER.TEST',
    password: 'Correct-Horse-99',
    ownerCode: '654321',
    sourceApp: 'npp-operations-web',
  });

  assert.equal(result.ok, true);
  assert.match(result.token, /^nppusr\.[0-9a-f-]{36}\.[A-Za-z0-9_-]+$/);
  assert.equal(insertedSession.tokenHash.length, 64);
  assert.notEqual(insertedSession.tokenHash, result.token);
  assert.ok(result.user.roles.includes(INTERNAL_SECURITY_OWNER_ROLE));
  assert.ok(result.user.permissions.includes('core.role.write'));
  assert.deepEqual(result.user.scopes.branchIds, ['44444444-4444-4444-8444-444444444444']);
  assert.deepEqual(result.user.scopes.warehouseIds, ['55555555-5555-4555-8555-555555555555']);
  assert.ok(pool.queries.some(({ sql }) => sql.includes('INSERT INTO shared.core_audit_records')));
  assert.ok(pool.queries.every(({ values }) => !values.some((value) => value === result.token || value === 'Correct-Horse-99' || value === '654321')));
});

test('wrong password records a failure and never creates a session', async () => {
  const passwordHash = await hashInternalPassword('Correct-Horse-99');
  let failures = 0;
  let sessions = 0;
  const repo = {
    async findLoginIdentity() {
      return {
        user_id: USER_ID,
        login_name: 'staff.test',
        user_is_active: true,
        employee_id: EMPLOYEE_ID,
        employee_full_name: 'Staff Test',
        employee_is_active: true,
        password_hash: passwordHash,
        failed_attempts: 0,
        locked_until: null,
      };
    },
    async recordPasswordFailure() { failures += 1; },
    async insertSession() { sessions += 1; },
  };
  const authenticator = createInternalWorkforceAuthenticator({ config: config(), pool: auditPool(), repo });
  const result = await authenticator.login({
    installationId: INSTALLATION_ID,
    loginName: 'staff.test',
    password: 'wrong-password',
    ownerCode: '654321',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'INTERNAL_AUTH_INVALID_CREDENTIALS');
  assert.equal(failures, 1);
  assert.equal(sessions, 0);
});

test('fixed owner code is required for web login in test mode', async () => {
  const passwordHash = await hashInternalPassword('Correct-Horse-99');
  const repo = {
    async findLoginIdentity() {
      return {
        user_id: USER_ID,
        login_name: 'staff.test',
        user_is_active: true,
        employee_id: EMPLOYEE_ID,
        employee_full_name: 'Staff Test',
        employee_is_active: true,
        password_hash: passwordHash,
        failed_attempts: 0,
        locked_until: null,
      };
    },
  };
  const authenticator = createInternalWorkforceAuthenticator({ config: config(), pool: auditPool(), repo });
  const result = await authenticator.login({
    installationId: INSTALLATION_ID,
    loginName: 'staff.test',
    password: 'Correct-Horse-99',
    ownerCode: '000000',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'INTERNAL_AUTH_OWNER_CODE_INVALID');
});

test('session resolution fails closed for expired sessions', async () => {
  const repo = {
    async findActiveSession() {
      return {
        session_id: SESSION_ID,
        user_id: USER_ID,
        source_app: 'npp-operations-web',
        expires_at: '2026-08-09T03:59:59.000Z',
        revoked_at: null,
        user_is_active: true,
        employee_id: EMPLOYEE_ID,
        employee_full_name: 'Staff Test',
        employee_is_active: true,
      };
    },
  };
  const authenticator = createInternalWorkforceAuthenticator({
    config: config(),
    pool: auditPool(),
    repo,
    now: () => new Date('2026-08-09T04:00:00.000Z'),
  });
  const token = `nppusr.${SESSION_ID}.${'a'.repeat(43)}`;
  const result = await authenticator.resolveRequest({ headers: { authorization: `Bearer ${token}` } }, { installationId: INSTALLATION_ID });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'INTERNAL_AUTH_SESSION_EXPIRED');
});

test('session resolution re-loads current role, permission and scope state', async () => {
  const repo = {
    async findActiveSession() {
      return {
        session_id: SESSION_ID,
        user_id: USER_ID,
        login_name: 'staff.test',
        source_app: 'npp-operations-web',
        expires_at: '2026-08-09T05:00:00.000Z',
        revoked_at: null,
        user_is_active: true,
        employee_id: EMPLOYEE_ID,
        employee_full_name: 'Staff Test',
        employee_is_active: true,
      };
    },
    async loadUserAuthorization() {
      return {
        roles: ['WAREHOUSE_STAFF'],
        permissionKeys: ['core.inventory.read'],
        scopes: {
          branchIds: [],
          warehouseIds: ['55555555-5555-4555-8555-555555555555'],
          territoryIds: [],
        },
        ownerKind: null,
      };
    },
  };
  const authenticator = createInternalWorkforceAuthenticator({
    config: config(),
    pool: auditPool(),
    repo,
    now: () => new Date('2026-08-09T04:00:00.000Z'),
  });
  const token = `nppusr.${SESSION_ID}.${'b'.repeat(43)}`;
  const result = await authenticator.resolveRequest({ headers: { authorization: `Bearer ${token}` } }, { installationId: INSTALLATION_ID });
  assert.equal(result.ok, true);
  assert.equal(result.principal.actorId, `user:${USER_ID}`);
  assert.equal(result.principal.employeeId, EMPLOYEE_ID);
  assert.deepEqual(result.principal.roles, ['WAREHOUSE_STAFF']);
  assert.deepEqual(result.principal.permissions, ['core.inventory.read']);
  assert.deepEqual(result.principal.scopes.warehouseIds, ['55555555-5555-4555-8555-555555555555']);
});
