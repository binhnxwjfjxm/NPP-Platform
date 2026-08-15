import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptUrl = new URL('../scripts/core-latest-production-gate.sh', import.meta.url);
const migrationRegistryUrl = new URL('../src/migrations/index.js', import.meta.url);

function extractPendingGuard(source) {
  const startMarker = 'PENDING_JSON="$pending" EXPECTED_PENDING_JSON="$expected_pending_json" node --input-type=module <<\'NODE\'\n';
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, 'pending guard start marker must exist');
  const programStart = start + startMarker.length;
  const end = source.indexOf('\nNODE\n}', programStart);
  assert.ok(end > programStart, 'pending guard end marker must exist');
  return source.slice(programStart, end);
}

async function runPendingGuard(program, pending, expected) {
  return execFileAsync(process.execPath, ['--input-type=module', '-e', program], {
    env: {
      ...process.env,
      PENDING_JSON: JSON.stringify(pending),
      EXPECTED_PENDING_JSON: JSON.stringify(expected),
    },
  });
}

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
  assert.match(migrationRegistry, /082_sales_fulfillment_reversal/);
  assert.match(migrationRegistry, /083_backup_delete_foundation/);
  assert.ok(
    migrationRegistry.indexOf("id: '082_sales_fulfillment_reversal'")
      < migrationRegistry.indexOf("id: '083_backup_delete_foundation'"),
    '082 must remain canonically before 083',
  );

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
  assert.match(source, /const positions = new Map\(expected\.map/);
  assert.match(source, /const seen = new Set\(\)/);
  assert.match(source, /position === undefined \|\| seen\.has\(item\) \|\| position <= previous/);
  assert.doesNotMatch(source, /expected\.length - pending\.length/);
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

test('latest Core production gate accepts canonical migration holes but rejects unknown, duplicate, or reordered pending IDs', async () => {
  const source = await readFile(scriptUrl, 'utf8');
  const program = extractPendingGuard(source);
  const expected = [
    '081_sales_fulfillment_shortage_discrepancy',
    '082_sales_fulfillment_reversal',
    '083_backup_delete_foundation',
  ];

  await assert.doesNotReject(
    runPendingGuard(program, ['082_sales_fulfillment_reversal'], expected),
    '082 must be allowed when later canonical 083 is already applied',
  );
  await assert.doesNotReject(
    runPendingGuard(program, ['081_sales_fulfillment_shortage_discrepancy', '083_backup_delete_foundation'], expected),
    'ordered canonical gaps must remain recoverable',
  );
  await assert.rejects(runPendingGuard(program, ['999_unknown_migration'], expected));
  await assert.rejects(runPendingGuard(program, ['082_sales_fulfillment_reversal', '082_sales_fulfillment_reversal'], expected));
  await assert.rejects(runPendingGuard(program, ['083_backup_delete_foundation', '082_sales_fulfillment_reversal'], expected));
});

test('latest Core production gate and workflow remain manual and assertive', async () => {
  const source = await readFile(scriptUrl, 'utf8');
  const workflow = await readFile(
    new URL('../../../.github/workflows/heroku-core-latest-migrations-manual.yml', import.meta.url),
    'utf8',
  );

  assert.match(source, /CORE_MIGRATION_PENDING=/);
  assert.match(source, /CORE_PHASE_6F_SCHEMA=/);
  assert.match(source, /CORE_PHASE_7_INVENTORY_SCHEMA=/);
  assert.match(source, /CORE_PHASE_8_REPORTING_SCHEMA=/);
  assert.match(source, /CORE_RESTORE_REHEARSAL=success/);
  assert.match(source, /CORE_PRODUCTION_PENDING=\[\]/);
  assert.match(source, /CORE_PRODUCTION_RECONCILIATION=success/);

  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.match(workflow, /\/audit-heroku-core-latest-migrations/);
  assert.match(workflow, /\/migrate-heroku-core-latest-production/);
  assert.match(workflow, /contains\(fromJSON\('\["binhnxwjfjxm","khuongbinhinfo-a11y"\]'\), github\.actor\)/);
  assert.match(workflow, /DEPLOY_REF: main/);
  assert.match(workflow, /ref: \$\{\{ env\.DEPLOY_REF \}\}/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /git fetch --prune --no-tags origin '\+refs\/heads\/main:refs\/remotes\/origin\/main'/);
  assert.match(workflow, /test "\$\(git rev-parse --is-shallow-repository\)" = "false"/);
  assert.match(workflow, /test "\$sha" = "\$\(git rev-parse origin\/main\)"/);
  assert.match(workflow, /node-version: 20/);
  assert.match(workflow, /run: npm --prefix \.\. ci --ignore-scripts/);
  assert.match(workflow, /bash -n api\/scripts\/core-latest-production-gate\.sh/);
  assert.match(workflow, /api\/test\/core-latest-production-gate-source\.test\.js/);
  assert.match(workflow, /api\/test\/heroku-core-latest-migrations-workflow-source\.test\.js/);
  assert.match(workflow, /HEROKU_API_KEY: \$\{\{ secrets\.HEROKU_API_KEY \}\}/);
  assert.match(workflow, /POSTGRES_SERVICE_CONTAINER: \$\{\{ job\.services\.postgres\.id \}\}/);
  assert.match(workflow, /CORE_GATE_EVIDENCE_FILE: \$\{\{ runner\.temp \}\}\/core-latest-migration-evidence\.txt/);
  assert.match(workflow, /REQUESTED_ACTION="\$action"/);
  assert.match(workflow, /bash npp-core\/api\/scripts\/core-latest-production-gate\.sh/);
  assert.match(workflow, /Publish sanitized rollout evidence/);
  assert.match(workflow, /SOURCE_SHA: \$\{\{ steps\.source\.outputs\.sha \}\}/);
  assert.match(workflow, /issues\/262\/comments/);

  assert.doesNotMatch(workflow, /EXPECTED_MAIN_SHA:/);
  assert.doesNotMatch(workflow, /EXPECTED_HEAD_SHA:/);
  assert.doesNotMatch(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request:/);
});
