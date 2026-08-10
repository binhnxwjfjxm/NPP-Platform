import assert from 'node:assert/strict';
import test from 'node:test';
import { loadInternalWorkforceAuthConfig } from '../src/internal-workforce-config.js';
import {
  createInternalWorkforceAuthenticator,
  hashInternalPassword,
} from '../src/internal-workforce-auth.js';

const INSTALLATION_ID = 'npp-test';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const EMPLOYEE_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-08-09T16:00:00.000Z');
const PASSWORD = 'Correct-Horse-99';

function productionConfig() {
  return loadInternalWorkforceAuthConfig({
    NODE_ENV: 'production',
    INTERNAL_AUTH_ENABLED: 'true',
    INTERNAL_SESSION_TTL_SECONDS: '3600',
    INTERNAL_WEB_OWNER_CHALLENGE_REQUIRED: 'true',
    ALLOW_FIXED_OWNER_CODE: 'false',
    SECURITY_OWNER_EMAILS: 'OWNER1@example.test,owner1@example.test,OWNER2@example.test',
    IMPLEMENTATION_OWNER_EMAILS: 'Implementation@example.test',
  });
}

function challengeEnv() {
  return {
    CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
    CLOUDFLARE_EMAIL_API_TOKEN: 'test-cloudflare-token',
    INTERNAL_AUTH_EMAIL_FROM: 'security@example.test',
    INTERNAL_AUTH_CHALLENGE_PEPPER: 'a'.repeat(64),
    INTERNAL_WEB_CHALLENGE_TTL_SECONDS: '300',
    INTERNAL_WEB_CHALLENGE_MAX_ATTEMPTS: '5',
    INTERNAL_WEB_CHALLENGE_RESEND_COOLDOWN_SECONDS: '60',
  };
}

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

function challengeRepo(passwordHash, state = {}, ownerKind = 'PERMANENT', employeeEmail = 'employee@example.test') {
  return {
    async findLoginIdentity() {
      return {
        user_id: USER_ID,
        login_name: 'employee@example.test',
        user_is_active: true,
        employee_id: EMPLOYEE_ID,
        employee_full_name: 'Employee Test',
        employee_email: employeeEmail,
        employee_is_active: true,
        password_hash: passwordHash,
        failed_attempts: 0,
        locked_until: null,
      };
    },
    async lockCredentialForLogin() {
      return { password_hash: passwordHash, failed_attempts: 0, locked_until: null };
    },
    async loadUserAuthorization() {
      return {
        roles: [],
        permissionKeys: [],
        scopes: { branchIds: [], warehouseIds: [], territoryIds: [] },
        ownerKind,
        webLoginChallengeRequired: false,
      };
    },
    async loadInstallationOwnerScopes() {
      return { branchIds: [], warehouseIds: [] };
    },
    async findActiveLoginChallengeForUpdate() { return null; },
    async cancelActiveLoginChallenges() {},
    async insertLoginChallenge(_client, input) {
      return {
        id: input.id,
        created_at: NOW.toISOString(),
        expires_at: input.expiresAt,
        failed_attempts: 0,
      };
    },
    async cancelLoginChallenge() {
      state.cancelled = (state.cancelled ?? 0) + 1;
      return true;
    },
    async recordPasswordFailure() {},
  };
}

async function issueChallenge(fetchImpl, state = {}, ownerKind = 'PERMANENT', employeeEmail = 'employee@example.test') {
  const passwordHash = await hashInternalPassword(PASSWORD);
  const pool = auditPool();
  const authenticator = createInternalWorkforceAuthenticator({
    config: productionConfig(),
    env: challengeEnv(),
    fetchImpl,
    pool,
    repo: challengeRepo(passwordHash, state, ownerKind, employeeEmail),
    now: () => NOW,
  });
  const result = await authenticator.login({
    installationId: INSTALLATION_ID,
    requestId: 'req_owner_otp',
    loginName: 'employee@example.test',
    password: PASSWORD,
    sourceApp: 'npp-operations-web',
  });
  return { result, pool };
}

test('production OTP targets only the authenticating employee canonical email', async () => {
  let outbound = null;
  const fetchImpl = async (_url, options) => {
    outbound = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          success: true,
          result: {
            delivered: outbound.to,
            queued: [],
            permanent_bounces: [],
          },
        };
      },
    };
  };

  const { result, pool } = await issueChallenge(
    fetchImpl,
    {},
    'PERMANENT',
    'Employee.Canonical@example.test',
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'INTERNAL_AUTH_OWNER_CHALLENGE_REQUIRED');
  assert.deepEqual(outbound.to, ['employee.canonical@example.test']);
  assert.equal(outbound.to.includes('owner1@example.test'), false);
  assert.equal(outbound.to.includes('owner2@example.test'), false);
  assert.deepEqual(outbound.from, {
    address: 'security@example.test',
    name: 'Hưng Phát Security',
  });
  assert.match(outbound.text, /không dùng cho ngân hàng/i);

  const issuedAudit = pool.queries.find(({ sql, values }) => (
    sql.includes('INSERT INTO shared.core_audit_records')
    && values[6] === 'login_challenge_issued'
  ));
  assert.ok(issuedAudit);
  assert.equal(issuedAudit.values[10].recipientCount, 1);
});

test('temporary Implementation Owner receives the challenge at their own canonical employee email', async () => {
  let outbound = null;
  const fetchImpl = async (_url, options) => {
    outbound = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          success: true,
          result: {
            delivered: outbound.to,
            queued: [],
            permanent_bounces: [],
          },
        };
      },
    };
  };

  const { result } = await issueChallenge(fetchImpl, {}, 'TEMPORARY', 'Implementation@example.test');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'INTERNAL_AUTH_OWNER_CHALLENGE_REQUIRED');
  assert.deepEqual(outbound.to, ['implementation@example.test']);
});

test('production OTP fails closed when the authenticating employee recipient is not delivered or queued', async () => {
  const state = {};
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return {
        success: true,
        result: {
          delivered: [],
          queued: [],
          permanent_bounces: [],
        },
      };
    },
  });

  const { result } = await issueChallenge(fetchImpl, state);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'INTERNAL_AUTH_OWNER_CHALLENGE_UNAVAILABLE');
  assert.equal(result.statusCode, 503);
  assert.equal(state.cancelled, 1);
});

test('production OTP fails closed on a permanent bounce for the authenticating employee', async () => {
  const state = {};
  const fetchImpl = async (_url, options) => {
    const outbound = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          success: true,
          result: {
            delivered: outbound.to,
            queued: [],
            permanent_bounces: outbound.to,
          },
        };
      },
    };
  };

  const { result } = await issueChallenge(fetchImpl, state);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'INTERNAL_AUTH_OWNER_CHALLENGE_UNAVAILABLE');
  assert.equal(result.statusCode, 503);
  assert.equal(state.cancelled, 1);
});
