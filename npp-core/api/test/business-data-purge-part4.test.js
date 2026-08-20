import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import { loadConfig } from '../src/config.js';
import { closePool, getPool } from '../src/db/pool.js';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';
import {
  BUSINESS_PURGE_TARGETS,
  buildBusinessPurgePlan,
  executeDeletionIntent,
} from '../src/services/business-data-purge.js';

function testEnv() {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3096',
    INSTALLATION_ID: `business-purge-${randomUUID()}`,
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

function context(installationId, requestId = `purge_${randomUUID()}`) {
  return {
    installationId,
    actorId: 'test:owner',
    employeeId: null,
    sourceApp: 'NPP_OPERATIONS',
    requestId,
  };
}

async function insertVerifiedBackup(installationId, actor, now) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO shared.backup_jobs (
      id, installation_id, status, requested_by, source_app, request_id,
      include_xlsx, snapshot_at, dump_object_key, dump_size, dump_sha256,
      verified_at, completed_at
    ) VALUES ($1,$2,'VERIFIED',$3,'NPP_OPERATIONS',$4,false,$5,$6,128,$7,$5,$5)`,
    [
      id,
      installationId,
      actor,
      `backup_${randomUUID()}`,
      now.toISOString(),
      `backups/${installationId}/${id}/database.dump`,
      'a'.repeat(64),
    ],
  );
  return id;
}

async function insertAuthorizedIntent({ installationId, backupJobId, targetCode, actor }) {
  const id = randomUUID();
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO shared.data_deletion_intents (
      id, installation_id, backup_job_id, status, requested_by, source_app, request_id,
      reason, challenge_code_hash, challenge_expires_at, challenge_sent_at,
      challenge_verified_at, owner_recipient_count, authorized_at, target_code
    ) VALUES ($1,$2,$3,'AUTHORIZED',$4,'NPP_OPERATIONS',$5,$6,$7,$8,$9,$9,1,$9,$10)`,
    [
      id,
      installationId,
      backupJobId,
      actor,
      `intent_${randomUUID()}`,
      'Dọn dữ liệu kiểm thử trước bàn giao',
      'b'.repeat(64),
      new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      now,
      targetCode,
    ],
  );
  return id;
}

