import assert from 'node:assert/strict';
import test from 'node:test';
import { loadInternalWorkforceAuthConfig } from '../src/internal-workforce-config.js';
import {
  createInternalWorkforceAuthenticator,
  hashInternalPassword,
  resolveOwnerChallengeRecipients,
} from '../src/internal-workforce-auth.js';

const INSTALLATION_ID = 'npp-test';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const EMPLOYEE_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-08-09T04:00:00.000Z');

function productionConfig(overrides = {}) {
  return loadInternalWorkforceAuthConfig({
    NODE_ENV: 'production',
    INTERNAL_AUTH_ENABLED: 'true',
    INTERNAL_SESSION_TTL_SECONDS: '3600',
    INTERNAL_WEB_OWNER_CHALLENGE_REQUIRED: 'true',
    ALLOW_FIXED_OWNER_CODE: 'false',
    SECURITY_OWNER_EMAILS: 'owner1@example.test,owner2@example.test',
    IMPLEMENTATION_OWNER_EMAILS: 'implementation@example.test',
    ...overrides,
  });
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

function challengeRepo(passwordHash, state = {}) {
  return {
    async findLoginIdentity() {
      return {
        user_id: USER_ID,
        login_name: 'employee@example.test',
        user_is_active: true,
        employee_id: EMPLOYEE_ID,
        employee_full_name: 'Employee Test',
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
        roles: ['ACCOUNTING'],
        permissionKeys: [],
        scopes: { branchIds: [], warehouseIds: [], territoryIds: [] },
        ownerKind: null,
        webLoginChallengeRequired: true,
      };
    },
    async findActiveLoginChallengeForUpdate() { return null; },
    async cancelActiveLoginChallenges() {},
    async insertLoginChallenge(_client, input) {
      return {
        id: input.id,
        created_at: NOW.toISOString(),
        expires_at: input.expiresAt,
      };
    },
    async cancelLoginChallenge() { state.cancelled = (state.cancelled ?? 0) + 1; },
    async recordPasswordFailure() { throw new Error('unexpected password failure'); },
  };
}

function challengeEnv() {
  return {
    CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
    CLOUDFLARE_EMAIL_API_TOKEN: 'test-token',
    INTERNAL_AUTH_EMAIL_FROM: 'security@example.test',
    INTERNAL_AUTH_CHALLENGE_PEPPER: 'p'.repeat(32),
  };
}

async function requestChallenge({ fetchImpl, state = {} }) {
  const password = 'Correct-Horse-99';
  const passwordHash = await hashInternalPassword(password);
  const pool = auditPool();
  const authenticator = createInternalWorkforceAuthenticator({
    config: productionConfig(),
    pool,
    repo: challengeRepo(passwordHash, state),
    now: () => NOW,
    env: challengeEnv(),
    fetchImpl,
  });
  const result = await authenticator.login({
    installationId: INSTALLATION_ID,
    requestId: 'req_owner_challenge_email',
    loginName: 'employee@example.test',
    password,
    sourceApp: 'npp-operations-web',
  });
  return { result, pool };
}

test('owner challenge recipients merge Security and Implementation Owners, normalize and deduplicate', () => {
  assert.deepEqual(resolveOwnerChallengeRecipients({
    securityOwnerEmails: [' OWNER1@EXAMPLE.TEST ', 'owner1@example.test', 'OWNER2@example.test'],
    implementationOwnerEmails: ['Implementation@Example.Test'],
  }), [
    'owner1@example.test',
    'owner2@example.test',
    'implementation@example.test',
  ]);
});

test('production OTP sends exactly all 3 Owners with Cloudflare named sender and audits recipientCount 3', async () => {
  let requestBody = null;
  const { result, pool } = await requestChallenge({
    fetchImpl: async (_url, request) => {
      requestBody = JSON.parse(request.body);
      return {
        ok: true,
        async json() {
          return {
            success: true,
            result: {
              delivered: requestBody.to,
              queued: [],
              permanent_bounces: [],
            },
          };
        },
      };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'INTERNAL_AUTH_OWNER_CHALLENGE_REQUIRED');
  assert.deepEqual(requestBody.to, [
    'owner1@example.test',
    'owner2@example.test',
    'implementation@example.test',
  ]);
  assert.equal(requestBody.to.length, 3);
  assert.equal(new Set(requestBody.to).size, 3);
  assert.equal(requestBody.to.includes('employee@example.test'), false);
  assert.deepEqual(requestBody.from, {
    address: 'security@example.test',
    name: 'Hưng Phát Security',
  });

  const issuedAudit = pool.queries.find(({ values }) => values?.[6] === 'login_challenge_issued');
  assert.ok(issuedAudit);
  assert.equal(issuedAudit.values[10].recipientCount, 3);
});

test('production OTP fails closed when any one of the 3 Owners is not delivered or queued', async () => {
  const state = {};
  const { result } = await requestChallenge({
    state,
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body);
      return {
        ok: true,
        async json() {
          return {
            success: true,
            result: {
              delivered: body.to.slice(0, 2),
              queued: [],
              permanent_bounces: [],
            },
          };
        },
      };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'INTERNAL_AUTH_OWNER_CHALLENGE_UNAVAILABLE');
  assert.equal(result.statusCode, 503);
  assert.equal(state.cancelled, 1);
});

test('production OTP fails closed on a permanent bounce even when all 3 Owners were otherwise accepted', async () => {
  const state = {};
  const { result } = await requestChallenge({
    state,
    fetchImpl: async (_url, request) => {
      const body = JSON.parse(request.body);
      return {
        ok: true,
        async json() {
          return {
            success: true,
            result: {
              delivered: body.to,
              queued: [],
              permanent_bounces: [body.to[2]],
            },
          };
        },
      };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'INTERNAL_AUTH_OWNER_CHALLENGE_UNAVAILABLE');
  assert.equal(result.statusCode, 503);
  assert.equal(state.cancelled, 1);
});