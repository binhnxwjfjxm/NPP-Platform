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

test('8.1 reporting dates use the locked Ho Chi Minh business boundary and bounded periods', () => {
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
  assert.equal(
    reportingInternals.normalizeFilters({ from: '2024-01-01', to: '2024-12-31' }).ok,
    true,
  );
  assert.equal(
    reportingInternals.normalizeFilters({ from: '2024-01-01', to: '2025-01-01' }).code,
    'INVALID_REPORTING_PERIOD',
  );
});

test('8.1 reporting warehouse scope normalizes UUID case and fails closed', () => {
  const filters = reportingInternals.normalizeFilters({ from: '2026-08-01', to: '2026-08-07' });
  assert.equal(filters.ok, true);

  assert.equal(
    reportingInternals.validateScope({ scopes: { warehouseIds: [] } }, filters).code,
    'WAREHOUSE_SCOPE_DENIED',
  );

  const warehouseId = '11111111-1111-4111-8111-111111111111';
  const uppercaseWarehouseId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
  const normalizedUppercase = reportingInternals.normalizeFilters({
    from: '2026-08-01',
    to: '2026-08-07',
    warehouseId: uppercaseWarehouseId,
  });
  assert.equal(normalizedUppercase.warehouseId, uppercaseWarehouseId.toLowerCase());
  assert.equal(
    reportingInternals.validateScope(
      { scopes: { warehouseIds: [uppercaseWarehouseId] } },
      normalizedUppercase,
    ).ok,
    true,
  );

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
  assert.match(route, /REPORTING_SCOPE_LOOKUP_FAILED/);
  assert.match(route, /REPORTING_QUERY_FAILED/);
  assert.match(route, /new URL\(req\.url \?\? '\/', 'http:\/\/127\.0\.0\.1'\)/);
  assert.doesNotMatch(route, /error\?\.code \?\? 'REPORTING_QUERY_FAILED'/);
  assert.match(sales, /sales\.sales_orders/);
  assert.match(sales, /sales\.sales_order_versions/);
  assert.match(sales, /version_status IN \('confirmed','superseded'\)/);
  assert.match(purchasing, /purchasing\.purchase_orders/);
  assert.match(purchasing, /purchasing\.goods_receipts/);
  assert.match(sales, /AT TIME ZONE '\$\{BUSINESS_TIMEZONE\}'/);
  assert.match(sales, /warehouse_id = ANY\(\$2::uuid\[\]\)/);
  assert.match(purchasing, /warehouse_id = ANY\(\$2::uuid\[\]\)/);
  assert.match(sales, /line\.line_total::text/);
  assert.match(sales, /sov\.total::text AS version_total/);
  assert.match(sales, /const revenues = revenueSummary\(facts\)/);
  assert.match(sales, /const reportReconciliation = reconciliation\(facts\)/);
  assert.match(purchasing, /GROUP BY currency_code/);
  assert.match(sales, /so\.status IN \('confirmed','closed'\)/);
  assert.match(purchasing, /approved','partially_received','fully_received','closed/);
  assert.match(common, /MAX_REPORTING_RANGE_DAYS = 366/);
  assert.doesNotMatch(route + common + sales + purchasing, /readJsonBody|executeRequestWithIdempotency|withAuditOutboxTransaction/);

  assert.match(server, /handleReportingRoutes/);
  assert.match(server, /reporting-sales-purchasing\.js/);
});

test('8.1 ranking groups by stable IDs and keeps canonical snapshots as display labels', () => {
  const sales = source('../src/routes/reporting-sales.js');
  const purchasing = source('../src/routes/reporting-purchasing.js');

  assert.match(sales, /customers: \(fact\) => \(\{ id: fact\.customerId, code: fact\.customerCode, name: fact\.customerName/);
  assert.match(sales, /products: \(fact\) => \(\{ id: fact\.variantId, code: fact\.sku, name: fact\.itemName/);
  assert.match(sales, /entityIdentity = identity\(dimension\.id/);
  assert.match(sales, /const groupKey = `\$\{entityIdentity\}\|\$\{text\(fact\.currencyCode\)\}\|\$\{unitIdentity\}`/);
  assert.match(sales, /customer_group_snapshot_captured/);
  assert.match(sales, /reporting_dimension_snapshot_captured/);
  assert.match(sales, /legacy-current-master/);
  assert.match(purchasing, /GROUP BY scoped\.currency_code, pol\.variant_id/);
  assert.match(purchasing, /array_agg\(pol\.sku_snapshot ORDER BY scoped\.order_date DESC, scoped\.created_at DESC, scoped\.id DESC\)/);
});

test('8.1 reporting keeps decimal values exact and string-safe for the web layer', () => {
  const sales = source('../src/routes/reporting-sales.js');
  const purchasing = source('../src/routes/reporting-purchasing.js');

  assert.match(sales, /line\.ordered_quantity::text/);
  assert.match(sales, /line\.line_total::text/);
  assert.match(sales, /function decimalText\(value\)/);
  assert.match(sales, /BigInt\(/);
  assert.match(purchasing, /COALESCE\(sum\(total\), 0::numeric\)::text/);
  assert.match(purchasing, /sum\(pol\.base_quantity\)/);
  assert.match(purchasing, /base_quantity::text/);
  assert.doesNotMatch(sales + purchasing, /parseFloat\(|parseInt\(/);
});
