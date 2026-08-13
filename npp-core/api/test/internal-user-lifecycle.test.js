import assert from 'node:assert/strict';
import test from 'node:test';
import { loadInternalWorkforceAuthConfig } from '../src/internal-workforce-config.js';
import {
  createInternalWorkforceAuthenticator,
  setInternalUserCredential,
} from '../src/internal-workforce-auth.js';

const INSTALLATION_ID = 'npp-test';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const EMPLOYEE_ID = '22222222-2222-4222-8222-222222222222';
const TEST_SECRET = `Test-${'x'.repeat(12)}`;

function config() {
  return loadInternalWorkforceAuthConfig({
    NODE_ENV: 'test',
    INTERNAL_AUTH_ENABLED: 'true',
    INTERNAL_SESSION_TTL_SECONDS: '3600',
    INTERNAL_WEB_OWNER_CHALLENGE_REQUIRED: 'false',
  });
}

function auditPool() {
  const client = {
    async query() { return { rows: [] }; },
    async release() {},
  };
  return {
    async query() { return { rows: [] }; },
    async connect() { return client; },
  };
}

test('staged account can receive a credential while its canonical employee remains active', async () => {
  let existenceSql = '';
  let credentialWritten = false;
  const client = {
    async query(sql) {
      const statement = String(sql);
      if (statement.includes('SELECT 1') && statement.includes('FROM shared.users u')) {
        existenceSql = statement;
        return { rows: [{ exists: 1 }] };
      }
      if (statement.includes('FROM shared.security_owner_bindings')) return { rows: [] };
      if (statement.includes('INSERT INTO shared.user_credentials')) {
        credentialWritten = true;
        return { rows: [{ user_id: USER_ID }] };
      }
      if (statement.includes('UPDATE shared.user_sessions')) return { rows: [] };
      throw new Error(`Unexpected query: ${statement}`);
    },
  };

  const result = await setInternalUserCredential(client, {
    installationId: INSTALLATION_ID,
    userId: USER_ID,
    password: TEST_SECRET,
    actorId: `user:${USER_ID}`,
  });

  assert.equal(result.ok, true);
  assert.equal(credentialWritten, true);
  assert.match(existenceSql, /e\.is_active\s*=\s*true/);
  assert.doesNotMatch(existenceSql, /u\.is_active\s*=\s*true/);
});

test('staged account is rejected when its canonical employee is not eligible', async () => {
  const client = {
    async query(sql) {
      const statement = String(sql);
      if (statement.includes('SELECT 1') && statement.includes('FROM shared.users u')) return { rows: [] };
      throw new Error(`Unexpected query after eligibility failure: ${statement}`);
    },
  };

  const result = await setInternalUserCredential(client, {
    installationId: INSTALLATION_ID,
    userId: USER_ID,
    password: TEST_SECRET,
    actorId: `user:${USER_ID}`,
  });

  assert.deepEqual(result, { ok: false, code: 'USER_NOT_FOUND', statusCode: 404 });
});

test('staged accounts remain unable to log in before activation', async () => {
  let credentialLockCalls = 0;
  const repo = {
    async findLoginIdentity() {
      return {
        user_id: USER_ID,
        login_name: 'staged.test',
        user_is_active: false,
        employee_id: EMPLOYEE_ID,
        employee_full_name: 'Staged Test',
        employee_email: 'staged@example.test',
        employee_is_active: true,
        password_hash: 'credential-present',
        failed_attempts: 0,
        locked_until: null,
      };
    },
    async lockCredentialForLogin() {
      credentialLockCalls += 1;
      return null;
    },
  };
  const authenticator = createInternalWorkforceAuthenticator({
    config: config(),
    pool: auditPool(),
    repo,
  });

  const result = await authenticator.login({
    installationId: INSTALLATION_ID,
    loginName: 'staged.test',
    password: TEST_SECRET,
    sourceApp: 'npp-operations-web',
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'INTERNAL_AUTH_INVALID_CREDENTIALS');
  assert.equal(credentialLockCalls, 0);
});
