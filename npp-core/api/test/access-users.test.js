import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { getPool } from '../src/db/pool.js';
import { CORE_API_MIGRATIONS, runMigrations } from '../src/migrations/index.js';
import * as userService from '../src/services/access-users.js';
import * as accessService from '../src/services/access.js';
import * as employeeService from '../src/services/employee.js';
import { PERMISSIONS } from '../src/request-context.js';

function testEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3021',
    INSTALLATION_ID: `user-test-${randomUUID().slice(0, 8)}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
    ...overrides,
  };
}

async function setupTest(overrides = {}) {
  const config = loadConfig(testEnv(overrides));
  const pool = getPool(config);
  await runMigrations(pool, CORE_API_MIGRATIONS);
  return { config, pool };
}

async function createEmployee(pool, installationId, suffix = randomUUID().slice(0, 8)) {
  const result = await employeeService.createEmployee(pool, {
    installationId,
    payload: {
      code: `EMP-${suffix}`.toUpperCase(),
      fullName: `Nhân sự ${suffix}`,
      isActive: true,
    },
    createdBy: 'test:admin',
  });
  assert.equal(result.ok, true);
  return result.employee;
}

async function createRole(pool, installationId, suffix = randomUUID().slice(0, 8)) {
  const result = await accessService.createRole(pool, {
    installationId,
    payload: {
      code: `ROLE-${suffix}`.toUpperCase(),
      name: `Vai trò ${suffix}`,
      isActive: true,
      permissionKeys: [PERMISSIONS.coreUserRead],
    },
    createdBy: 'test:admin',
  });
  assert.equal(result.ok, true);
  return result.role;
}

test('migration 009 applies idempotently and installs scoped constraints and permissions', async () => {
  const { pool } = await setupTest();
  await runMigrations(pool, CORE_API_MIGRATIONS);

  const constraints = await pool.query(
    `SELECT conname
     FROM pg_constraint
     WHERE conname = ANY($1::text[])
     ORDER BY conname`,
    [[
      'users_id_installation_unique',
      'users_installation_employee_unique',
      'users_installation_login_unique',
      'users_employee_fk',
      'user_roles_user_fk',
      'user_roles_role_fk',
    ]],
  );
  assert.deepEqual(
    constraints.rows.map((row) => row.conname),
    [
      'user_roles_role_fk',
      'user_roles_user_fk',
      'users_employee_fk',
      'users_id_installation_unique',
      'users_installation_employee_unique',
      'users_installation_login_unique',
    ],
  );

  const permissions = await pool.query(
    `SELECT permission_key
     FROM shared.permission_catalog
     WHERE permission_key = ANY($1::text[])`,
    [[PERMISSIONS.coreUserRead, PERMISSIONS.coreUserWrite, PERMISSIONS.coreUserRoleWrite]],
  );
  assert.deepEqual(
    permissions.rows.map((row) => row.permission_key).sort(),
    [PERMISSIONS.coreUserRead, PERMISSIONS.coreUserWrite, PERMISSIONS.coreUserRoleWrite].sort(),
  );
});

test('user creation normalizes login, creates zero roles and rejects role assignment in create', async () => {
  const { config, pool } = await setupTest();
  const employee = await createEmployee(pool, config.installationId);

  const created = await userService.createUser(pool, {
    installationId: config.installationId,
    payload: { employeeId: employee.id, loginName: '  Test.User  ', isActive: true },
    createdBy: 'test:admin',
  });
  assert.equal(created.ok, true);
  assert.equal(created.user.login_name, 'test.user');
  assert.deepEqual(created.user.role_ids, []);

  const secondEmployee = await createEmployee(pool, config.installationId);
  const rejected = await userService.createUser(pool, {
    installationId: config.installationId,
    payload: { employeeId: secondEmployee.id, loginName: 'with.roles', roleIds: [] },
    createdBy: 'test:admin',
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'INVALID_INPUT');
});

test('user creation enforces normalized login and one-user-per-employee conflicts', async () => {
  const { config, pool } = await setupTest();
  const employeeA = await createEmployee(pool, config.installationId, 'DUPA');
  const employeeB = await createEmployee(pool, config.installationId, 'DUPB');

  const first = await userService.createUser(pool, {
    installationId: config.installationId,
    payload: { employeeId: employeeA.id, loginName: 'Duplicate.Login' },
    createdBy: 'test:admin',
  });
  assert.equal(first.ok, true);

  const duplicateLogin = await userService.createUser(pool, {
    installationId: config.installationId,
    payload: { employeeId: employeeB.id, loginName: 'duplicate.login' },
    createdBy: 'test:admin',
  });
  assert.equal(duplicateLogin.ok, false);
  assert.equal(duplicateLogin.code, 'DUPLICATE_LOGIN');

  const duplicateEmployee = await userService.createUser(pool, {
    installationId: config.installationId,
    payload: { employeeId: employeeA.id, loginName: 'another.login' },
    createdBy: 'test:admin',
  });
  assert.equal(duplicateEmployee.ok, false);
  assert.equal(duplicateEmployee.code, 'DUPLICATE_EMPLOYEE');
});

test('inactive and cross-installation employees are rejected', async () => {
  const { config, pool } = await setupTest();
  const employee = await createEmployee(pool, config.installationId, 'INACTIVE');
  await pool.query(
    `UPDATE shared.employees SET is_active = false WHERE installation_id = $1 AND id = $2`,
    [config.installationId, employee.id],
  );

  const inactive = await userService.createUser(pool, {
    installationId: config.installationId,
    payload: { employeeId: employee.id, loginName: 'inactive.employee' },
    createdBy: 'test:admin',
  });
  assert.equal(inactive.ok, false);
  assert.equal(inactive.code, 'INVALID_EMPLOYEE_ID');

  const otherInstallation = `${config.installationId}-other`;
  const otherEmployee = await createEmployee(pool, otherInstallation, 'OTHER');
  const crossInstallation = await userService.createUser(pool, {
    installationId: config.installationId,
    payload: { employeeId: otherEmployee.id, loginName: 'cross.installation' },
    createdBy: 'test:admin',
  });
  assert.equal(crossInstallation.ok, false);
  assert.equal(crossInstallation.code, 'INVALID_EMPLOYEE_ID');
});

test('status changes use optimistic concurrency and activation checks employee state', async () => {
  const { config, pool } = await setupTest();
  const employee = await createEmployee(pool, config.installationId, 'STATUS');
  const created = await userService.createUser(pool, {
    installationId: config.installationId,
    payload: { employeeId: employee.id, loginName: 'status.user' },
    createdBy: 'test:admin',
  });

  const deactivated = await userService.updateUserStatus(pool, {
    id: created.user.id,
    installationId: config.installationId,
    payload: { isActive: false, expectedUpdatedAt: created.user.updated_at },
    updatedBy: 'test:admin',
  });
  assert.equal(deactivated.ok, true);
  assert.equal(deactivated.user.is_active, false);

  const stale = await userService.updateUserStatus(pool, {
    id: created.user.id,
    installationId: config.installationId,
    payload: { isActive: true, expectedUpdatedAt: created.user.updated_at },
    updatedBy: 'test:admin',
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, 'CONFLICT');

  await pool.query(
    `UPDATE shared.employees SET is_active = false WHERE installation_id = $1 AND id = $2`,
    [config.installationId, employee.id],
  );
  const inactiveEmployee = await userService.updateUserStatus(pool, {
    id: created.user.id,
    installationId: config.installationId,
    payload: { isActive: true, expectedUpdatedAt: deactivated.user.updated_at },
    updatedBy: 'test:admin',
  });
  assert.equal(inactiveEmployee.ok, false);
  assert.equal(inactiveEmployee.code, 'INVALID_EMPLOYEE_ID');
});

test('role replacement is scoped, rejects inactive roles and advances the user version', async () => {
  const { config, pool } = await setupTest();
  const employee = await createEmployee(pool, config.installationId, 'ROLES');
  const created = await userService.createUser(pool, {
    installationId: config.installationId,
    payload: { employeeId: employee.id, loginName: 'role.user' },
    createdBy: 'test:admin',
  });
  const role = await createRole(pool, config.installationId, 'ACTIVE');

  const assigned = await userService.replaceUserRoles(pool, {
    id: created.user.id,
    installationId: config.installationId,
    payload: { roleIds: [role.id], expectedUpdatedAt: created.user.updated_at },
    updatedBy: 'test:admin',
  });
  assert.equal(assigned.ok, true);
  assert.deepEqual(assigned.user.role_ids, [role.id]);
  assert.notEqual(new Date(assigned.user.updated_at).getTime(), new Date(created.user.updated_at).getTime());

  const noOp = await userService.replaceUserRoles(pool, {
    id: created.user.id,
    installationId: config.installationId,
    payload: { roleIds: [role.id], expectedUpdatedAt: assigned.user.updated_at },
    updatedBy: 'test:admin',
  });
  assert.equal(noOp.ok, true);
  assert.equal(noOp.changed, false);
  assert.equal(new Date(noOp.user.updated_at).toISOString(), new Date(assigned.user.updated_at).toISOString());

  const inactiveRole = await createRole(pool, config.installationId, 'INACTIVE');
  await pool.query(
    `UPDATE shared.roles SET is_active = false WHERE installation_id = $1 AND id = $2`,
    [config.installationId, inactiveRole.id],
  );
  const rejectedInactive = await userService.replaceUserRoles(pool, {
    id: created.user.id,
    installationId: config.installationId,
    payload: { roleIds: [inactiveRole.id], expectedUpdatedAt: assigned.user.updated_at },
    updatedBy: 'test:admin',
  });
  assert.equal(rejectedInactive.ok, false);
  assert.equal(rejectedInactive.code, 'INVALID_ROLE_ID');

  const otherRole = await createRole(pool, `${config.installationId}-other`, 'OTHER');
  const rejectedCrossInstallation = await userService.replaceUserRoles(pool, {
    id: created.user.id,
    installationId: config.installationId,
    payload: { roleIds: [otherRole.id], expectedUpdatedAt: assigned.user.updated_at },
    updatedBy: 'test:admin',
  });
  assert.equal(rejectedCrossInstallation.ok, false);
  assert.equal(rejectedCrossInstallation.code, 'INVALID_ROLE_ID');

  const unchanged = await userService.getUser(pool, { installationId: config.installationId, id: created.user.id });
  assert.deepEqual(unchanged.user.role_ids, [role.id]);

  const cleared = await userService.replaceUserRoles(pool, {
    id: created.user.id,
    installationId: config.installationId,
    payload: { roleIds: [], expectedUpdatedAt: assigned.user.updated_at },
    updatedBy: 'test:admin',
  });
  assert.equal(cleared.ok, true);
  assert.deepEqual(cleared.user.role_ids, []);
});

test('users are listed and read only inside their installation', async () => {
  const { config, pool } = await setupTest();
  const employee = await createEmployee(pool, config.installationId, 'SCOPE');
  const created = await userService.createUser(pool, {
    installationId: config.installationId,
    payload: { employeeId: employee.id, loginName: 'scope.user' },
    createdBy: 'test:admin',
  });

  const listed = await userService.listUsers(pool, {
    installationId: config.installationId,
    active: true,
    search: 'scope',
    limit: 100,
    offset: 0,
  });
  assert.equal(listed.ok, true);
  assert.equal(listed.users.length, 1);
  assert.equal(listed.users[0].id, created.user.id);

  const outside = await userService.getUser(pool, {
    installationId: `${config.installationId}-other`,
    id: created.user.id,
  });
  assert.equal(outside.ok, false);
  assert.equal(outside.code, 'NOT_FOUND');
});
