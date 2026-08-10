import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureSecurityOwnerUsers } from '../scripts/workforce-owner-identity.js';

const INSTALLATION_ID = 'npp-production-test';
const EMAILS = [
  'owner1@example.test',
  'owner2@example.test',
  'implementation@example.test',
];

function identityRow({
  email,
  employeeId,
  employeeCode,
  employeeActive = true,
  userId = null,
  userActive = null,
}) {
  return {
    email,
    employee_id: employeeId,
    employee_code: employeeCode,
    employee_is_active: employeeActive,
    user_id: userId,
    user_is_active: userActive,
  };
}

function clientWithRows(rows) {
  const calls = [];
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql: String(sql), values });
      return { rows };
    },
  };
}

test('owner bootstrap creates only missing canonical users from unique active employees', async () => {
  const client = clientWithRows([
    identityRow({
      email: EMAILS[0],
      employeeId: '11111111-1111-4111-8111-111111111111',
      employeeCode: 'SEC_OWNER_1',
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      userActive: true,
    }),
    identityRow({
      email: EMAILS[1],
      employeeId: '22222222-2222-4222-8222-222222222222',
      employeeCode: 'SEC_OWNER_2',
    }),
    identityRow({
      email: EMAILS[2],
      employeeId: '33333333-3333-4333-8333-333333333333',
      employeeCode: 'IMPLEMENTATION_OWNER',
      userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      userActive: true,
    }),
  ]);
  const created = [];
  const userService = {
    async createUser(_client, input) {
      created.push(input);
      return {
        ok: true,
        user: {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          is_active: true,
        },
      };
    },
  };

  const result = await ensureSecurityOwnerUsers(client, {
    installationId: INSTALLATION_ID,
    emails: EMAILS,
    actorId: 'bootstrap:test',
    userService,
  });

  assert.deepEqual(result, { ok: true, ownerCount: 3, provisionedUserCount: 1 });
  assert.equal(created.length, 1);
  assert.deepEqual(created[0], {
    installationId: INSTALLATION_ID,
    payload: {
      employeeId: '22222222-2222-4222-8222-222222222222',
      loginName: 'sec_owner_2',
      isActive: true,
    },
    createdBy: 'bootstrap:test',
  });
  assert.match(client.calls[0].sql, /LEFT JOIN shared\.users/);
  assert.deepEqual(client.calls[0].values, [INSTALLATION_ID, EMAILS]);
});

test('owner bootstrap fails closed when an owner employee does not exist', async () => {
  const client = clientWithRows([
    identityRow({
      email: EMAILS[0],
      employeeId: '11111111-1111-4111-8111-111111111111',
      employeeCode: 'SEC_OWNER_1',
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      userActive: true,
    }),
  ]);
  let creates = 0;
  const result = await ensureSecurityOwnerUsers(client, {
    installationId: INSTALLATION_ID,
    emails: EMAILS,
    actorId: 'bootstrap:test',
    userService: { async createUser() { creates += 1; } },
  });
  assert.deepEqual(result, { ok: false, code: 'SECURITY_OWNER_EMPLOYEE_NOT_FOUND', statusCode: 409 });
  assert.equal(creates, 0);
});

test('owner bootstrap rejects ambiguous employee identity for the same email', async () => {
  const client = clientWithRows([
    identityRow({
      email: EMAILS[0],
      employeeId: '11111111-1111-4111-8111-111111111111',
      employeeCode: 'SEC_OWNER_1',
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      userActive: true,
    }),
    identityRow({
      email: EMAILS[0],
      employeeId: '44444444-4444-4444-8444-444444444444',
      employeeCode: 'SEC_OWNER_DUP',
      userId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      userActive: true,
    }),
  ]);
  const result = await ensureSecurityOwnerUsers(client, {
    installationId: INSTALLATION_ID,
    emails: [EMAILS[0]],
    actorId: 'bootstrap:test',
    userService: { async createUser() { throw new Error('must not create'); } },
  });
  assert.deepEqual(result, { ok: false, code: 'SECURITY_OWNER_IDENTITY_AMBIGUOUS', statusCode: 409 });
});

test('owner bootstrap rejects inactive employee or inactive existing user', async () => {
  const inactiveEmployee = await ensureSecurityOwnerUsers(clientWithRows([
    identityRow({
      email: EMAILS[0],
      employeeId: '11111111-1111-4111-8111-111111111111',
      employeeCode: 'SEC_OWNER_1',
      employeeActive: false,
    }),
  ]), {
    installationId: INSTALLATION_ID,
    emails: [EMAILS[0]],
    actorId: 'bootstrap:test',
    userService: { async createUser() { throw new Error('must not create'); } },
  });
  assert.deepEqual(inactiveEmployee, { ok: false, code: 'SECURITY_OWNER_EMPLOYEE_INACTIVE', statusCode: 409 });

  const inactiveUser = await ensureSecurityOwnerUsers(clientWithRows([
    identityRow({
      email: EMAILS[0],
      employeeId: '11111111-1111-4111-8111-111111111111',
      employeeCode: 'SEC_OWNER_1',
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      userActive: false,
    }),
  ]), {
    installationId: INSTALLATION_ID,
    emails: [EMAILS[0]],
    actorId: 'bootstrap:test',
    userService: { async createUser() { throw new Error('must not create'); } },
  });
  assert.deepEqual(inactiveUser, { ok: false, code: 'SECURITY_OWNER_USER_INACTIVE', statusCode: 409 });
});

test('owner bootstrap reports deterministic login collision instead of inventing another identity', async () => {
  const client = clientWithRows([
    identityRow({
      email: EMAILS[0],
      employeeId: '11111111-1111-4111-8111-111111111111',
      employeeCode: 'SEC_OWNER_1',
    }),
  ]);
  const result = await ensureSecurityOwnerUsers(client, {
    installationId: INSTALLATION_ID,
    emails: [EMAILS[0]],
    actorId: 'bootstrap:test',
    userService: {
      async createUser() {
        return { ok: false, code: 'DUPLICATE_LOGIN' };
      },
    },
  });
  assert.deepEqual(result, { ok: false, code: 'SECURITY_OWNER_LOGIN_CONFLICT', statusCode: 409 });
});

test('owner bootstrap rejects duplicated or empty configured owner emails before database access', async () => {
  let queries = 0;
  const client = {
    async query() {
      queries += 1;
      return { rows: [] };
    },
  };
  const duplicate = await ensureSecurityOwnerUsers(client, {
    installationId: INSTALLATION_ID,
    emails: [EMAILS[0], EMAILS[0]],
    actorId: 'bootstrap:test',
  });
  const empty = await ensureSecurityOwnerUsers(client, {
    installationId: INSTALLATION_ID,
    emails: [],
    actorId: 'bootstrap:test',
  });
  assert.deepEqual(duplicate, { ok: false, code: 'SECURITY_OWNER_EMAILS_INVALID', statusCode: 409 });
  assert.deepEqual(empty, { ok: false, code: 'SECURITY_OWNER_EMAILS_INVALID', statusCode: 409 });
  assert.equal(queries, 0);
});
