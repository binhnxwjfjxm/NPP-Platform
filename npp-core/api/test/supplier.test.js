import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { getPool, closePool } from '../src/db/pool.js';
import { startServer } from '../src/server.js';
import * as supplierService from '../src/services/supplier.js';
import * as employeeService from '../src/services/employee.js';

function testEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3023',
    INSTALLATION_ID: `supplier-test-${randomUUID()}`,
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

async function createEmployee(pool, installationId, suffix = randomUUID().slice(0, 8)) {
  const result = await employeeService.createEmployee(pool, {
    installationId,
    payload: { code: `NV-${suffix}`, fullName: `Nhân viên ${suffix}` },
    createdBy: 'test:user',
  });
  assert.ok(result.ok, result.message);
  return result.employee;
}

async function createSupplier(pool, installationId, suffix = randomUUID().slice(0, 8), extras = {}) {
  const result = await supplierService.createSupplier(pool, {
    installationId,
    payload: {
      code: ` ncc-${suffix} `,
      name: ` Nhà cung cấp ${suffix} `,
      taxId: `TAX-${suffix}`,
      avgDeliveryDays: 7,
      ...extras,
    },
    createdBy: 'test:user',
  });
  assert.ok(result.ok, result.message);
  return result.supplier;
}

test('Supplier service — supplier and child master data are installation scoped', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const suffix = randomUUID().slice(0, 8);
    const employee = await createEmployee(pool, config.installationId, suffix);
    const supplier = await createSupplier(pool, config.installationId, suffix, {
      purchaseOwnerEmployeeId: employee.id,
      bankAccount: `ACC-${suffix}`,
      bankName: 'Ngân hàng thử nghiệm',
    });

    assert.equal(supplier.code, `NCC-${suffix.toUpperCase()}`);
    assert.equal(supplier.purchase_owner_employee_id, employee.id);
    assert.equal(supplier.purchase_owner_employee_name, employee.full_name);

    const firstContact = await supplierService.createSupplierContact(pool, {
      installationId: config.installationId,
      supplierId: supplier.id,
      payload: { contactName: 'Liên hệ một', phone: '0901234567', isPrimary: true },
      createdBy: 'test:user',
    });
    assert.ok(firstContact.ok, firstContact.message);
    assert.equal(firstContact.contact.is_primary, true);

    const secondContact = await supplierService.createSupplierContact(pool, {
      installationId: config.installationId,
      supplierId: supplier.id,
      payload: { contactName: 'Liên hệ hai', email: 'contact@example.com', isPrimary: true },
      createdBy: 'test:user',
    });
    assert.ok(secondContact.ok, secondContact.message);

    const contacts = await supplierService.listSupplierContacts(pool, {
      installationId: config.installationId,
      supplierId: supplier.id,
    });
    assert.ok(contacts.ok);
    assert.equal(contacts.contacts.filter((item) => item.is_primary && item.is_active).length, 1);
    assert.equal(contacts.contacts.find((item) => item.id === secondContact.contact.id).is_primary, true);

    const address = await supplierService.createSupplierAddress(pool, {
      installationId: config.installationId,
      supplierId: supplier.id,
      payload: { addressType: 'Kho giao hàng', street: '1 Đường A', city: 'Thủ Đức', province: 'TP.HCM', isPrimary: true },
      createdBy: 'test:user',
    });
    assert.ok(address.ok, address.message);
    assert.equal(address.address.country, 'Việt Nam');

    const paymentTerm = await supplierService.createSupplierPaymentTerm(pool, {
      installationId: config.installationId,
      supplierId: supplier.id,
      payload: { paymentMethod: 'Chuyển khoản', termDays: 30, isPrimary: true },
      createdBy: 'test:user',
    });
    assert.ok(paymentTerm.ok, paymentTerm.message);
    assert.equal(paymentTerm.paymentTerm.term_days, 30);

    const isolated = await supplierService.getSupplier(pool, {
      installationId: `${config.installationId}-other`,
      id: supplier.id,
    });
    assert.equal(isolated.ok, false);
    assert.equal(isolated.code, 'NOT_FOUND');

    const isolatedChildren = await supplierService.listSupplierContacts(pool, {
      installationId: `${config.installationId}-other`,
      supplierId: supplier.id,
    });
    assert.equal(isolatedChildren.ok, false);
    assert.equal(isolatedChildren.code, 'NOT_FOUND');
  } finally {
    await closePool();
  }
});

