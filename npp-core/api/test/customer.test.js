import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { getPool, closePool } from '../src/db/pool.js';
import { startServer } from '../src/server.js';
import * as customerService from '../src/services/customer.js';
import * as employeeService from '../src/services/employee.js';

function testEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3021',
    INSTALLATION_ID: `customer-test-${randomUUID()}`,
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

async function createGroup(pool, installationId, suffix = randomUUID().slice(0, 8)) {
  const result = await customerService.createCustomerGroup(pool, {
    installationId,
    payload: { code: ` nh-${suffix} `, name: ` Nhóm ${suffix} ` },
    createdBy: 'test:user',
  });
  assert.ok(result.ok, result.message);
  return result.group;
}

async function createEmployee(pool, installationId, suffix = randomUUID().slice(0, 8)) {
  const result = await employeeService.createEmployee(pool, {
    installationId,
    payload: { code: `NV-${suffix}`, fullName: `Nhân viên ${suffix}` },
    createdBy: 'test:user',
  });
  assert.ok(result.ok, result.message);
  return result.employee;
}

test('Customer service — groups, customers, search and addresses use installation scope', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const suffix = randomUUID().slice(0, 8);
    const group = await createGroup(pool, config.installationId, suffix);
    const employee = await createEmployee(pool, config.installationId, suffix);
    assert.equal(group.code, `NH-${suffix.toUpperCase()}`);

    const created = await customerService.createCustomer(pool, {
      installationId: config.installationId,
      payload: {
        code: ` kh-${suffix} `,
        name: ' Khách hàng thử nghiệm ',
        groupId: group.id,
        responsibleEmployeeId: employee.id,
        phone: '0901234567',
        email: 'TEST@EXAMPLE.COM',
        taxCode: `TAX-${suffix}`,
        paymentTermsDays: 30,
        creditLimit: '12500000.50',
      },
      createdBy: 'test:user',
    });
    assert.ok(created.ok, created.message);
    assert.equal(created.customer.code, `KH-${suffix.toUpperCase()}`);
    assert.equal(created.customer.group_id, group.id);
    assert.equal(created.customer.responsible_employee_id, employee.id);
    assert.equal(created.customer.email, 'test@example.com');
    assert.equal(created.customer.credit_limit, '12500000.50');

    const listed = await customerService.listCustomers(pool, {
      installationId: config.installationId,
      search: suffix,
      groupId: group.id,
      limit: 100,
      offset: 0,
    });
    assert.ok(listed.ok);
    assert.ok(listed.customers.some((customer) => customer.id === created.customer.id));

    const firstAddress = await customerService.createCustomerAddress(pool, {
      installationId: config.installationId,
      customerId: created.customer.id,
      payload: { label: 'Kho chính', addressLine1: '1 Đường A', province: 'TP.HCM', isDefault: true },
      createdBy: 'test:user',
    });
    assert.ok(firstAddress.ok, firstAddress.message);
    assert.equal(firstAddress.address.is_default, true);

    const secondAddress = await customerService.createCustomerAddress(pool, {
      installationId: config.installationId,
      customerId: created.customer.id,
      payload: { label: 'Cửa hàng', addressLine1: '2 Đường B', province: 'TP.HCM', isDefault: true },
      createdBy: 'test:user',
    });
    assert.ok(secondAddress.ok, secondAddress.message);

    const addresses = await customerService.listCustomerAddresses(pool, {
      installationId: config.installationId,
      customerId: created.customer.id,
    });
    assert.ok(addresses.ok);
    assert.equal(addresses.addresses.filter((address) => address.is_default && address.is_active).length, 1);
    assert.equal(addresses.addresses.find((address) => address.id === secondAddress.address.id).is_default, true);

    const isolated = await customerService.getCustomer(pool, {
      installationId: `${config.installationId}-other`,
      id: created.customer.id,
    });
    assert.equal(isolated.ok, false);
    assert.equal(isolated.code, 'NOT_FOUND');
  } finally {
    await closePool();
  }
});

test('Customer service — stale updates and inactive relation assignments are rejected', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const suffix = randomUUID().slice(0, 8);
    const group = await createGroup(pool, config.installationId, suffix);
    const deactivated = await customerService.updateCustomerGroup(pool, {
      id: group.id,
      installationId: config.installationId,
      payload: { isActive: false, expectedUpdatedAt: group.updated_at },
      updatedBy: 'test:user',
    });
    assert.ok(deactivated.ok, deactivated.message);

    const rejected = await customerService.createCustomer(pool, {
      installationId: config.installationId,
      payload: { code: `KH-${suffix}`, name: 'Khách hàng', groupId: group.id },
      createdBy: 'test:user',
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, 'GROUP_INACTIVE');

    const created = await customerService.createCustomer(pool, {
      installationId: config.installationId,
      payload: { code: `KH2-${suffix}`, name: 'Khách hàng ban đầu', creditLimit: '0' },
      createdBy: 'test:user',
    });
    assert.ok(created.ok, created.message);

    const first = await customerService.updateCustomer(pool, {
      id: created.customer.id,
      installationId: config.installationId,
      payload: { name: 'Khách hàng mới', expectedUpdatedAt: created.customer.updated_at },
      updatedBy: 'test:user',
    });
    assert.ok(first.ok, first.message);

    const stale = await customerService.updateCustomer(pool, {
      id: created.customer.id,
      installationId: config.installationId,
      payload: { name: 'Ghi đè cũ', expectedUpdatedAt: created.customer.updated_at },
      updatedBy: 'test:user',
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.code, 'CONFLICT');
  } finally {
    await closePool();
  }
});

test('Customer API — idempotent create writes one customer and one audit record', async () => {
  const config = loadConfig(testEnv({ PORT: '3022' }));
  const pool = getPool(config);
  let server;
  try {
    server = await startServer({ config });
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const key = `customer-${randomUUID()}`;
    const payload = { code: `KH-${suffix}`, name: 'Khách hàng qua API', paymentTermsDays: 15, creditLimit: '1000000' };
    const request = () => fetch('http://127.0.0.1:3022/api/customers', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.backendApiToken}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
      body: JSON.stringify(payload),
    });

    const unauthorized = await fetch('http://127.0.0.1:3022/api/customers');
    assert.equal(unauthorized.status, 401);

    const firstResponse = await request();
    assert.equal(firstResponse.status, 201);
    const firstBody = await firstResponse.json();
    const replayResponse = await request();
    assert.equal(replayResponse.status, 201);
    const replayBody = await replayResponse.json();
    assert.equal(replayBody.data.id, firstBody.data.id);

    const customerCount = await pool.query(
      'SELECT count(*)::int AS count FROM shared.customers WHERE installation_id = $1 AND code = $2',
      [config.installationId, payload.code],
    );
    assert.equal(customerCount.rows[0].count, 1);

    const auditCount = await pool.query(
      `SELECT count(*)::int AS count
       FROM shared.core_audit_records
       WHERE installation_id = $1 AND resource_type = 'customer' AND resource_id = $2`,
      [config.installationId, firstBody.data.id],
    );
    assert.equal(auditCount.rows[0].count, 1);

    const deleteResponse = await fetch(`http://127.0.0.1:3022/api/customers/${firstBody.data.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${config.backendApiToken}` },
    });
    assert.equal(deleteResponse.status, 405);
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});
