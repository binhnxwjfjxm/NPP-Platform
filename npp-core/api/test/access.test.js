import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { getPool, closePool } from '../src/db/pool.js';
import { startServer } from '../src/server.js';
import { CORE_API_MIGRATIONS, runMigrations } from '../src/migrations/index.js';
import { migrationVerifyWithAdapter } from '../src/migrations/cli.js';
import * as accessService from '../src/services/access.js';
import { PERMISSION_CATALOG } from '../src/access/permissions.js';
import { PERMISSIONS } from '../src/request-context.js';

function testEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3020',
    INSTALLATION_ID: 'access-test-installation',
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3003,http://127.0.0.1:3005',
    ...overrides,
  };
}

function authorizedHeaders(config) {
  return { Authorization: `Bearer ${config.backendApiToken}` };
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function roleInput(suffix, overrides = {}) {
  return {
    code: suffix,
    name: `Vai trò ${suffix}`,
    description: `Mô tả ${suffix}`,
    isActive: true,
    permissionKeys: [PERMISSIONS.coreRoleRead],
    ...overrides,
  };
}

async function parseJson(response) {
  return response.json();
}

test('Migration 008 syncs roles and permissions schema idempotently', async () => {
  const config = loadConfig(testEnv({ INSTALLATION_ID: 'access-migration-installation' }));
  const pool = getPool(config);

  const first = await runMigrations(pool, CORE_API_MIGRATIONS);
  const second = await runMigrations(pool, CORE_API_MIGRATIONS);
  const verify = await migrationVerifyWithAdapter(pool);
  const catalog = await pool.query(
    `SELECT permission_key, module, label, description, is_system
     FROM shared.permission_catalog
     ORDER BY permission_key ASC`,
  );

  assert.ok(Array.isArray(first.applied));
  assert.ok(Array.isArray(second.applied));
  assert.deepEqual(second.applied, []);
  assert.equal(verify.verified, true, verify.issues.join(', '));
  assert.equal(catalog.rows.length, PERMISSION_CATALOG.length);

  const expected = [...PERMISSION_CATALOG].sort((left, right) => left.permissionKey.localeCompare(right.permissionKey));
  const actual = [...catalog.rows].sort((left, right) => String(left.permission_key).localeCompare(String(right.permission_key)));

  assert.deepEqual(
    actual.map((row) => ({
      permissionKey: row.permission_key,
      module: row.module,
      label: row.label,
      description: row.description,
      isSystem: row.is_system,
    })),
    expected.map((entry) => ({
      permissionKey: entry.permissionKey,
      module: entry.module,
      label: entry.label,
      description: entry.description,
      isSystem: entry.isSystem,
    })),
  );
});

test('Access service enforces installation scoping, duplicate conflicts and atomic permission replacement', async () => {
  const config = loadConfig(testEnv({ INSTALLATION_ID: `access-service-${randomUUID().slice(0, 8)}` }));
  const pool = getPool(config);
  const installationId = config.installationId;
  const otherInstallationId = `${config.installationId}-other`;
  const code = `RL-${randomUUID().slice(0, 8).toUpperCase()}`;

  const created = await accessService.createRole(pool, {
    installationId,
    payload: roleInput(code, {
      name: 'Vai trò gốc',
      description: 'Vai trò gốc',
      permissionKeys: [PERMISSIONS.coreRoleRead],
    }),
    createdBy: 'test:user',
  });

  assert.ok(created.ok, created.message);
  assert.equal(created.role.code, code);
  assert.deepEqual(created.role.permission_keys, [PERMISSIONS.coreRoleRead]);

  const isolated = await accessService.createRole(pool, {
    installationId: otherInstallationId,
    payload: roleInput(code, {
      name: 'Vai trò tách biệt',
      permissionKeys: [PERMISSIONS.coreRoleWrite],
    }),
    createdBy: 'test:user',
  });
  assert.ok(isolated.ok, isolated.message);
  assert.equal(isolated.role.installation_id, otherInstallationId);

  const duplicate = await accessService.createRole(pool, {
    installationId,
    payload: roleInput(code, {
      name: 'Vai trò trùng',
      permissionKeys: [PERMISSIONS.coreRoleWrite],
    }),
    createdBy: 'test:user',
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.code, 'DUPLICATE_CODE');

  const unknownPermission = await accessService.createRole(pool, {
    installationId,
    payload: roleInput(`RL-${randomUUID().slice(0, 8).toUpperCase()}`, {
      permissionKeys: ['core.role.read', 'core.permission.invalid'],
    }),
    createdBy: 'test:user',
  });
  assert.equal(unknownPermission.ok, false);
  assert.equal(unknownPermission.code, 'INVALID_PERMISSION_KEY');

  const updated = await accessService.updateRole(pool, {
    id: created.role.id,
    installationId,
    payload: {
      code: created.role.code,
      name: 'Vai trò đã sửa',
      description: 'Mô tả đã sửa',
      isActive: false,
      permissionKeys: [PERMISSIONS.coreRoleRead, PERMISSIONS.coreRoleWrite],
      expectedUpdatedAt: created.role.updated_at,
    },
    updatedBy: 'test:user',
  });
  assert.ok(updated.ok, updated.message);
  assert.equal(updated.changed, true);
  assert.equal(updated.role.is_active, false);
  assert.deepEqual(updated.role.permission_keys, [PERMISSIONS.coreRoleRead, PERMISSIONS.coreRoleWrite]);

  const permissionRows = await pool.query(
    `SELECT permission_key
     FROM shared.role_permissions
     WHERE installation_id = $1 AND role_id = $2
     ORDER BY permission_key ASC`,
    [installationId, created.role.id],
  );
  assert.deepEqual(permissionRows.rows.map((row) => row.permission_key), [PERMISSIONS.coreRoleRead, PERMISSIONS.coreRoleWrite]);

  const staleNoOp = await accessService.updateRole(pool, {
    id: created.role.id,
    installationId,
    payload: {
      code: created.role.code,
      name: updated.role.name,
      description: updated.role.description ?? '',
      isActive: updated.role.is_active,
      permissionKeys: updated.role.permission_keys,
      expectedUpdatedAt: created.role.updated_at,
    },
    updatedBy: 'test:user',
  });
  assert.equal(staleNoOp.ok, false);
  assert.equal(staleNoOp.code, 'CONFLICT');

  const freshStatus = await accessService.updateRoleStatus(pool, {
    id: created.role.id,
    installationId,
    isActive: false,
    updatedBy: 'test:user',
    expectedUpdatedAt: updated.role.updated_at,
  });
  assert.ok(freshStatus.ok);
  assert.equal(freshStatus.changed, false);
});

test('Access service handles concurrent duplicate code races with one success and one clean conflict', async () => {
  const config = loadConfig(testEnv({ INSTALLATION_ID: 'access-race-installation' }));
  const pool = getPool(config);
  const firstClient = await pool.connect();
  const secondClient = await pool.connect();
  const code = `RL-${randomUUID().slice(0, 8).toUpperCase()}`;
  const input = {
    installationId: config.installationId,
    payload: roleInput(code, {
      name: 'Vai trò cạnh tranh',
      permissionKeys: [],
    }),
    createdBy: 'test:user',
  };

  let arrived = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const wrapClient = (client) => ({
    query: async (text, values) => {
      if (typeof text === 'string' && text.includes('INSERT INTO shared.roles')) {
        arrived += 1;
        if (arrived === 2) release();
        await gate;
      }
      return client.query(text, values);
    },
  });

  try {
    const results = await Promise.all([
      accessService.createRole(wrapClient(firstClient), input),
      accessService.createRole(wrapClient(secondClient), input),
    ]);

    assert.equal(results.filter((result) => result.ok).length, 1);
    const duplicate = results.find((result) => !result.ok);
    assert.equal(duplicate.code, 'DUPLICATE_CODE');
  } finally {
    firstClient.release();
    secondClient.release();
  }
});

test('Access service paginates across multiple pages without silent truncation', async () => {
  const config = loadConfig(testEnv({ INSTALLATION_ID: `access-pagination-${randomUUID().slice(0, 8)}` }));
  const pool = getPool(config);
  const installationId = config.installationId;
  const createdCodes = [];

  for (let index = 0; index < 28; index += 1) {
    const code = `PG-${String(index + 1).padStart(2, '0')}-${randomUUID().slice(0, 6).toUpperCase()}`;
    createdCodes.push(code);
    const result = await accessService.createRole(pool, {
      installationId,
      payload: roleInput(code, {
        name: `Vai trò ${index + 1}`,
        permissionKeys: index % 2 === 0 ? [PERMISSIONS.coreRoleRead] : [PERMISSIONS.coreRoleWrite],
      }),
      createdBy: 'test:user',
    });
    assert.ok(result.ok, result.message);
  }

  const page1 = await accessService.listRoles(pool, {
    installationId,
    active: undefined,
    search: '',
    limit: 10,
    offset: 0,
  });
  const page2 = await accessService.listRoles(pool, {
    installationId,
    active: undefined,
    search: '',
    limit: 10,
    offset: 10,
  });
  const page3 = await accessService.listRoles(pool, {
    installationId,
    active: undefined,
    search: '',
    limit: 10,
    offset: 20,
  });

  assert.equal(page1.ok, true);
  assert.equal(page2.ok, true);
  assert.equal(page3.ok, true);
  assert.equal(page1.roles.length, 10);
  assert.equal(page2.roles.length, 10);
  assert.equal(page3.roles.length, 8);

  const allCodes = [...page1.roles, ...page2.roles, ...page3.roles].map((role) => role.code);
  assert.deepEqual(allCodes.sort(), [...createdCodes].sort());
});

test('Access API enforces auth, persists audit records and returns paginated results', async () => {
  const config = loadConfig(testEnv({
    INSTALLATION_ID: `access-api-${randomUUID().slice(0, 8)}`,
    PORT: '3021',
  }));
  const pool = getPool(config);
  let server;

  try {
    server = await startServer({ config });

    const unauthorizedResponse = await fetch('http://127.0.0.1:3021/api/access/roles');
    const unauthorizedBody = await parseJson(unauthorizedResponse);
    assert.equal(unauthorizedResponse.status, 401);
    assert.equal(unauthorizedResponse.headers.get('www-authenticate'), 'Bearer');
    assert.equal(unauthorizedBody.error.code, 'UNAUTHORIZED');

    const limitedServer = await startServer({
      config: loadConfig(testEnv({
        INSTALLATION_ID: `access-api-limited-${randomUUID().slice(0, 8)}`,
        PORT: '3022',
      })),
      authenticateRequest: () => ({
        ok: true,
        principal: {
          actorId: 'test:limited',
          roles: ['bootstrap'],
          permissions: [PERMISSIONS.corePermissionRead],
          sourceApp: 'test-suite',
        },
      }),
    });

    try {
      const forbiddenResponse = await fetch('http://127.0.0.1:3022/api/access/roles', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer anything',
          'Content-Type': 'application/json',
          'Idempotency-Key': 'access-api-forbidden',
        },
        body: JSON.stringify(roleInput(`FORBIDDEN-${randomUUID().slice(0, 8).toUpperCase()}`)),
      });
      const forbiddenBody = await parseJson(forbiddenResponse);
      assert.equal(forbiddenResponse.status, 403);
      assert.equal(forbiddenBody.error.code, 'FORBIDDEN');
    } finally {
      await closeServer(limitedServer);
    }

    const roleCode = `API-${randomUUID().slice(0, 8).toUpperCase()}`;
    const createResponse = await fetch('http://127.0.0.1:3021/api/access/roles', {
      method: 'POST',
      headers: {
        ...authorizedHeaders(config),
        'Content-Type': 'application/json',
        'Idempotency-Key': `access-create-${roleCode}`,
      },
      body: JSON.stringify(roleInput(roleCode, {
        name: 'Vai trò API',
        description: 'Tạo qua API',
        permissionKeys: [PERMISSIONS.coreRoleRead],
      })),
    });
    const createBody = await parseJson(createResponse);
    assert.equal(createResponse.status, 201);
    assert.equal(createBody.data.code, roleCode);
    assert.deepEqual(createBody.data.permission_keys, [PERMISSIONS.coreRoleRead]);

    const createReplayResponse = await fetch('http://127.0.0.1:3021/api/access/roles', {
      method: 'POST',
      headers: {
        ...authorizedHeaders(config),
        'Content-Type': 'application/json',
        'Idempotency-Key': `access-create-${roleCode}`,
      },
      body: JSON.stringify(roleInput(roleCode, {
        name: 'Vai trò API',
        description: 'Tạo qua API',
        permissionKeys: [PERMISSIONS.coreRoleRead],
      })),
    });
    const createReplayBody = await parseJson(createReplayResponse);
    assert.equal(createReplayResponse.status, 201);
    assert.equal(createReplayBody.data.id, createBody.data.id);

    const listResponse = await fetch('http://127.0.0.1:3021/api/access/roles?limit=1&offset=0', {
      headers: authorizedHeaders(config),
    });
    const listBody = await parseJson(listResponse);
    assert.equal(listResponse.status, 200);
    assert.equal(listBody.data.length, 1);
    assert.equal(listBody.data[0].code, roleCode);

    const patchResponse = await fetch(`http://127.0.0.1:3021/api/access/roles/${createBody.data.id}`, {
      method: 'PATCH',
      headers: {
        ...authorizedHeaders(config),
        'Content-Type': 'application/json',
        'Idempotency-Key': `access-patch-${roleCode}`,
      },
      body: JSON.stringify({
        code: createBody.data.code,
        name: 'Vai trò API đã cập nhật',
        description: 'Đã chỉnh sửa',
        permissionKeys: [PERMISSIONS.coreRoleRead, PERMISSIONS.coreRoleWrite],
        expectedUpdatedAt: createBody.data.updated_at,
      }),
    });
    const patchBody = await parseJson(patchResponse);
    assert.equal(patchResponse.status, 200);
    assert.equal(patchBody.data.name, 'Vai trò API đã cập nhật');
    assert.deepEqual(patchBody.data.permission_keys, [PERMISSIONS.coreRoleRead, PERMISSIONS.coreRoleWrite]);

    const patchReplayResponse = await fetch(`http://127.0.0.1:3021/api/access/roles/${createBody.data.id}`, {
      method: 'PATCH',
      headers: {
        ...authorizedHeaders(config),
        'Content-Type': 'application/json',
        'Idempotency-Key': `access-patch-${roleCode}`,
      },
      body: JSON.stringify({
        code: createBody.data.code,
        name: 'Vai trò API đã cập nhật',
        description: 'Đã chỉnh sửa',
        permissionKeys: [PERMISSIONS.coreRoleRead, PERMISSIONS.coreRoleWrite],
        expectedUpdatedAt: createBody.data.updated_at,
      }),
    });
    const patchReplayBody = await parseJson(patchReplayResponse);
    assert.equal(patchReplayResponse.status, 200);
    assert.equal(patchReplayBody.data.id, patchBody.data.id);

    const auditRows = await pool.query(
      `SELECT action, before_data, after_data
       FROM shared.core_audit_records
       WHERE installation_id = $1 AND resource_type = 'role' AND resource_id = $2
       ORDER BY occurred_at ASC`,
      [config.installationId, createBody.data.id],
    );
    assert.equal(auditRows.rows.length, 2);
    assert.equal(auditRows.rows[0].action, 'create');
    assert.equal(auditRows.rows[0].before_data, null);
    assert.ok(auditRows.rows[0].after_data);
    assert.notEqual(auditRows.rows[1].before_data, null);
    assert.ok(auditRows.rows[1].after_data);

    const malformedResponse = await fetch('http://127.0.0.1:3021/api/access/roles/not-a-uuid', {
      headers: authorizedHeaders(config),
    });
    const malformedBody = await parseJson(malformedResponse);
    assert.equal(malformedResponse.status, 404);
    assert.notEqual(malformedBody.error.code, 'INTERNAL_ERROR');
  } finally {
    if (server) await closeServer(server);
  }
});

test.after(async () => {
  await closePool();
});
