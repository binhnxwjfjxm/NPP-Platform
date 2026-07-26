import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { getPool, closePool } from '../src/db/pool.js';
import { startServer } from '../src/server.js';
import * as branchService from '../src/services/branch.js';
import * as employeeService from '../src/services/employee.js';

function testEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3010',
    INSTALLATION_ID: 'test-installation',
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
    ...overrides,
  };
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function createBranch(pool, installationId, suffix = randomUUID().slice(0, 8)) {
  const result = await branchService.createBranch(pool, {
    installationId,
    payload: { code: `BR-${suffix}`, name: `Chi nhánh ${suffix}` },
    createdBy: 'test:user',
  });
  assert.ok(result.ok, result.message);
  return result.branch;
}

test('Employee service — create, normalize and list by branch', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const suffix = randomUUID().slice(0, 8);
    const branch = await createBranch(pool, config.installationId, suffix);
    const result = await employeeService.createEmployee(pool, {
      installationId: config.installationId,
      payload: {
        code: `  nv-${suffix}  `,
        fullName: '  Nguyễn Văn An  ',
        jobTitle: 'Kế toán kho',
        phone: '0901234567',
        email: `AN-${suffix}@EXAMPLE.COM`,
        branchId: branch.id,
      },
      createdBy: 'test:user',
    });

    assert.ok(result.ok, result.message);
    assert.equal(result.employee.code, `NV-${suffix.toUpperCase()}`);
    assert.equal(result.employee.full_name, 'Nguyễn Văn An');
    assert.equal(result.employee.email, `an-${suffix}@example.com`);
    assert.equal(result.employee.branch_id, branch.id);

    const listed = await employeeService.listEmployees(pool, {
      installationId: config.installationId,
      branchId: branch.id,
      limit: 100,
      offset: 0,
    });
    assert.ok(listed.ok);
    assert.ok(listed.employees.some((employee) => employee.id === result.employee.id));
  } finally {
    await closePool();
  }
});

test('Employee service — rejects assignment to an inactive branch', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const branch = await createBranch(pool, config.installationId);
    const deactivated = await branchService.updateBranchStatus(pool, {
      id: branch.id,
      installationId: config.installationId,
      isActive: false,
      updatedBy: 'test:user',
      expectedUpdatedAt: branch.updated_at,
    });
    assert.ok(deactivated.ok);

    const result = await employeeService.createEmployee(pool, {
      installationId: config.installationId,
      payload: {
        code: `NV-${randomUUID().slice(0, 8)}`,
        fullName: 'Nhân sự thử nghiệm',
        branchId: branch.id,
      },
      createdBy: 'test:user',
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'BRANCH_INACTIVE');
  } finally {
    await closePool();
  }
});

test('Employee service — stale expectedUpdatedAt returns conflict', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const created = await employeeService.createEmployee(pool, {
      installationId: config.installationId,
      payload: {
        code: `NV-${randomUUID().slice(0, 8)}`,
        fullName: 'Nhân sự ban đầu',
      },
      createdBy: 'test:user',
    });
    assert.ok(created.ok);

    const first = await employeeService.updateEmployee(pool, {
      id: created.employee.id,
      installationId: config.installationId,
      payload: {
        fullName: 'Nhân sự cập nhật',
        expectedUpdatedAt: created.employee.updated_at,
      },
      updatedBy: 'test:user',
    });
    assert.ok(first.ok);
    assert.equal(first.beforeData.full_name, 'Nhân sự ban đầu');

    const stale = await employeeService.updateEmployee(pool, {
      id: created.employee.id,
      installationId: config.installationId,
      payload: {
        fullName: 'Ghi đè cũ',
        expectedUpdatedAt: created.employee.updated_at,
      },
      updatedBy: 'test:user',
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.code, 'CONFLICT');
  } finally {
    await closePool();
  }
});

test('Employee API — authenticated idempotent create writes one employee and audit record', async () => {
  const config = loadConfig(testEnv({ PORT: '3011' }));
  const pool = getPool(config);
  let server;
  try {
    const branch = await createBranch(pool, config.installationId);
    server = await startServer({ config });
    const key = `employee-${randomUUID()}`;
    const payload = {
      code: `NV-${randomUUID().slice(0, 8).toUpperCase()}`,
      fullName: 'Nhân sự qua API',
      jobTitle: 'Nhân viên kho',
      branchId: branch.id,
    };
    const request = () => fetch('http://127.0.0.1:3011/api/employees', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.backendApiToken}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
      body: JSON.stringify(payload),
    });

    const firstResponse = await request();
    assert.equal(firstResponse.status, 201);
    const firstBody = await firstResponse.json();
    assert.equal(firstBody.data.code, payload.code);

    const replayResponse = await request();
    assert.equal(replayResponse.status, 201);
    const replayBody = await replayResponse.json();
    assert.equal(replayBody.data.id, firstBody.data.id);

    const employeeCount = await pool.query(
      'SELECT count(*)::int AS count FROM shared.employees WHERE installation_id = $1 AND code = $2',
      [config.installationId, payload.code],
    );
    assert.equal(employeeCount.rows[0].count, 1);

    const auditCount = await pool.query(
      `SELECT count(*)::int AS count
       FROM shared.core_audit_records
       WHERE installation_id = $1 AND resource_type = 'employee' AND resource_id = $2`,
      [config.installationId, firstBody.data.id],
    );
    assert.equal(auditCount.rows[0].count, 1);
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});
