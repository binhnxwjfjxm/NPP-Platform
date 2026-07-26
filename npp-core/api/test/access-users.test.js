import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { getPool } from '../src/db/pool.js';
import { CORE_API_MIGRATIONS, runMigrations } from '../src/migrations/index.js';
import * as accessService from '../src/services/access.js';
import * as employeeService from '../src/services/employee.js';
import { PERMISSIONS } from '../src/request-context.js';

function testEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3021',
    INSTALLATION_ID: 'user-test-installation',
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
    ...overrides,
  };
}

async function setupTest() {
  const config = loadConfig(testEnv({ INSTALLATION_ID: `user-test-${randomUUID().slice(0, 8)}` }));
  const pool = getPool(config);
  await runMigrations(pool, CORE_API_MIGRATIONS);
  return { config, pool };
}

test('User creation requires valid employee and login name', async () => {
  const { config, pool } = await setupTest();
  const installationId = config.installationId;
  const adminId = 'test:admin';

  // Create a test employee
  const employee = await employeeService.createEmployee(pool, {
    installationId,
    payload: {
      code: `EMP-${randomUUID().slice(0, 8)}`,
      fullName: 'Test Employee',
      isActive: true,
    },
    createdBy: adminId,
  });
  assert.ok(employee.ok);

  // Create user with valid employee
  const userResult = await accessService.createUser(pool, {
    installationId,
    payload: {
      employeeId: employee.employee.id,
      loginName: 'test.user',
      isActive: true,
    },
    createdBy: adminId,
  });
  assert.equal(userResult.ok, true);
  assert.ok(userResult.user.id);
  assert.equal(userResult.user.employee_id, employee.employee.id);
  assert.equal(userResult.user.login_name, 'test.user');
  assert.equal(userResult.user.is_active, true);
  assert.deepEqual(userResult.user.role_ids, []);
});

test('User creation enforces duplicate login and employee constraints', async () => {
  const { config, pool } = await setupTest();
  const installationId = config.installationId;
  const adminId = 'test:admin';

  // Create employee
  const employee = await employeeService.createEmployee(pool, {
    installationId,
    payload: {
      code: `EMP-${randomUUID().slice(0, 8)}`,
      fullName: 'Employee A',
      isActive: true,
    },
    createdBy: adminId,
  });
  assert.ok(employee.ok);

  // Create user
  const user1 = await accessService.createUser(pool, {
    installationId,
    payload: {
      employeeId: employee.employee.id,
      loginName: 'duplicate.login',
      isActive: true,
    },
    createdBy: adminId,
  });
  assert.equal(user1.ok, true);

  // Duplicate login should fail
  const employment2 = await employeeService.createEmployee(pool, {
    installationId,
    payload: {
      code: `EMP-${randomUUID().slice(0, 8)}`,
      fullName: 'Employee B',
      isActive: true,
    },
    createdBy: adminId,
  });
  const user2 = await accessService.createUser(pool, {
    installationId,
    payload: {
      employeeId: employment2.employee.id,
      loginName: 'duplicate.login',
      isActive: true,
    },
    createdBy: adminId,
  });
  assert.equal(user2.ok, false);
  assert.equal(user2.code, 'DUPLICATE_LOGIN');

  // Duplicate employee should fail
  const user3 = await accessService.createUser(pool, {
    installationId,
    payload: {
      employeeId: employee.employee.id,
      loginName: 'unique.login',
      isActive: true,
    },
    createdBy: adminId,
  });
  assert.equal(user3.ok, false);
  assert.equal(user3.code, 'DUPLICATE_EMPLOYEE');
});

