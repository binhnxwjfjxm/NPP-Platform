import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import { loadConfig } from '../src/config.js';
import { closePool, getPool } from '../src/db/pool.js';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';

function testEnv() {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3096',
    INSTALLATION_ID: 'business-purge-operational-guards-regression',
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3007',
  };
}

const config = loadConfig(testEnv());
const pool = getPool(config);
after(async () => { await closePool(); });

const GUARDED_TABLES = Object.freeze([
  ['sales', 'sales_order_versions', 'sales_order_versions_immutable'],
  ['sales', 'sales_order_version_lines', 'sales_order_version_lines_draft_only'],
  ['sales', 'sales_order_fulfillment_shortages', 'sales_order_fulfillment_shortages_guard'],
  ['sales', 'sales_order_fulfillment_pick_closures', 'sales_order_fulfillment_pick_closures_guard'],
  ['sales', 'sales_order_fulfillment_reversal_batches', 'sales_order_fulfillment_reversal_batches_write_guard'],
  ['accounting', 'receivable_allocations', 'receivable_allocations_write_guard'],
  ['accounting', 'receivable_allocation_reversals', 'receivable_allocation_reversals_write_guard'],
  ['accounting', 'customer_return_adjustment_lines', 'customer_return_adjustment_lines_write_guard'],
  ['accounting', 'customer_return_adjustment_reversals', 'customer_return_adjustment_reversals_write_guard'],
  ['accounting', 'customer_refunds', 'customer_refunds_write_guard'],
  ['accounting', 'customer_refund_reversals', 'customer_refund_reversals_write_guard'],
  ['accounting', 'customer_receivable_balances', 'customer_receivable_balances_write_guard'],
  ['accounting', 'cod_collections', 'cod_collections_write_guard'],
  ['accounting', 'cod_collection_reversals', 'cod_collection_reversals_write_guard'],
  ['accounting', 'cod_cash_handovers', 'cod_cash_handovers_write_guard'],
  ['accounting', 'cod_cash_handover_lines', 'cod_cash_handover_lines_write_guard'],
  ['accounting', 'cod_cash_handover_reversals', 'cod_cash_handover_reversals_write_guard'],
  ['accounting', 'cod_cash_acceptances', 'cod_cash_acceptances_write_guard'],
  ['accounting', 'cod_cash_acceptance_reversals', 'cod_cash_acceptance_reversals_write_guard'],
  ['inventory', 'inventory_balances', 'inventory_balances_writer_guard'],
  ['inventory', 'inventory_lots', 'inventory_lots_append_only'],
  ['inventory', 'opening_balance_imports', 'opening_balance_imports_append_only'],
  ['inventory', 'opening_balance_import_rows', 'opening_balance_import_rows_append_only'],
  ['inventory', 'inventory_adjustment_posted_scopes', 'inventory_adjustment_posted_scope_guard'],
  ['inventory', 'inventory_discrepancy_observations', 'inventory_discrepancy_observations_guard'],
  ['inventory', 'inventory_reservation_issue_adjustments', 'inventory_reservation_issue_adjustments_write_guard'],
  ['inventory', 'inventory_transfers', 'inventory_transfers_locked_state_guard'],
  ['inventory', 'inventory_transfer_lines', 'inventory_transfer_lines_locked_state_guard'],
  ['inventory', 'inventory_transfer_receipts', 'inventory_transfer_receipts_append_only'],
  ['inventory', 'inventory_transfer_receipt_lines', 'inventory_transfer_receipt_lines_append_only'],
  ['inventory', 'inventory_transfer_damage_approvals', 'inventory_transfer_damage_approvals_append_only'],
  ['inventory', 'inventory_transfer_short_closures', 'inventory_transfer_short_closures_append_only'],
  ['inventory', 'inventory_transfer_short_closure_lines', 'inventory_transfer_short_closure_lines_append_only'],
  ['inventory', 'inventory_transfer_receipt_reversals', 'inventory_transfer_receipt_reversals_append_only'],
  ['inventory', 'inventory_cost_rebuild_runs', 'inventory_cost_runs_append_only'],
  ['inventory', 'inventory_cost_facts', 'inventory_cost_facts_append_only'],
  ['inventory', 'inventory_cost_anomalies', 'inventory_cost_anomalies_append_only'],
  ['inventory', 'inventory_cost_balances', 'inventory_cost_balances_projector_only'],
  ['inventory', 'inventory_costing_periods', 'inventory_costing_periods_transition_guard'],
  ['inventory', 'inventory_cost_period_balances', 'inventory_cost_period_balances_append_only'],
  ['inventory', 'inventory_cost_adjustment_events', 'inventory_cost_adjustment_events_append_only'],
  ['inventory', 'manual_inbound_documents', 'manual_inbound_documents_append_only'],
  ['inventory', 'manual_inbound_document_lines', 'manual_inbound_document_lines_append_only'],
  ['logistics', 'trip_return_receipts', 'trip_return_receipts_write_guard'],
  ['logistics', 'trip_return_receipt_lines', 'trip_return_receipt_lines_write_guard'],
  ['mcp', 'audit_events', 'mcp_audit_events_append_only'],
]);