async function insertApprovedPurchaseOrderFixture(installationId, actor) {
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const supplierId = randomUUID();
  const unitId = randomUUID();
  const productId = randomUUID();
  const variantId = randomUUID();
  const purchaseOrderId = randomUUID();
  const purchaseOrderLineId = randomUUID();
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();

  await pool.query(
    `INSERT INTO shared.branches
      (id, installation_id, code, name, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,true,$5,$5)`,
    [branchId, installationId, `BR-${suffix}`, `Chi nhánh ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.warehouses
      (id, installation_id, branch_id, code, name, warehouse_type, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,'main',true,$6,$6)`,
    [warehouseId, installationId, branchId, `WH-${suffix}`, `Kho ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.suppliers
      (id, installation_id, code, name, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,true,$5,$5)`,
    [supplierId, installationId, `SUP-${suffix}`, `Nhà cung cấp ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.units_of_measure
      (id, installation_id, code, name, unit_kind, allows_fractional, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,'COUNT',true,true,$5,$5)`,
    [unitId, installationId, `EA${suffix.slice(0, 4)}`, `Đơn vị ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.products
      (id, installation_id, code, name, is_orderable, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,true,true,$5,$5)`,
    [productId, installationId, `PR-${suffix}`, `Sản phẩm ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.product_variants
      (id, installation_id, product_id, sku, name, variant_kind,
       is_inventory_base, is_sellable, is_catalog_visible, is_active,
       unit_id, conversion_to_base, is_purchasable, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,'BASE',true,true,true,true,$6,1,true,$7,$7)`,
    [variantId, installationId, productId, `SKU-${suffix}`, `SKU ${suffix}`, unitId, actor],
  );
  await pool.query(
    `INSERT INTO purchasing.purchase_orders (
      id, installation_id, supplier_id, warehouse_id, status, order_date,
      currency_code, subtotal, discount_total, tax_total, total, created_by, updated_by
    ) VALUES ($1,$2,$3,$4,'draft',CURRENT_DATE,'VND',100,0,0,100,$5,$5)`,
    [purchaseOrderId, installationId, supplierId, warehouseId, actor],
  );
  await pool.query(
    `INSERT INTO purchasing.purchase_order_lines (
      id, installation_id, purchase_order_id, line_number, variant_id,
      sku_snapshot, item_name_snapshot, unit_id, unit_code_snapshot,
      conversion_to_base, ordered_quantity, base_quantity, unit_price,
      discount_amount, tax_amount, line_total, created_by, updated_by
    ) VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,1,1,1,100,0,0,100,$9,$9)`,
    [purchaseOrderLineId, installationId, purchaseOrderId, variantId, `SKU-${suffix}`, `SKU ${suffix}`, unitId, `EA${suffix.slice(0, 4)}`, actor],
  );
  await pool.query(
    `UPDATE purchasing.purchase_orders
        SET status='approved', document_number=$3, submitted_at=now(), submitted_by=$4,
            approved_at=now(), approved_by=$4, updated_at=now(), updated_by=$4
      WHERE installation_id=$1 AND id=$2`,
    [installationId, purchaseOrderId, `PO-${suffix}`, actor],
  );

  return { branchId, warehouseId, supplierId, unitId, productId, variantId, purchaseOrderId, purchaseOrderLineId };
}

test('Issue #562 Part 4 exposes only business-level purge targets and keeps purge out of migration SQL', async () => {
  assert.deepEqual(Object.keys(BUSINESS_PURGE_TARGETS), [
    'ALL_BUSINESS_DATA',
    'OPERATIONS_ONLY',
    'CUSTOMERS_AND_SALES',
    'SUPPLIERS_AND_PURCHASING',
    'PRODUCTS_AND_INVENTORY',
    'MCP_ONLY',
  ]);
  const registeredMigration = CORE_API_MIGRATIONS.find((entry) => entry.id === '088_selective_business_data_purge');
  assert.ok(registeredMigration);
  assert.doesNotMatch(registeredMigration.sql, /TRUNCATE|DROP\s+SCHEMA/i);

  const guardedDeleteMigration = CORE_API_MIGRATIONS.find((entry) => entry.id === '099_business_purge_guarded_delete');
  assert.ok(guardedDeleteMigration);
  assert.match(guardedDeleteMigration.sql, /business_purge_delete_allowed/);
  assert.match(guardedDeleteMigration.sql, /npp\.business_purge_intent_id/);
  assert.match(guardedDeleteMigration.sql, /guard_purchase_order_line_mutation/);
  assert.match(guardedDeleteMigration.sql, /guard_payable_document_mutation/);
  assert.doesNotMatch(guardedDeleteMigration.sql, /DISABLE\s+TRIGGER|session_replication_role|TRUNCATE/i);

  const operationalGuards = CORE_API_MIGRATIONS.find((entry) => entry.id === '101_business_purge_operational_guards');
  assert.ok(operationalGuards);
  assert.match(operationalGuards.sql, /shared\.guard_business_purge_delete/);
  for (const table of [
    'inventory.inventory_movements',
    'inventory.inventory_movement_lines',
    'inventory.stocktake_lines',
    'inventory.inventory_adjustments',
    'accounting.receivable_documents',
    'accounting.receivable_document_lines',
    'accounting.receivable_ledger_entries',
  ]) assert.match(operationalGuards.sql, new RegExp(table.replace('.', '\\.')));
  assert.doesNotMatch(operationalGuards.sql, /DISABLE\s+TRIGGER|session_replication_role|TRUNCATE/i);

  const migration = await readFile(new URL('../../../database/migrations/shared/088_selective_business_data_purge.sql', import.meta.url), 'utf8');
  assert.match(migration, /target_code/);
  assert.match(migration, /'PURGING'/);
  assert.match(migration, /'PURGED'/);
  assert.doesNotMatch(migration, /TRUNCATE|DROP\s+SCHEMA/i);

  const service = await readFile(new URL('../src/services/business-data-purge.js', import.meta.url), 'utf8');
  assert.match(service, /pg_constraint/);
  assert.doesNotMatch(service, /DISABLE TRIGGER USER/);
  assert.match(service, /DELETE FROM/);
  assert.match(service, /core_audit_records/);
  assert.match(service, /core_outbox_events/);
  assert.match(service, /set_config\('npp\.business_purge_intent_id'/);
  assert.match(service, /PURGE_EXECUTION_BLOCKED/);
  assert.doesNotMatch(service, /TRUNCATE|DROP\s+SCHEMA/i);

  const routes = await readFile(new URL('../src/routes/backups.js', import.meta.url), 'utf8');
  assert.match(routes, /deleteExecuteMatch/);
  assert.match(routes, /\/execute/);
  assert.match(routes, /targetCode/);
  assert.match(routes, /executeDeletionIntent/);

  const gateway = await readFile(new URL('../../web/lib/backup-gateway.ts', import.meta.url), 'utf8');
  assert.match(gateway, /verify\|execute/);

  const workspace = await readFile(new URL('../../web/app/settings/data-backup/data-backup-workspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /Toàn bộ dữ liệu nghiệp vụ/);
  assert.match(workspace, /Dữ liệu phát sinh/);
  assert.match(workspace, /XÓA DỮ LIỆU NGAY/);
  assert.match(workspace, /data-deletion\.execute\./);
  assert.doesNotMatch(workspace, /chưa thực hiện xóa dữ liệu tự động/i);
});

test('Issue #562 Part 4 ALL purge removes business test data but keeps workforce, settings, backup and migration history', async () => {
  const installationId = `purge-all-${randomUUID()}`;
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
  const actor = 'test:owner';
  const employeeId = randomUUID();
  const customerId = randomUUID();
  const fixedNow = new Date();

  await pool.query(
    `INSERT INTO shared.employees
      (id, installation_id, code, full_name, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,true,$5,$5)`,
    [employeeId, installationId, `NV_${suffix}`, `Nhân viên bàn giao ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.customers
      (id, installation_id, code, name, payment_terms_days, credit_limit, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,0,0,true,$5,$5)`,
    [customerId, installationId, `KH_${suffix}`, `Khách test ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.sales_order_settings
      (installation_id, walk_in_customer_id, default_tax_mode, default_tax_rate, created_by, updated_by)
     VALUES ($1,$2,'EXCLUSIVE',0,$3,$3)`,
    [installationId, customerId, actor],
  );
  await pool.query(
    `INSERT INTO shared.core_audit_records (
      audit_id, installation_id, actor_id, source_app, request_id, action,
      resource_type, resource_id, after_data
    ) VALUES ($1,$2,$3,'NPP_OPERATIONS',$4,'test_business_marker','customer',$5,$6::jsonb)`,
    [randomUUID(), installationId, actor, `old_${randomUUID()}`, customerId, JSON.stringify({ customerName: `Khách test ${suffix}` })],
  );

  const plan = await buildBusinessPurgePlan(pool, 'ALL_BUSINESS_DATA');
  const keys = new Set(plan.tables.map((table) => table.key));
  assert.ok(keys.has('shared.customers'));
  assert.ok(!keys.has('shared.sales_order_settings'));
  assert.ok(!keys.has('shared.employees'));
  assert.ok(!keys.has('shared.users'));
  assert.ok(!keys.has('shared.sales_channels'));
  assert.ok(!keys.has('shared.units_of_measure'));
  assert.ok(!keys.has('shared.document_number_series'));
  assert.ok(!keys.has('inventory.inventory_adjustment_reasons'));
  if ((await pool.query(`SELECT to_regclass('mcp.mcp_report_settings') AS table_name`)).rows[0]?.table_name) {
    assert.ok(!keys.has('mcp.mcp_report_settings'));
    assert.ok(!keys.has('mcp.mcp_report_setting_groups'));
  }

  const backupJobId = await insertVerifiedBackup(installationId, actor, new Date(fixedNow.getTime() - 60_000));
  const intentId = await insertAuthorizedIntent({ installationId, backupJobId, targetCode: 'ALL_BUSINESS_DATA', actor });
  const requestContext = context(installationId);
  const result = await executeDeletionIntent(pool, { requestContext, intentId, now: () => fixedNow });

  assert.equal(result.ok, true);
  assert.equal(result.intent.status, 'PURGED');
  assert.equal(result.intent.targetCode, 'ALL_BUSINESS_DATA');
  assert.equal(result.intent.purgeExecuted, true);
  assert.ok(Number(result.intent.purgeSummary?.deletedRows ?? 0) >= 2);

  assert.equal(Number((await pool.query('SELECT count(*)::int AS count FROM shared.customers WHERE installation_id = $1', [installationId])).rows[0].count), 0);
  assert.equal(Number((await pool.query('SELECT count(*)::int AS count FROM shared.employees WHERE installation_id = $1 AND id = $2', [installationId, employeeId])).rows[0].count), 1);
  const settings = (await pool.query('SELECT walk_in_customer_id FROM shared.sales_order_settings WHERE installation_id = $1', [installationId])).rows[0];
  assert.ok(settings);
  assert.equal(settings.walk_in_customer_id, null);
  assert.equal(Number((await pool.query(`SELECT count(*)::int AS count FROM inventory.inventory_adjustment_reasons WHERE code = 'MANUAL_COUNT_CORRECTION_IN'`)).rows[0].count), 1);
  assert.equal(Number((await pool.query('SELECT count(*)::int AS count FROM shared.backup_jobs WHERE installation_id = $1 AND id = $2 AND status = \'VERIFIED\'', [installationId, backupJobId])).rows[0].count), 1);
  assert.equal(Number((await pool.query(`SELECT count(*)::int AS count FROM shared.schema_migrations WHERE id = '088_selective_business_data_purge'`)).rows[0].count), 1);
  assert.equal(Number((await pool.query(`SELECT count(*)::int AS count FROM shared.core_audit_records WHERE installation_id = $1 AND action = 'test_business_marker'`, [installationId])).rows[0].count), 0);
  assert.equal(Number((await pool.query(`SELECT count(*)::int AS count FROM shared.core_audit_records WHERE installation_id = $1 AND action = 'business_data_purged'`, [installationId])).rows[0].count), 1);

  const replay = await executeDeletionIntent(pool, { requestContext, intentId, now: () => fixedNow });
  assert.equal(replay.ok, true);
  assert.equal(replay.replayed, true);
  assert.equal(replay.intent.status, 'PURGED');
});

test('supplier and purchasing purge deletes an approved purchase order without weakening normal immutability', async () => {
  const installationId = `purge-supplier-${randomUUID()}`;
  const actor = 'test:owner';
  const fixedNow = new Date();
  const fixture = await insertApprovedPurchaseOrderFixture(installationId, actor);

  await assert.rejects(
    pool.query('DELETE FROM purchasing.purchase_order_lines WHERE installation_id=$1 AND id=$2', [installationId, fixture.purchaseOrderLineId]),
    (error) => error?.code === 'P0001',
  );

  const backupJobId = await insertVerifiedBackup(installationId, actor, new Date(fixedNow.getTime() - 60_000));
  const intentId = await insertAuthorizedIntent({ installationId, backupJobId, targetCode: 'SUPPLIERS_AND_PURCHASING', actor });
  const result = await executeDeletionIntent(pool, { requestContext: context(installationId), intentId, now: () => fixedNow });

  assert.equal(result.ok, true);
  assert.equal(result.intent.status, 'PURGED');
  assert.equal(result.intent.targetCode, 'SUPPLIERS_AND_PURCHASING');
  assert.equal(Number((await pool.query('SELECT count(*)::int AS count FROM purchasing.purchase_order_lines WHERE installation_id=$1 AND id=$2', [installationId, fixture.purchaseOrderLineId])).rows[0].count), 0);
  assert.equal(Number((await pool.query('SELECT count(*)::int AS count FROM purchasing.purchase_orders WHERE installation_id=$1 AND id=$2', [installationId, fixture.purchaseOrderId])).rows[0].count), 0);
  assert.equal(Number((await pool.query('SELECT count(*)::int AS count FROM shared.suppliers WHERE installation_id=$1 AND id=$2', [installationId, fixture.supplierId])).rows[0].count), 0);
  assert.equal(Number((await pool.query('SELECT count(*)::int AS count FROM shared.branches WHERE installation_id=$1 AND id=$2', [installationId, fixture.branchId])).rows[0].count), 1);
  assert.equal(Number((await pool.query('SELECT count(*)::int AS count FROM shared.products WHERE installation_id=$1 AND id=$2', [installationId, fixture.productId])).rows[0].count), 1);
});

test('Issue #562 Part 4 operations-only target preserves business master data', async () => {
  const installationId = `purge-ops-${randomUUID()}`;
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
  const actor = 'test:owner';
  const customerId = randomUUID();
  const fixedNow = new Date();
  await pool.query(
    `INSERT INTO shared.customers
      (id, installation_id, code, name, payment_terms_days, credit_limit, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,0,0,true,$5,$5)`,
    [customerId, installationId, `KH_${suffix}`, `Khách giữ lại ${suffix}`, actor],
  );
  const backupJobId = await insertVerifiedBackup(installationId, actor, new Date(fixedNow.getTime() - 60_000));
  const intentId = await insertAuthorizedIntent({ installationId, backupJobId, targetCode: 'OPERATIONS_ONLY', actor });
  const result = await executeDeletionIntent(pool, { requestContext: context(installationId), intentId, now: () => fixedNow });
  assert.equal(result.ok, true);
  assert.equal(result.intent.status, 'PURGED');
  assert.equal(Number((await pool.query('SELECT count(*)::int AS count FROM shared.customers WHERE installation_id = $1 AND id = $2', [installationId, customerId])).rows[0].count), 1);
});
