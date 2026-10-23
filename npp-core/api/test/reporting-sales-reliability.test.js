import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeReportingFailure } from '../src/routes/reporting-sales-purchasing.js';
import { reportingSalesInternals, salesScopeWarehouses } from '../src/routes/reporting-sales.js';

test('Báo cáo bán hàng trả lỗi đối soát riêng, nêu đơn lệch tiền và không biến thành 503', () => {
  const facts = [
    { period: 'current', salesOrderId: 'o1', orderNumber: 'SO001316', currencyCode: 'VND', versionTotal: '120', lineTotal: '80' },
    { period: 'current', salesOrderId: 'o1', orderNumber: 'SO001316', currencyCode: 'VND', versionTotal: '120', lineTotal: '30' },
  ];
  let mismatch;
  assert.throws(() => reportingSalesInternals.reconciliation(facts), (error) => {
    mismatch = error;
    return error.code === 'SALES_REPORT_RECONCILIATION_FAILED'
      && error.details.mismatches[0].versionTotal === '120'
      && error.details.mismatches[0].lineTotal === '110';
  });
  const result = normalizeReportingFailure(mismatch, 'sales');
  assert.equal(result.statusCode, 409);
  assert.equal(result.code, 'SALES_REPORT_RECONCILIATION_FAILED');
  assert.deepEqual(result.details.mismatches.map((row) => row.orderNumber), ['SO001316']);
  assert.equal(normalizeReportingFailure(mismatch, 'purchasing').code, 'REPORTING_QUERY_FAILED');
  assert.equal(normalizeReportingFailure(Object.assign(new Error('timeout'), { code: '57014' }), 'sales').statusCode, 503);
});

test('Danh sách kho báo cáo chỉ lấy trong quyền kho, không tải báo cáo nặng', async () => {
  const requests = [];
  const adapter = { query: async (sql, params) => { requests.push({ sql, params }); return { rows: [] }; } };
  await salesScopeWarehouses(adapter, { installationId: 'tenant-a' }, ['warehouse-a']);
  assert.equal(requests.length, 1);
  assert.match(requests[0].sql, /FROM shared\.warehouses warehouse/);
  assert.match(requests[0].sql, /warehouse\.id = ANY\(\$2::uuid\[\]\)/);
  assert.deepEqual(requests[0].params, ['tenant-a', ['warehouse-a']]);
});

test('Chỉ mục ngày xác nhận đơn là migration riêng, không sửa bảng chứng từ', () => {
  const migration = readFileSync(new URL('../../../database/migrations/sales/168_sales_reporting_confirmed_date_index.sql', import.meta.url), 'utf8');
  const registry = readFileSync(new URL('../src/migrations/index.js', import.meta.url), 'utf8');
  assert.match(migration, /sales\.sales_orders \(installation_id, confirmed_at, warehouse_id\)/);
  assert.match(registry, /168_sales_reporting_confirmed_date_index/);
  assert.doesNotMatch(migration, /UPDATE |DELETE |ALTER TABLE |DROP /i);
});
