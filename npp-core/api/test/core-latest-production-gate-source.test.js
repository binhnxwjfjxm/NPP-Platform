import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const scriptUrl = new URL('../scripts/core-latest-production-gate.sh', import.meta.url);
const migrationRegistryUrl = new URL('../src/migrations/index.js', import.meta.url);

test('latest Core production gate derives protected pending migrations from the canonical registry', async () => {
  const [source, migrationRegistry] = await Promise.all([
    readFile(scriptUrl, 'utf8'),
    readFile(migrationRegistryUrl, 'utf8'),
  ]);

  assert.match(source, /import \{ CORE_API_MIGRATIONS \} from "\.\/npp-core\/api\/src\/migrations\/index\.js"/);
  assert.match(source, /const protectedMigrationIds = CORE_API_MIGRATIONS/);
  assert.match(source, /Number\.parseInt\(id\.slice\(0, 3\), 10\)/);
  assert.match(source, /numericPrefix >= 42/);
  assert.doesNotMatch(source, /expected_pending_json='\[/);
  assert.match(migrationRegistry, /071_customer_portal_order_intake/);
  assert.match(migrationRegistry, /072_customer_portal_registration_onboarding/);
  assert.match(migrationRegistry, /073_internal_workforce_auth/);
  assert.match(migrationRegistry, /074_internal_web_login_challenge/);

  for (const marker of [
    'assert_allowed_pending',
    'assert_phase6f_schema',
    'assert_phase7_inventory_schema',
    'assert_phase8_reporting_schema',
    'phase7inventory',
    'phase8reporting',
    'pg:backups:capture',
    'pg_dump',
    'pg_restore',
    'restore_verify',
    'maintenance:on',
    'maintenance:off',
    'production_verify',
    'assert_counts_unchanged',
    '/health/live',
    '/health/ready',
    'logistics.delivery_attempts',
    'accounting.receivable_documents',
    'reporting.phase6f_closeout_anomalies',
    'inventory.inventory_transfers',
    'inventory.stocktakes',
    'inventory.inventory_adjustments',
    'inventory.inventory_cost_rebuild_runs',
    'inventory.inventory_cost_reconciliation',
    'inventory.inventory_costing_periods',
    'inventory.inventory_cost_period_balances',
    'inventory.inventory_cost_adjustment_events',
    'inventory.inventory_cost_discrepancies',
    'reporting.import_export_jobs',
    'core.reporting.sales.read',
    'core.reporting.inventory.read',
    'core.reporting.aging.read',
    'core.reporting.gross-margin.read',
    'core.reporting.employee-mcp.read',
    'core.reporting.logistics.read',
    'core.reporting.cod.read',
    'core.reporting.audit-history.read',
    'core.reporting.control-tower.read',
    'core.reporting.export',
    'core.inventory-transfer.receive',
    'core.stocktake.post',
    'core.inventory-adjustment.post',
    'core.inventory-cost.rebuild',
    'CORE_PHASE_7_INVENTORY_SCHEMA=ready',
    'CORE_PHASE_8_REPORTING_SCHEMA=ready',
    'sales.sales_order_version_lines=',
    'inventory.inventory_movements=',
  ]) assert.ok(source.includes(marker), `missing ${marker}`);

  assert.ok(!source.includes('sales.sales_order_lines='));
  assert.match(source, /FROM sales\.sales_order_version_lines/);
  assert.match(source, /test "\$HEROKU_APP_NAME" = "hung-phat"/);
  assert.match(source, /pending\.every/);
  assert.match(source, /migrationIdsInRange\(firstMigration, lastMigration\)/);
  assert.match(source, /verifyCatalog\([\s\S]*?, 46, 57\)/);
  assert.match(source, /verifyCatalog\([\s\S]*?, 58, 63\)/);
  assert.match(source, /verifyCatalog\([\s\S]*?, 64, 70\)/);
  assert.doesNotMatch(source, /CORE_API_MIGRATIONS\.slice\(-12\)/);
  assert.doesNotMatch(source, /CORE_API_MIGRATIONS\.slice\(-5\)/);
  assert.match(source, /CORE_PHASE_6F_SCHEMA=ready/);
  assert.match(source, /CORE_PHASE_7_INVENTORY_SCHEMA=ready/);
  assert.match(source, /CORE_PHASE_8_REPORTING_SCHEMA=ready/);
  assert.doesNotMatch(source, /CORE_PHASE_6E_SCHEMA/);
});
