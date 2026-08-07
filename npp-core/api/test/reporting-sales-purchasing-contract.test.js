import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PERMISSIONS, PERMISSION_REGISTRY } from '../src/access/permissions.js';
import { reportingInternals } from '../src/routes/reporting-sales-purchasing.js';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('8.1 registers dedicated Sales and Purchasing reporting permissions', () => {
  assert.equal(PERMISSIONS.coreReportingSalesRead, 'core.reporting.sales.read');
  assert.equal(PERMISSIONS.coreReportingPurchasingRead, 'core.reporting.purchasing.read');
  assert.equal(PERMISSION_REGISTRY.has(PERMISSIONS.coreReportingSalesRead), true);
  assert.equal(PERMISSION_REGISTRY.has(PERMISSIONS.coreReportingPurchasingRead), true);
});

test('8.1 reporting dates use the locked Ho Chi Minh business boundary', () => {
  const normalized = reportingInternals.normalizeFilters(
    { from: '2026-08-01', to: '2026-08-07' },
    new Date('2026-08-07T12:00:00.000Z'),
  );
  assert.equal(normalized.ok, true);
  assert.equal(normalized.from, '2026-08-01');
  assert.equal(normalized.to, '2026-08-07');
  assert.equal(normalized.fromInstant, '2026-07-31T17:00:00.000Z');
  assert.equal(normalized.toExclusiveInstant, '2026-08-07T17:00:00.000Z');
  assert.equal(
    reportingInternals.businessDateNow(new Date('2026-08-01T17:30:00.000Z')),
    '2026-08-02',
  );
  assert.equal(
    reportingInternals.normalizeFilters({ from: '2026-08-08', to: '2026-08-07' }).code,
    'INVALID_REPORTING_PERIOD',
  );
  assert.equal(
    reportingInternals.normalizeFilters({ from: '2026-02-31', to: '2026-08-07' }).code,
    'INVALID_REPORTING_DATE',
  );
});

test('8.1 reporting warehouse scope fails closed and never broadens a requested warehouse', () => {
  const filters = reportingInternals.normalizeFilters({ from: '2026-08-01', to: '2026-08-07' });
  assert.equal(filters.ok, true);

  assert.equal(
    reportingInternals.validateScope({ scopes: { warehouseIds: [] } }, filters).code,
    'WAREHOUSE_SCOPE_DENIED',
  );

  const warehouseId = '11111111-1111-4111-8111-111111111111';
  const outsideWarehouseId = '22222222-2222-4222-8222-222222222222';
  const scopedFilters = reportingInternals.normalizeFilters({
    from: '2026-08-01',
    to: '2026-08-07',
    warehouseId: outsideWarehouseId,
  });
  assert.equal(
    reportingInternals.validateScope(
      { scopes: { warehouseIds: [warehouseId] } },
      scopedFilters,
    ).code,
    'WAREHOUSE_SCOPE_DENIED',
  );
});

test('8.1 live queries keep canonical source, lifecycle and currency contracts explicit', () => {
  const route = source('../src/routes/reporting-sales-purchasing.js');
  const common = source('../src/routes/reporting-common.js');
  const sales = source('../src/routes/reporting-sales.js');
  const purchasing = source('../src/routes/reporting-purchasing.js');
  const server = source('../src/server.js');

  assert.match(route, /coreReportingSalesRead/);
  assert.match(route, /coreReportingPurchasingRead/);
  assert.match(sales, /sales\.sales_orders/);
  assert.match(sales, /sales\.sales_order_versions/);
  assert.match(sales, /version_status IN \('confirmed','superseded'\)/);
  assert.match(purchasing, /purchasing\.purchase_orders/);
  assert.match(purchasing, /purchasing\.goods_receipts/);
  assert.match(sales, /AT TIME ZONE '\$\{BUSINESS_TIMEZONE\}'/);
  assert.match(sales, /warehouse_id = ANY\(\$2::uuid\[\]\)/);
  assert.match(purchasing, /warehouse_id = ANY\(\$2::uuid\[\]\)/);
  assert.match(sales, /GROUP BY currency_code/);
  assert.match(purchasing, /GROUP BY currency_code/);
  assert.match(sales, /status IN \('confirmed','closed'\)/);
  assert.match(purchasing, /approved','partially_received','fully_received','closed/);
  assert.doesNotMatch(route + common + sales + purchasing, /readJsonBody|executeRequestWithIdempotency|withAuditOutboxTransaction/);

  assert.match(server, /handleReportingRoutes/);
  assert.match(server, /reporting-sales-purchasing\.js/);
});

test('8.1 reporting keeps decimal values as database strings for the web layer', () => {
  const sales = source('../src/routes/reporting-sales.js');
  const purchasing = source('../src/routes/reporting-purchasing.js');
  assert.match(sales, /sum\(total\).*::text/s);
  assert.match(purchasing, /sum\(total\).*::text/s);
  assert.match(sales, /sum\(sovl\.base_quantity\)/);
  assert.match(purchasing, /sum\(pol\.base_quantity\)/);
  assert.match(sales, /base_quantity::text/);
  assert.match(purchasing, /base_quantity::text/);
  assert.doesNotMatch(sales + purchasing, /parseFloat\(|parseInt\(/);
});