test('Supplier service — stale updates and inactive-parent child creation are rejected', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const supplier = await createSupplier(pool, config.installationId);

    const first = await supplierService.updateSupplier(pool, {
      id: supplier.id,
      installationId: config.installationId,
      payload: { name: 'Nhà cung cấp mới', expectedUpdatedAt: supplier.updated_at },
      updatedBy: 'test:user',
    });
    assert.ok(first.ok, first.message);

    const stale = await supplierService.updateSupplier(pool, {
      id: supplier.id,
      installationId: config.installationId,
      payload: { name: 'Ghi đè cũ', expectedUpdatedAt: supplier.updated_at },
      updatedBy: 'test:user',
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.code, 'CONFLICT');

    const deactivated = await supplierService.updateSupplier(pool, {
      id: first.supplier.id,
      installationId: config.installationId,
      payload: { isActive: false, expectedUpdatedAt: first.supplier.updated_at },
      updatedBy: 'test:user',
    });
    assert.ok(deactivated.ok, deactivated.message);

    const rejected = await supplierService.createSupplierAddress(pool, {
      installationId: config.installationId,
      supplierId: supplier.id,
      payload: { street: '2 Đường B' },
      createdBy: 'test:user',
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, 'SUPPLIER_INACTIVE');
  } finally {
    await closePool();
  }
});

test('Supplier API — idempotent supplier and child creates write one row and audit record', async () => {
  const config = loadConfig(testEnv({ PORT: '3024' }));
  const pool = getPool(config);
  let server;
  try {
    server = await startServer({ config });
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const key = `supplier-${randomUUID()}`;
    const payload = { code: `NCC-${suffix}`, name: 'Nhà cung cấp qua API', avgDeliveryDays: 5 };
    const request = () => fetch('http://127.0.0.1:3024/api/suppliers', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.backendApiToken}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
      body: JSON.stringify(payload),
    });

    const unauthorized = await fetch('http://127.0.0.1:3024/api/suppliers');
    assert.equal(unauthorized.status, 401);

    const firstResponse = await request();
    assert.equal(firstResponse.status, 201);
    const firstBody = await firstResponse.json();
    const replayResponse = await request();
    assert.equal(replayResponse.status, 201);
    const replayBody = await replayResponse.json();
    assert.equal(replayBody.data.id, firstBody.data.id);

    const supplierCount = await pool.query(
      'SELECT count(*)::int AS count FROM shared.suppliers WHERE installation_id = $1 AND code = $2',
      [config.installationId, payload.code],
    );
    assert.equal(supplierCount.rows[0].count, 1);

    const contactKey = `supplier-contact-${randomUUID()}`;
    const contactRequest = () => fetch(`http://127.0.0.1:3024/api/suppliers/${firstBody.data.id}/contacts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.backendApiToken}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': contactKey,
      },
      body: JSON.stringify({ contactName: 'Người liên hệ API', phone: '0909999999', isPrimary: true }),
    });
    const contactFirst = await contactRequest();
    assert.equal(contactFirst.status, 201);
    const contactBody = await contactFirst.json();
    const contactReplay = await contactRequest();
    assert.equal(contactReplay.status, 201);
    const contactReplayBody = await contactReplay.json();
    assert.equal(contactReplayBody.data.id, contactBody.data.id);

    const contactCount = await pool.query(
      'SELECT count(*)::int AS count FROM shared.supplier_contacts WHERE installation_id = $1 AND supplier_id = $2',
      [config.installationId, firstBody.data.id],
    );
    assert.equal(contactCount.rows[0].count, 1);

    const auditCount = await pool.query(
      `SELECT resource_type, count(*)::int AS count
       FROM shared.core_audit_records
       WHERE installation_id = $1 AND resource_id = ANY($2::uuid[])
       GROUP BY resource_type`,
      [config.installationId, [firstBody.data.id, contactBody.data.id]],
    );
    assert.deepEqual(
      new Map(auditCount.rows.map((row) => [row.resource_type, row.count])),
      new Map([['supplier', 1], ['supplier_contact', 1]]),
    );

    const deleteResponse = await fetch(`http://127.0.0.1:3024/api/suppliers/${firstBody.data.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${config.backendApiToken}` },
    });
    assert.equal(deleteResponse.status, 405);
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});
