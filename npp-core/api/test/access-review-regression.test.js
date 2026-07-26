import test from 'node:test';
import assert from 'node:assert/strict';
import * as accessService from '../src/services/access.js';
import { deriveRoleAuditAction } from '../src/routes/access.js';
import { PERMISSIONS } from '../src/request-context.js';

test('role audit action is derived from persisted before/after data', () => {
  const base = {
    id: 'role-1',
    is_active: true,
    permission_keys: [PERMISSIONS.coreRoleRead],
  };

  assert.equal(deriveRoleAuditAction({
    changed: false,
    beforeData: base,
    role: base,
  }), 'noop');

  assert.equal(deriveRoleAuditAction({
    changed: true,
    beforeData: base,
    role: { ...base, name: 'Đã đổi tên' },
  }), 'update');

  assert.equal(deriveRoleAuditAction({
    changed: true,
    beforeData: base,
    role: {
      ...base,
      permission_keys: [PERMISSIONS.coreRoleRead, PERMISSIONS.coreRoleWrite],
    },
  }), 'replace_permissions');

  assert.equal(deriveRoleAuditAction({
    changed: true,
    beforeData: base,
    role: {
      ...base,
      is_active: false,
      permission_keys: [PERMISSIONS.coreRoleRead, PERMISSIONS.coreRoleWrite],
    },
  }), 'deactivate');
});

test('createRole rejects a non-boolean active status before touching the database', async () => {
  let queryCount = 0;
  const client = {
    query: async () => {
      queryCount += 1;
      throw new Error('database should not be reached');
    },
  };

  const result = await accessService.createRole(client, {
    installationId: 'review-installation',
    payload: {
      code: 'REVIEW_ROLE',
      name: 'Vai trò review',
      description: '',
      isActive: 'false',
      permissionKeys: [],
    },
    createdBy: 'test:review',
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'INVALID_ACTIVE_STATUS');
  assert.equal(queryCount, 0);
});

test('listPermissions does not mutate the catalog during a read', async () => {
  const queries = [];
  const client = {
    query: async (text) => {
      queries.push(String(text));
      return { rows: [] };
    },
  };

  const result = await accessService.listPermissions(client);

  assert.deepEqual(result, []);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /^\s*SELECT /);
  assert.doesNotMatch(queries[0], /INSERT|UPDATE|DELETE/i);
});

test('updateRolePermissions rejects malformed UUIDs before querying PostgreSQL', async () => {
  let queryCount = 0;
  const client = {
    query: async () => {
      queryCount += 1;
      throw new Error('database should not be reached');
    },
  };

  const result = await accessService.updateRolePermissions(client, {
    id: 'not-a-uuid',
    installationId: 'review-installation',
    permissionKeys: [PERMISSIONS.coreRoleRead],
    updatedBy: 'test:review',
    expectedUpdatedAt: new Date().toISOString(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'INVALID_ID');
  assert.equal(queryCount, 0);
});