const CONTEXT_GUARDS = Object.freeze([
  ['logistics', 'delivery_trips', 'delivery_trips_recovery_guard', 'trip_recovery_service', 'delivery_trips_purge_delete_guard'],
  ['logistics', 'delivery_trips', 'delivery_trips_sales_order_unwind_guard', 'sales_order_unwind_service', 'delivery_trips_purge_delete_guard'],
  ['logistics', 'trip_order_assignments', 'trip_order_assignments_recovery_guard', 'trip_recovery_service', 'trip_order_assignments_purge_delete_guard'],
  ['logistics', 'trip_order_assignments', 'trip_order_assignments_sales_order_unwind_guard', 'sales_order_unwind_service', 'trip_order_assignments_purge_delete_guard'],
  ['sales', 'delivery_order_events', 'delivery_order_events_reversal_guard', 'delivery_reversal_service', 'delivery_order_events_purge_delete_guard'],
]);

function triggerKey(schemaName, tableName, triggerName) {
  return `${schemaName}.${tableName}.${triggerName}`;
}

async function loadDomainTriggers() {
  return pool.query(`
    SELECT ns.nspname AS schema_name,
           rel.relname AS table_name,
           trg.tgname AS trigger_name,
           pg_get_triggerdef(trg.oid, true) AS trigger_definition,
           pg_get_functiondef(proc.oid) AS function_definition
      FROM pg_trigger trg
      JOIN pg_class rel ON rel.oid = trg.tgrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
      JOIN pg_proc proc ON proc.oid = trg.tgfoid
     WHERE NOT trg.tgisinternal
       AND ns.nspname IN ('sales', 'purchasing', 'inventory', 'accounting', 'reporting', 'logistics', 'mcp')
  `);
}

test('business purge migration 105 keeps guarded delete explicit and registered', async () => {
  const entry = CORE_API_MIGRATIONS.find((item) => item.id === '105_business_purge_remaining_operational_guards');
  assert.ok(entry, 'migration 105 must be registered');

  const sql = await readFile(
    new URL('../../../database/migrations/shared/105_business_purge_remaining_operational_guards.sql', import.meta.url),
    'utf8',
  );
  assert.match(sql, /business_purge_delete_allowed/);
  assert.match(sql, /guard_business_purge_delete/);
  for (const [schemaName, tableName] of GUARDED_TABLES) {
    assert.match(sql, new RegExp(`['\\"]${schemaName}['\\"]\\s*,\\s*['\\"]${tableName}['\\"]`));
  }
  for (const [, , triggerName] of CONTEXT_GUARDS) {
    assert.match(sql, new RegExp(`CREATE\\s+TRIGGER\\s+${triggerName}`, 'i'));
  }
  assert.doesNotMatch(sql, /DISABLE\s+TRIGGER|session_replication_role|TRUNCATE|DROP\s+SCHEMA/i);
});

