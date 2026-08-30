import test from 'node:test';
import assert from 'node:assert/strict';
import { bulkUpdateCustomers, identifyCustomers, importCustomers } from '../src/services/customer-bulk.js';

function customer(code, overrides = {}) {
  return {
    id: `id-${code}`,
    installation_id: 'installation-test',
    code,
    name: `Khách ${code}`,
    group_id: null,
    responsible_employee_id: null,
    phone: null,
    email: null,
    tax_code: null,
    payment_terms_days: 0,
    credit_limit: '0',
    notes: null,
    is_active: true,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-30T00:00:00.000Z',
    created_by: 'test',
    updated_by: 'test',
    group_code: null,
    group_name: null,
    responsible_employee_code: null,
    responsible_employee_name: null,
    ...overrides,
  };
}

function clientFixture({ customers = [], groups = [], employees = [], maxNumber = 0 } = {}) {
  const customerMap = new Map(customers.map((item) => [item.code, item]));
  const groupMap = new Map(groups.map((item) => [item.code, item]));
  const employeeMap = new Map(employees.map((item) => [item.code, item]));
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [{ ok: true }] };
      if (sql.includes('max_number')) return { rows: [{ max_number: String(maxNumber) }] };
      if (sql.includes('FROM shared.customers c') && sql.includes('ANY($2::text[])')) {
        return { rows: (params[1] ?? []).map((code) => customerMap.get(code)).filter(Boolean) };
      }
      if (sql.includes('SELECT 1') && sql.includes('FROM shared.customers')) {
        return { rows: customerMap.has(params[1]) ? [{ '?column?': 1 }] : [] };
      }
      if (sql.includes('FROM shared.customer_groups') && sql.includes('ANY($2::text[])')) {
        return { rows: (params[1] ?? []).map((code) => groupMap.get(code)).filter(Boolean) };
      }
      if (sql.includes('FROM shared.employees') && sql.includes('ANY($2::text[])')) {
        return { rows: (params[1] ?? []).map((code) => employeeMap.get(code)).filter(Boolean) };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

test('Cập nhật KH — nhận diện theo Mã KH chính xác và chuẩn hóa chữ hoa', async () => {
  const client = clientFixture({ customers: [customer('KH001')] });
  const result = await identifyCustomers(client, {
    installationId: 'installation-test',
    payload: { rows: [{ rowNumber: 2, cells: ['kh001', 'Tên mới'] }] },
  });
  assert.equal(result.ok, true);
  assert.equal(result.identified, 1);
  assert.equal(result.rows[0].customerCode, 'KH001');
  assert.equal(result.rows[0].customerName, 'Khách KH001');
});

test('Cập nhật KH — mã không tồn tại không tự tạo khách mới', async () => {
  const result = await identifyCustomers(clientFixture(), {
    installationId: 'installation-test',
    payload: { rows: [{ rowNumber: 2, cells: ['KH404'] }] },
  });
  assert.equal(result.rows[0].errors[0].code, 'CUSTOMER_NOT_FOUND');
});

test('Cập nhật KH — mã trùng trong tệp bị loại cả hai dòng', async () => {
  const result = await identifyCustomers(clientFixture({ customers: [customer('KH001')] }), {
    installationId: 'installation-test',
    payload: { rows: [{ rowNumber: 2, cells: ['kh001'] }, { rowNumber: 3, cells: ['KH001'] }] },
  });
  assert.equal(result.identified, 0);
  assert.equal(result.skipped, 2);
  assert.equal(result.rows[0].errors[0].code, 'DUPLICATE_CUSTOMER_CODE');
  assert.equal(result.rows[1].errors[0].code, 'DUPLICATE_CUSTOMER_CODE');
});

test('Nhập KH — cho phép không có Mã KH và dry-run báo hệ thống tự sinh', async () => {
  const result = await importCustomers(clientFixture(), {
    installationId: 'installation-test',
    createdBy: 'tester',
    payload: {
      dryRun: true,
      mappings: ['NAME', 'PHONE'],
      rows: [{ rowNumber: 2, cells: ['Khách mới', '0900000000'] }],
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.ready, 1);
  assert.equal(result.rows[0].customerCode, 'Tự sinh khi nhập');
  assert.equal(result.rows[0].warnings[0].code, 'NO_DELIVERY_ADDRESS');
});

test('Nhập KH — mã có sẵn hợp lệ được giữ nguyên', async () => {
  const created = [];
  const result = await importCustomers(clientFixture(), {
    installationId: 'installation-test',
    createdBy: 'tester',
    payload: {
      dryRun: false,
      mappings: ['CUSTOMER_CODE', 'NAME'],
      rows: [{ rowNumber: 2, cells: ['kh-abc', 'Khách ABC'] }],
    },
  }, {
    createCustomer: async (_client, args) => {
      created.push(args.payload);
      return { ok: true, customer: customer(args.payload.code, { name: args.payload.name }) };
    },
  });
  assert.equal(result.created, 1);
  assert.equal(created[0].code, 'KH-ABC');
});

test('Nhập KH — mã đã tồn tại chỉ bỏ qua, không upsert', async () => {
  let createCalls = 0;
  const result = await importCustomers(clientFixture({ customers: [customer('KH001')] }), {
    installationId: 'installation-test',
    createdBy: 'tester',
    payload: {
      dryRun: false,
      mappings: ['CUSTOMER_CODE', 'NAME'],
      rows: [{ rowNumber: 2, cells: ['KH001', 'Tên khác'] }],
    },
  }, {
    createCustomer: async () => { createCalls += 1; return { ok: true, customer: customer('KH001') }; },
  });
  assert.equal(createCalls, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.rows[0].errors[0].code, 'CUSTOMER_EXISTS');
});

test('Nhập KH — mã tự sinh dùng khóa giao dịch và sinh sau mã lớn nhất', async () => {
  const created = [];
  const client = clientFixture({ maxNumber: 41 });
  const result = await importCustomers(client, {
    installationId: 'installation-test',
    createdBy: 'tester',
    payload: {
      dryRun: false,
      mappings: ['NAME'],
      rows: [{ rowNumber: 2, cells: ['Khách A'] }, { rowNumber: 3, cells: ['Khách B'] }],
    },
  }, {
    createCustomer: async (_client, args) => {
      created.push(args.payload.code);
      return { ok: true, customer: customer(args.payload.code, { name: args.payload.name }) };
    },
  });
  assert.deepEqual(created, ['KH000042', 'KH000043']);
  assert.equal(result.created, 2);
  assert.equal(client.calls.some((call) => call.sql.includes('pg_advisory_xact_lock')), true);
});

test('Nhập KH — mã tự sinh không chiếm mã được khai báo rõ trong cùng tệp', async () => {
  const created = [];
  const result = await importCustomers(clientFixture({ maxNumber: 41 }), {
    installationId: 'installation-test',
    createdBy: 'tester',
    payload: {
      dryRun: false,
      mappings: ['CUSTOMER_CODE', 'NAME'],
      rows: [
        { rowNumber: 2, cells: ['', 'Khách tự sinh'] },
        { rowNumber: 3, cells: ['KH000042', 'Khách có mã'] },
      ],
    },
  }, {
    createCustomer: async (_client, args) => {
      created.push(args.payload.code);
      return { ok: true, customer: customer(args.payload.code, { name: args.payload.name }) };
    },
  });
  assert.deepEqual(created, ['KH000043', 'KH000042']);
});

test('Cập nhật KH — dry-run trả giá trị cũ/mới và expectedUpdatedAt', async () => {
  const existing = customer('KH001', { name: 'Tên cũ', phone: '0900000000' });
  const result = await bulkUpdateCustomers(clientFixture({ customers: [existing] }), {
    installationId: 'installation-test',
    updatedBy: 'tester',
    payload: {
      dryRun: true,
      mappings: ['CUSTOMER_CODE', 'NAME', 'PHONE'],
      rows: [{ rowNumber: 2, cells: ['KH001', 'Tên mới', '0911111111'] }],
    },
  });
  assert.equal(result.ready, 1);
  assert.equal(result.rows[0].expectedUpdatedAt, existing.updated_at);
  assert.deepEqual(result.rows[0].changes.map((item) => item.label), ['Tên khách hàng', 'Điện thoại']);
});

test('Cập nhật KH — apply dùng đúng expectedUpdatedAt từ preview', async () => {
  const existing = customer('KH001', { name: 'Tên cũ' });
  const updates = [];
  const result = await bulkUpdateCustomers(clientFixture({ customers: [existing] }), {
    installationId: 'installation-test',
    updatedBy: 'tester',
    payload: {
      dryRun: false,
      mappings: ['CUSTOMER_CODE', 'NAME'],
      rows: [{ rowNumber: 2, cells: ['KH001', 'Tên mới'], expectedUpdatedAt: existing.updated_at }],
    },
  }, {
    updateCustomer: async (_client, args) => {
      updates.push(args);
      return { ok: true, changed: true, customer: { ...existing, name: args.payload.name } };
    },
  });
  assert.equal(result.updated, 1);
  assert.equal(updates[0].payload.expectedUpdatedAt, existing.updated_at);
  assert.equal(updates[0].payload.name, 'Tên mới');
});

test('Cập nhật KH — stale version bị bỏ qua, không ghi đè dữ liệu mới hơn', async () => {
  const existing = customer('KH001', { name: 'Tên hiện tại', updated_at: '2026-08-30T01:00:00.000Z' });
  let updateCalls = 0;
  const result = await bulkUpdateCustomers(clientFixture({ customers: [existing] }), {
    installationId: 'installation-test',
    updatedBy: 'tester',
    payload: {
      dryRun: false,
      mappings: ['CUSTOMER_CODE', 'NAME'],
      rows: [{ rowNumber: 2, cells: ['KH001', 'Tên từ tệp'], expectedUpdatedAt: '2026-08-30T00:00:00.000Z' }],
    },
  }, {
    updateCustomer: async () => { updateCalls += 1; return { ok: true, changed: true, customer: existing }; },
  });
  assert.equal(updateCalls, 0);
  assert.equal(result.rows[0].errors[0].code, 'STALE_CUSTOMER');
});


test('Xem trước — dữ liệu sai định dạng bị báo ngay, không chờ đến lúc áp dụng', async () => {
  const importResult = await importCustomers(clientFixture(), {
    installationId: 'installation-test',
    createdBy: 'tester',
    payload: {
      dryRun: true,
      mappings: ['NAME', 'EMAIL'],
      rows: [{ rowNumber: 2, cells: ['Khách lỗi', 'email-sai'] }],
    },
  });
  assert.equal(importResult.rows[0].errors[0].code, 'INVALID_EMAIL');

  const existing = customer('KH001');
  const updateResult = await bulkUpdateCustomers(clientFixture({ customers: [existing] }), {
    installationId: 'installation-test',
    updatedBy: 'tester',
    payload: {
      dryRun: true,
      mappings: ['CUSTOMER_CODE', 'PHONE'],
      rows: [{ rowNumber: 2, cells: ['KH001', 'abc'] }],
    },
  });
  assert.equal(updateResult.rows[0].errors[0].code, 'INVALID_PHONE');
});

test('Nhập KH — mã tự sinh gặp xung đột đồng thời thì cấp mã kế tiếp, không làm mất dòng', async () => {
  const created = [];
  let attempts = 0;
  const result = await importCustomers(clientFixture({ maxNumber: 41 }), {
    installationId: 'installation-test',
    createdBy: 'tester',
    payload: {
      dryRun: false,
      mappings: ['NAME'],
      rows: [{ rowNumber: 2, cells: ['Khách cạnh tranh'] }],
    },
  }, {
    createCustomer: async (_client, args) => {
      attempts += 1;
      created.push(args.payload.code);
      if (attempts === 1) return { ok: false, code: 'DUPLICATE_CODE', message: 'Trùng mã' };
      return { ok: true, customer: customer(args.payload.code, { name: args.payload.name }) };
    },
  });
  assert.deepEqual(created, ['KH000042', 'KH000043']);
  assert.equal(result.created, 1);
  assert.equal(result.skipped, 0);
});

test('Cập nhật KH — không gửi Mã KH vào payload sửa, chỉ dùng ID nội bộ đã truy ra', async () => {
  const existing = customer('KH001', { name: 'Tên cũ' });
  const updates = [];
  await bulkUpdateCustomers(clientFixture({ customers: [existing] }), {
    installationId: 'installation-test',
    updatedBy: 'tester',
    payload: {
      dryRun: false,
      mappings: ['CUSTOMER_CODE', 'NAME'],
      rows: [{ rowNumber: 2, cells: ['KH001', 'Tên mới'], expectedUpdatedAt: existing.updated_at }],
    },
  }, {
    updateCustomer: async (_client, args) => {
      updates.push(args);
      return { ok: true, changed: true, customer: { ...existing, name: args.payload.name } };
    },
  });
  assert.equal(updates[0].id, existing.id);
  assert.equal(Object.prototype.hasOwnProperty.call(updates[0].payload, 'code'), false);
});
