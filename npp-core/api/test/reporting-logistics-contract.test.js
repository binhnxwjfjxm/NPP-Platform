import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PERMISSIONS, PERMISSION_REGISTRY } from '../src/access/permissions.js';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('8.5 registers dedicated Logistics reporting permission and bootstrap compatibility', () => {
  assert.equal(PERMISSIONS.coreReportingLogisticsRead, 'core.reporting.logistics.read');
  assert.equal(PERMISSION_REGISTRY.has(PERMISSIONS.coreReportingLogisticsRead), true);
  const context = source('../src/request-context.js');
  assert.match(context, /PERMISSIONS\.coreReportingLogisticsRead/);
});

test('8.5 report uses canonical trip stop attempt Delivery Order and reconciliation facts', () => {
  const report = source('../src/routes/reporting-logistics.js');
  assert.match(report, /logistics\.delivery_trips/);
  assert.match(report, /logistics\.trip_stops/);
  assert.match(report, /logistics\.trip_dispatch_items/);
  assert.match(report, /logistics\.delivery_attempts/);
  assert.match(report, /logistics\.trip_return_receipts/);
  assert.match(report, /sales\.delivery_orders/);
  assert.match(report, /attempt\.id AS attempt_id/);
  assert.match(report, /attempt\.trip_stop_id/);
  assert.match(report, /attempt\.delivery_order_id/);
  assert.match(report, /delivery_order\.delivery_order_number/);
  assert.match(report, /attempt\.driver_profile_id AS driver_profile_id/);
  assert.doesNotMatch(report, /attempt\.driver_id\b/);
  assert.match(report, /planned_start_at >= \$3::timestamptz/);
  assert.match(report, /planned_start_at < \$4::timestamptz/);
  assert.match(report, /\$5::uuid IS NULL OR trip\.warehouse_id = \$5::uuid/);
});

test('8.5 on-time definition is delivered_full plus canonical planned arrival only', () => {
  const report = source('../src/routes/reporting-logistics.js');
  assert.match(report, /attempt\.result = 'delivered_full'[\s\S]*stop\.planned_arrival_at IS NOT NULL[\s\S]*attempt\.attempted_at <= stop\.planned_arrival_at/);
  assert.match(report, /full_without_plan_count/);
  assert.match(report, /sla_coverage_percent/);
  assert.match(report, /MISSING_PLANNED_ARRIVAL/);
  assert.doesNotMatch(report, /delivered_partial'[\s\S]{0,120}attempted_at <= stop\.planned_arrival_at/);
});

test('8.5 utilization does not invent a vehicle capacity percentage or JS business arithmetic', () => {
  const report = source('../src/routes/reporting-logistics.js');
  assert.match(report, /trip_duration_minutes/);
  assert.match(report, /driver\/vehicle utilization reports actual trip, stop, order, outcome counts/);
  assert.doesNotMatch(report, /capacity_weight\s*[/*+-]/i);
  assert.doesNotMatch(report, /capacity_volume\s*[/*+-]/i);
  assert.doesNotMatch(report, /capacity_(?:weight|volume).*rate_percent/i);
  assert.doesNotMatch(report, /parseFloat\(|parseInt\(|Number\(/);
});

test('8.5 reporting route is warehouse-scoped and uses the reserved permission', () => {
  const route = source('../src/routes/reporting-sales-purchasing.js');
  assert.match(route, /\/api\/reporting\/logistics/);
  assert.match(route, /coreReportingLogisticsRead/);
  assert.match(route, /logisticsReport/);
  assert.match(route, /warehouseScoped = family !== 'employee-mcp'/);
  assert.match(route, /validateScope/);
});

test('8.5 permission migration 068 is metadata-only and follows 067', () => {
  const migration = source('../../../database/migrations/shared/068_reporting_logistics_permission_catalog.sql');
  const manifest = source('../src/migrations/index.js');
  assert.match(migration, /core\.reporting\.logistics\.read/);
  assert.match(migration, /ON CONFLICT \(permission_key\) DO UPDATE/);
  assert.doesNotMatch(migration, /role_permissions|INSERT INTO shared\.role/i);
  assert.doesNotMatch(migration, /CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE/i);
  assert.ok(manifest.indexOf('067_reporting_employee_mcp_permission_catalog') < manifest.indexOf('068_reporting_logistics_permission_catalog'));
});