test('migration 105 preserves ordinary guards and adds authorised purge delete guards', async () => {
  const triggerRows = await loadDomainTriggers();
  const byKey = new Map(triggerRows.rows.map((row) => [
    triggerKey(row.schema_name, row.table_name, row.trigger_name),
    row,
  ]));

  for (const [schemaName, tableName, originalTrigger] of GUARDED_TABLES) {
    const tableExists = await pool.query('SELECT to_regclass($1) AS table_name', [`${schemaName}.${tableName}`]);
    if (!tableExists.rows[0]?.table_name) continue;

    const original = byKey.get(triggerKey(schemaName, tableName, originalTrigger));
    assert.ok(original, `${schemaName}.${tableName} must retain ${originalTrigger}`);
    assert.doesNotMatch(original.trigger_definition, /BEFORE\s+[^\n]*DELETE\s+ON/i);

    const ordinaryName = `${tableName}_delete_guard`;
    const ordinary = byKey.get(triggerKey(schemaName, tableName, ordinaryName));
    assert.ok(ordinary, `${schemaName}.${tableName} must keep its ordinary DELETE contract`);
    assert.match(ordinary.trigger_definition, /BEFORE\s+DELETE\s+ON/i);
    assert.match(ordinary.trigger_definition, /NOT\s+shared\.business_purge_delete_allowed/i);

    const purgeName = `${tableName}_purge_delete_guard`;
    const purge = byKey.get(triggerKey(schemaName, tableName, purgeName));
    assert.ok(purge, `${schemaName}.${tableName} must have an authorised purge DELETE guard`);
    assert.match(purge.trigger_definition, /BEFORE\s+DELETE\s+ON/i);
    assert.match(purge.trigger_definition, /shared\.business_purge_delete_allowed/i);
    assert.match(purge.function_definition, /guard_business_purge_delete|business_purge_delete_allowed/i);
  }
});

test('context-specific recovery, unwind and reversal guards leave DELETE to the table purge guard', async () => {
  const triggerRows = await loadDomainTriggers();
  const byKey = new Map(triggerRows.rows.map((row) => [
    triggerKey(row.schema_name, row.table_name, row.trigger_name),
    row,
  ]));

  for (const [schemaName, tableName, triggerName, writeContext, purgeTriggerName] of CONTEXT_GUARDS) {
    const specialised = byKey.get(triggerKey(schemaName, tableName, triggerName));
    assert.ok(specialised, `${schemaName}.${tableName} must retain ${triggerName}`);
    assert.match(specialised.trigger_definition, /BEFORE\s+(?:INSERT\s+OR\s+UPDATE|UPDATE\s+OR\s+INSERT)\s+ON/i);
    assert.doesNotMatch(specialised.trigger_definition, /DELETE/i);
    assert.match(specialised.trigger_definition, new RegExp(writeContext));

    const purge = byKey.get(triggerKey(schemaName, tableName, purgeTriggerName));
    assert.ok(purge, `${schemaName}.${tableName} must retain ${purgeTriggerName}`);
    assert.match(purge.trigger_definition, /BEFORE\s+DELETE\s+ON/i);
    assert.match(purge.function_definition, /guard_business_purge_delete|business_purge_delete_allowed/i);
  }
});

test('every domain BEFORE DELETE trigger reachable by business purge is purge-aware', async () => {
  const rows = await pool.query(`
    SELECT ns.nspname AS schema_name,
           rel.relname AS table_name,
           trg.tgname AS trigger_name,
           pg_get_triggerdef(trg.oid, true) AS trigger_definition,
           pg_get_functiondef(proc.oid) AS function_definition
      FROM pg_trigger trg
      JOIN pg_class rel ON rel.oid = trg.tgrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
      JOIN pg_proc proc ON proc.oid = trg.tgfoid
     WHERE NOT trg.tgisinternal
       AND (trg.tgtype & 2) = 2
       AND (trg.tgtype & 8) = 8
       AND ns.nspname IN ('sales', 'purchasing', 'inventory', 'accounting', 'reporting', 'logistics', 'mcp')
       AND NOT (ns.nspname = 'mcp' AND rel.relname IN ('mcp_report_setting_groups', 'mcp_report_settings'))
     ORDER BY ns.nspname, rel.relname, trg.tgname
  `);

  const unsafe = rows.rows.filter((row) => {
    const contract = `${row.trigger_definition}\n${row.function_definition}`;
    return !/business_purge_delete_allowed|guard_business_purge_delete/i.test(contract);
  });
  assert.deepEqual(
    unsafe.map((row) => `${row.schema_name}.${row.table_name}.${row.trigger_name}`),
    [],
    'all user-defined BEFORE DELETE guards in purge-owned domains must recognise the authorised purge context',
  );
});
