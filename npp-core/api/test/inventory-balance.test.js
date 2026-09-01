import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { closePool, getPool } from '../src/db/pool.js';
import { PERMISSIONS } from '../src/access/permissions.js';
import {
  executeInventoryPost,
  executeInventoryReversal,
} from '../src/services/inventory-ledger.js';
import {
  upsertInventoryTrackingPolicy,
} from '../src/services/inventory-lots.js';
import {
  executeInventoryBalanceRebuild,
  getInventoryBalance,
  inventoryBalanceInternals,
  listInventoryMovementDrillDown,
  listInventoryMovementHistory,
  reconcileInventoryBalances,
} from '../src/services/inventory-balance.js';

function testEnv() {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3042',
    INSTALLATION_ID: `inventory-balance-test-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
  };
}

function requestContext(installationId, warehouseIds, requestId, permissions = [
  PERMISSIONS.coreInventoryRead,
  PERMISSIONS.coreInventoryPost,
  PERMISSIONS.coreInventoryReverse,
]) {
  return Object.freeze({
    installationId,
    actorId: 'test:inventory-projector',
    employeeId: null,
    sourceApp: 'npp-core-api',
    requestId,
    receivedAt: '2026-07-28T01:00:00.000Z',
    permissions: Object.freeze([...permissions]),
    scopes: Object.freeze({
      branchIds: Object.freeze([]),
      warehouseIds: Object.freeze([...warehouseIds]),
      territoryIds: Object.freeze([]),
    }),
  });
}

function parseScale12(value) {
  const normalized = String(value);
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole, fractional = ''] = unsigned.split('.');
  const scaled = BigInt(whole) * 1_000_000_000_000n
    + BigInt((fractional + '000000000000').slice(0, 12));
  return negative ? -scaled : scaled;
}

async function seedMasterData(pool, installationId) {
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const locationId = randomUUID();
  const eachUnitId = randomUUID();
  const cartonUnitId = randomUUID();
  const productId = randomUUID();
  const baseVariantId = randomUUID();
  const cartonVariantId = randomUUID();
  const suffix = randomUUID().slice(0, 8).toUpperCase();

  await pool.query(
    `INSERT INTO shared.branches (
       id, installation_id, code, name, is_active, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,true,$5,$5)`,
    [branchId, installationId, `BB-${suffix}`, 'Chi nhánh balance', 'test:seed'],
  );
  await pool.query(
    `INSERT INTO shared.warehouses (
       id, installation_id, branch_id, code, name, warehouse_type, is_active, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,'main',true,$6,$6)`,
    [warehouseId, installationId, branchId, `WB-${suffix}`, 'Kho balance', 'test:seed'],
  );
  await pool.query(
    `INSERT INTO shared.warehouse_locations (
       id, installation_id, warehouse_id, code, name, location_type, is_active, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,'storage',true,$6,$6)`,
    [locationId, installationId, warehouseId, `LB-${suffix}`, 'Vị trí balance', 'test:seed'],
  );
  await pool.query(
    `INSERT INTO shared.units_of_measure (
       id, installation_id, code, name, unit_kind, allows_fractional, is_active, created_by, updated_by
     ) VALUES
       ($1,$3,$4,'Cái','COUNT',false,true,$6,$6),
       ($2,$3,$5,'Thùng','PACKAGE',false,true,$6,$6)`,
    [eachUnitId, cartonUnitId, installationId, `EB${suffix}`, `CB${suffix}`, 'test:seed'],
  );
  await pool.query(
    `INSERT INTO shared.products (
       id, installation_id, code, name, is_catalog_visible, is_orderable, is_active, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,true,true,true,$5,$5)`,
    [productId, installationId, `PB-${suffix}`, 'Sản phẩm balance', 'test:seed'],
  );
  await pool.query(
    `INSERT INTO shared.product_variants (
       id, installation_id, product_id, sku, name, variant_kind, is_inventory_base,
       is_sellable, is_catalog_visible, is_active, unit_id, conversion_to_base,
       is_purchasable, created_by, updated_by
     ) VALUES
       ($1,$3,$4,$5,'SKU cơ sở balance','BASE',true,true,true,true,$7,1,true,$9,$9),
       ($2,$3,$4,$6,'SKU thùng balance','CARTON',false,true,true,true,$8,12,true,$9,$9)`,
    [baseVariantId, cartonVariantId, installationId, productId, `BASE-B-${suffix}`, `CARTON-B-${suffix}`, eachUnitId, cartonUnitId, 'test:seed'],
  );

  return { warehouseId, locationId, baseVariantId, cartonVariantId };
}

function openingPayload(master, sourceQuantity, sourceDocumentId, lotCode = 'LOT-BAL') {
  return {
    movementType: 'OPENING_BALANCE',
    sourceDomain: 'INVENTORY',
    sourceDocumentType: 'OPENING_BALANCE_IMPORT',
    sourceDocumentId,
    documentDate: '2026-07-28',
    lines: [{
      warehouseId: master.warehouseId,
      locationId: master.locationId,
      sourceVariantId: master.cartonVariantId,
      sourceQuantity,
      direction: 'IN',
      lotCode,
    }],
  };
}

test('Inventory balance exact-zero helper never uses floating-point tolerance', () => {
  assert.equal(inventoryBalanceInternals.exactZero('0.000000000000'), true);
  assert.equal(inventoryBalanceInternals.exactZero('-0.000000000000'), true);
  assert.equal(inventoryBalanceInternals.exactZero('0.000000000001'), false);
});

test('Inventory projection, reconciliation, rebuild and drill-down match the immutable ledger', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const master = await seedMasterData(pool, config.installationId);
    const scopedContext = (prefix) => requestContext(
      config.installationId,
      [master.warehouseId],
      `${prefix}-${randomUUID()}`,
    );
    const policyContext = requestContext(
      config.installationId,
      [master.warehouseId],
      `req-balance-policy-${randomUUID()}`,
      [
        PERMISSIONS.coreInventoryRead,
        PERMISSIONS.coreInventoryPost,
        PERMISSIONS.coreInventoryReverse,
        PERMISSIONS.coreInventoryTrackingPolicyRead,
        PERMISSIONS.coreInventoryTrackingPolicyManage,
        PERMISSIONS.coreInventoryLotRead,
        PERMISSIONS.coreInventoryLotManage,
      ],
    );

    await upsertInventoryTrackingPolicy(pool, {
      requestContext: policyContext,
      payload: {
        baseVariantId: master.baseVariantId,
        lotTrackingMode: 'REQUIRED',
        expiryTrackingMode: 'OPTIONAL',
        locationRequired: true,
      },
    });

    const first = await executeInventoryPost({
      adapter: pool,
      requestContext: scopedContext('req-balance-first'),
      idempotencyKey: `balance-first-${randomUUID()}`,
      payload: openingPayload(master, '2.000000', `first-${randomUUID()}`),
    });
    assert.equal(first.ok, true, first.message);
    const lotId = first.lines[0].lot_id;

    const second = await executeInventoryPost({
      adapter: pool,
      requestContext: scopedContext('req-balance-second'),
      idempotencyKey: `balance-second-${randomUUID()}`,
      payload: openingPayload(master, '1.000000', `second-${randomUUID()}`),
    });
    assert.equal(second.ok, true, second.message);

    const reversed = await executeInventoryReversal({
      adapter: pool,
      requestContext: scopedContext('req-balance-reverse'),
      idempotencyKey: `balance-reverse-${randomUUID()}`,
      movementId: first.movement.id,
      payload: {
        documentDate: '2026-07-28',
        reasonCode: 'BALANCE_TEST',
        reasonNote: 'Kiểm tra projector nhận movement đảo.',
      },
    });
    assert.equal(reversed.ok, true, reversed.message);

    const balanceResult = await getInventoryBalance(pool, {
      requestContext: scopedContext('req-balance-read'),
      warehouseId: master.warehouseId,
      locationId: master.locationId,
      baseVariantId: master.baseVariantId,
      lotId,
    });
    assert.equal(balanceResult.ok, true, balanceResult.message);
    assert.equal(String(balanceResult.balance.on_hand_quantity), '12.000000000000');
    assert.equal(String(balanceResult.balance.reserved_quantity), '0.000000000000');
    assert.equal(String(balanceResult.balance.available_quantity), '12.000000000000');

    const drillDown = await listInventoryMovementDrillDown(pool, {
      requestContext: scopedContext('req-balance-drill'),
      warehouseId: master.warehouseId,
      locationId: master.locationId,
      baseVariantId: master.baseVariantId,
      lotId,
    });
    assert.equal(drillDown.ok, true, drillDown.message);
    assert.equal(drillDown.lines.length, 3);
    const drillTotal = drillDown.lines.reduce(
      (total, line) => total + parseScale12(line.base_quantity_delta),
      0n,
    );
    assert.equal(drillTotal, parseScale12(balanceResult.balance.on_hand_quantity));

    const history = await listInventoryMovementHistory(pool, {
      requestContext: scopedContext('req-balance-history'),
      warehouseId: master.warehouseId,
      baseVariantId: master.baseVariantId,
      scopeMode: 'warehouse',
      limit: 51,
      offset: 0,
    });
    assert.equal(history.ok, true, history.message);
    assert.equal(history.rows.length, 3);
    assert.equal(String(history.rows[0].stock_after), '12.000000000000');
    assert.equal(history.rows.every((row) => row.warehouse_id === master.warehouseId), true);
    assert.equal(history.rows.every((row) => Number(row.line_count) === 1), true);

    const invalidHistoryScope = await listInventoryMovementHistory(pool, {
      requestContext: scopedContext('req-balance-history-invalid'),
      warehouseId: master.warehouseId,
      baseVariantId: master.baseVariantId,
      scopeMode: 'all',
      limit: 51,
      offset: 0,
    });
    assert.equal(invalidHistoryScope.ok, false);
    assert.equal(invalidHistoryScope.code, 'INVALID_HISTORY_SCOPE');

    const initialReconciliation = await reconcileInventoryBalances(pool, {
      requestContext: scopedContext('req-balance-reconcile'),
    });
    assert.equal(initialReconciliation.ok, true, initialReconciliation.message);
    assert.equal(initialReconciliation.reconciled, true);
    assert.equal(initialReconciliation.differences.length, 0);
    assert.equal(initialReconciliation.rows.length, 1);
    assert.equal(String(initialReconciliation.rows[0].ledger_quantity), '12.000000000000');
    assert.equal(String(initialReconciliation.rows[0].projected_quantity), '12.000000000000');
    assert.equal(Number(initialReconciliation.rows[0].movement_count), 3);

    const deniedPermission = await getInventoryBalance(pool, {
      requestContext: requestContext(
        config.installationId,
        [master.warehouseId],
        `req-balance-no-permission-${randomUUID()}`,
        [],
      ),
      warehouseId: master.warehouseId,
      locationId: master.locationId,
      baseVariantId: master.baseVariantId,
    });
    assert.equal(deniedPermission.ok, false);
    assert.equal(deniedPermission.code, 'FORBIDDEN');

    const deniedScope = await getInventoryBalance(pool, {
      requestContext: requestContext(
        config.installationId,
        [],
        `req-balance-no-scope-${randomUUID()}`,
      ),
      warehouseId: master.warehouseId,
      locationId: master.locationId,
      baseVariantId: master.baseVariantId,
    });
    assert.equal(deniedScope.ok, false);
    assert.equal(deniedScope.code, 'WAREHOUSE_SCOPE_DENIED');

    await assert.rejects(
      pool.query(
        `UPDATE inventory.inventory_balances
            SET on_hand_quantity = 999
          WHERE installation_id = $1
            AND warehouse_id = $2
            AND location_id = $3
            AND base_variant_id = $4`,
        [config.installationId, master.warehouseId, master.locationId, master.baseVariantId],
      ),
      /inventory_balance_write_requires_projector/,
    );

    const corruptionClient = await pool.connect();
    try {
      await corruptionClient.query('BEGIN');
      await corruptionClient.query(
        "SELECT set_config('npp.inventory_balance_write_context', 'rebuild', true)",
      );
      await corruptionClient.query(
        `UPDATE inventory.inventory_balances
            SET on_hand_quantity = 999
          WHERE installation_id = $1
            AND warehouse_id = $2
            AND location_id = $3
            AND base_variant_id = $4`,
        [config.installationId, master.warehouseId, master.locationId, master.baseVariantId],
      );
      await corruptionClient.query('COMMIT');
    } finally {
      corruptionClient.release();
    }

    const broken = await reconcileInventoryBalances(pool, {
      requestContext: scopedContext('req-balance-broken'),
    });
    assert.equal(broken.ok, true);
    assert.equal(broken.reconciled, false);
    assert.equal(broken.differences.length, 1);
    assert.equal(String(broken.differences[0].difference), '-987.000000000000');

    const rebuilt = await executeInventoryBalanceRebuild({
      adapter: pool,
      requestContext: scopedContext('req-balance-rebuild'),
    });
    assert.equal(rebuilt.ok, true, rebuilt.message);
    assert.equal(rebuilt.summary.balanceRows, 1);
    assert.equal(rebuilt.summary.differencesBefore, 1);
    assert.equal(rebuilt.summary.differencesAfter, 0);
    assert.ok(rebuilt.auditId);
    assert.ok(rebuilt.eventId);

    const rebuiltAgain = await executeInventoryBalanceRebuild({
      adapter: pool,
      requestContext: scopedContext('req-balance-rebuild-repeat'),
    });
    assert.equal(rebuiltAgain.ok, true, rebuiltAgain.message);
    assert.equal(rebuiltAgain.summary.balanceRows, 1);
    assert.equal(rebuiltAgain.summary.differencesBefore, 0);
    assert.equal(rebuiltAgain.summary.differencesAfter, 0);

    const finalBalance = await getInventoryBalance(pool, {
      requestContext: scopedContext('req-balance-final'),
      warehouseId: master.warehouseId,
      locationId: master.locationId,
      baseVariantId: master.baseVariantId,
      lotId,
    });
    assert.equal(finalBalance.ok, true);
    assert.equal(String(finalBalance.balance.on_hand_quantity), '12.000000000000');

    const evidence = await pool.query(
      `SELECT
         (SELECT count(*)::int
            FROM shared.core_audit_records
           WHERE installation_id = $1
             AND resource_type = 'inventory_balance_projection') AS audits,
         (SELECT count(*)::int
            FROM shared.core_outbox_events
           WHERE installation_id = $1
             AND aggregate_type = 'inventory_balance_projection') AS events`,
      [config.installationId],
    );
    assert.equal(evidence.rows[0].audits, 2);
    assert.equal(evidence.rows[0].events, 2);
  } finally {
    await closePool();
  }
});