test('User status updates with optimistic locking', async () => {
  const { config, pool } = await setupTest();
  const installationId = config.installationId;
  const adminId = 'test:admin';

  // Setup employee and user
  const employee = await employeeService.createEmployee(pool, {
    installationId,
    payload: {
      code: `EMP-${randomUUID().slice(0, 8)}`,
      fullName: 'Status Test Employee',
      isActive: true,
    },
    createdBy: adminId,
  });

  const user = await accessService.createUser(pool, {
    installationId,
    payload: {
      employeeId: employee.employee.id,
      loginName: 'status.test',
      isActive: true,
    },
    createdBy: adminId,
  });
  assert.equal(user.ok, true);

  // Deactivate
  const deactivated = await accessService.updateUserStatus(pool, {
    id: user.user.id,
    installationId,
    payload: {
      isActive: false,
      expectedUpdatedAt: user.user.updated_at,
    },
    updatedBy: adminId,
  });
  assert.equal(deactivated.ok, true);
  assert.equal(deactivated.user.is_active, false);

  // Conflict on stale timestamp
  const conflict = await accessService.updateUserStatus(pool, {
    id: user.user.id,
    installationId,
    payload: {
      isActive: true,
      expectedUpdatedAt: user.user.updated_at, // old value
    },
    updatedBy: adminId,
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, 'CONFLICT');
});

test('User role assignment and replacement', async () => {
  const { config, pool } = await setupTest();
  const installationId = config.installationId;
  const adminId = 'test:admin';

  // Create roles
  const role1 = await accessService.createRole(pool, {
    installationId,
    payload: {
      code: `ROLE1-${randomUUID().slice(0, 8)}`,
      name: 'Role 1',
      isActive: true,
      permissionKeys: [PERMISSIONS.coreUserRead],
    },
    createdBy: adminId,
  });

  const role2 = await accessService.createRole(pool, {
    installationId,
    payload: {
      code: `ROLE2-${randomUUID().slice(0, 8)}`,
      name: 'Role 2',
      isActive: true,
      permissionKeys: [PERMISSIONS.coreUserWrite],
    },
    createdBy: adminId,
  });

  // Create employee and user
  const employee = await employeeService.createEmployee(pool, {
    installationId,
    payload: {
      code: `EMP-${randomUUID().slice(0, 8)}`,
      fullName: 'Role Test Employee',
      isActive: true,
    },
    createdBy: adminId,
  });

  const user = await accessService.createUser(pool, {
    installationId,
    payload: {
      employeeId: employee.employee.id,
      loginName: 'role.test',
      isActive: true,
      roleIds: [role1.role.id],
    },
    createdBy: adminId,
  });
  assert.equal(user.ok, true);
  assert.deepEqual(user.user.role_ids, [role1.role.id]);

  // Replace roles
  const updated = await accessService.replaceUserRoles(pool, {
    id: user.user.id,
    installationId,
    payload: {
      roleIds: [role2.role.id],
      expectedUpdatedAt: user.user.updated_at,
    },
    updatedBy: adminId,
  });
  assert.equal(updated.ok, true);
  assert.deepEqual(updated.user.role_ids, [role2.role.id]);

  // Clear roles
  const cleared = await accessService.replaceUserRoles(pool, {
    id: user.user.id,
    installationId,
    payload: {
      roleIds: [],
      expectedUpdatedAt: updated.user.updated_at,
    },
    updatedBy: adminId,
  });
  assert.equal(cleared.ok, true);
  assert.deepEqual(cleared.user.role_ids, []);
});

test('User listing with filters', async () => {
  const { config, pool } = await setupTest();
  const installationId = config.installationId;
  const adminId = 'test:admin';

  // Create multiple users
  const employees = [];
  const users = [];
  for (let i = 0; i < 3; i++) {
    const emp = await employeeService.createEmployee(pool, {
      installationId,
      payload: {
        code: `EMP-LIST-${i}`,
        fullName: `Employee ${i}`,
        isActive: true,
      },
      createdBy: adminId,
    });
    employees.push(emp.employee);

    const u = await accessService.createUser(pool, {
      installationId,
      payload: {
        employeeId: emp.employee.id,
        loginName: `user.${i}`,
        isActive: i !== 2, // last user inactive
      },
      createdBy: adminId,
    });
    users.push(u.user);
  }

  // List all
  const allUsers = await accessService.listUsers(pool, {
    installationId,
    active: undefined,
    limit: 1000,
    offset: 0,
  });
  assert.ok(allUsers.ok);
  assert.equal(allUsers.users.length, 3);

  // List active only
  const activeUsers = await accessService.listUsers(pool, {
    installationId,
    active: true,
    limit: 1000,
    offset: 0,
  });
  assert.ok(activeUsers.ok);
  assert.equal(activeUsers.users.length, 2);

  // List inactive only
  const inactiveUsers = await accessService.listUsers(pool, {
    installationId,
    active: false,
    limit: 1000,
    offset: 0,
  });
  assert.ok(inactiveUsers.ok);
  assert.equal(inactiveUsers.users.length, 1);
});

test('User is scoped to installation', async () => {
  const installationId = `user-scope-${randomUUID().slice(0, 8)}`;
  const otherInstallationId = `${installationId}-other`;
  const config = loadConfig(testEnv({ INSTALLATION_ID: installationId }));
  const pool = getPool(config);
  await runMigrations(pool, CORE_API_MIGRATIONS);

  const adminId = 'test:admin';

  // Create employee in installation 1
  const emp1 = await employeeService.createEmployee(pool, {
    installationId,
    payload: {
      code: 'EMP-SCOPE',
      fullName: 'Test Employee',
      isActive: true,
    },
    createdBy: adminId,
  });

  // Create user in installation 1
  const user1 = await accessService.createUser(pool, {
    installationId,
    payload: {
      employeeId: emp1.employee.id,
      loginName: 'scope.test',
      isActive: true,
    },
    createdBy: adminId,
  });
  assert.equal(user1.ok, true);

  // Try to access from different installation  
  const notFound = await accessService.getUser(pool, {
    installationId: otherInstallationId,
    id: user1.user.id,
  });
  assert.equal(notFound.ok, false);
  assert.equal(notFound.code, 'NOT_FOUND');
});
