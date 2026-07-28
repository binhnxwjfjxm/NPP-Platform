import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { closePool, getPool } from '../src/db/pool.js';
import { PERMISSIONS } from '../src/access/permissions.js';
import { executeInventoryPost, executeInventoryReversal } from '../src/services/inventory-ledger.js';
import { executeInventoryBalanceRebuild, getInventoryBalance } from '../src/services/inventory-balance.js';
import {
  executeInventoryReserve,
  executeInventoryReservationConsume,
  executeInventoryReservationExpire,
  executeInventoryReservationRelease,
  reconcileInventoryReservationHolds,
} from '../src/services/inventory-reservation.js';

function testEnv() {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3043',
    INSTALLATION_ID: `inventory-reservation-test-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
  };
}

function context(installationId, warehouseIds, requestId, receivedAt = '2026-07-28T01:00:00.000Z', permissions = [
  PERMISSIONS.coreInventoryRead,
  PERMISSIONS.coreInventoryPost,
  PERMISSIONS.coreInventoryReverse,
  PERMISSIONS.coreInventoryReserve,
]) {
  return Object.freeze({
    installationId,
    actorId: 'test:inventory-reservation',
    employeeId: null,
    sourceApp: 'npp-core-api',
    requestId,
    receivedAt,
    permissions: Object.freeze([...permissions]),
    scopes: Object.freeze({
      branchIds: Object.freeze([]),
      warehouseIds: Object.freeze([...warehouseIds]),
      territoryIds: Object.freeze([]),
    }),
  });
}

async function seedMasterData(pool, installationId) {
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const otherWarehouseId = randomUUID();
  const locationId = randomUUID();
  const unitId = randomUUID();
  const productId = randomUUID();
  const baseVariantId = randomUUID();
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  await pool.query(
    `INSERT INTO shared.branches (id, installation_id, code, name, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,true,$5,$5)`,
    [branchId, installationId, `BR-${suffix}`, 'Chi nhánh reservation', 'test:seed'],
  );
  await pool.query(
    `INSERT INTO shared.warehouses (
       id, installation_id, branch_id, code, name, warehouse_type, is_active, created_by, updated_by
     ) VALUES
       ($1,$3,$4,$5,'main',true,$6,$6),
       ($2,$3,$4,$7,'main',true,$6,$6)`,
    [warehouseId, otherWarehouseId, installationId, branchId, `WR-${suffix}`, 'test:seed', `WO-${suffix}`],
  );
  await pool.query(
    `INSERT INTO shared.warehouse_locations (
       id, installation_id, warehouse_id, code, name, location_type, is_active, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,'storage',true,$6,$6)`,
    [locationId, installationId, warehouseId, `LR-${suffix}`, 'Vị trí reservation', 'test:seed'],
  );
  await pool.query(
    `INSERT INTO shared.units_of_measure (
       id, installation_id, code, name, unit_kind, allows_fractional, is_active, created_by, updated_by
     ) VALUES ($1,$2,$3,'Cái','COUNT',false,true,$4,$4)`,
    [unitId, installationId, `EA${suffix}`, 'test:seed'],
  );
  await pool.query(
    `INSERT INTO shared.products (
       id, installation_id, code, name, is_catalog_visible, is_orderable, is_active, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,true,true,true,$5,$5)`,
    [productId, installationId, `PR-${suffix}`, 'Sản phẩm reservation', 'test:seed'],
  );
  await pool.query(
    `INSERT INTO shared.product_variants (
       id, installation_id, product_id, sku, name, variant_kind, is_inventory_base,
       is_sellable, is_catalog_visible, is_active, unit_id, conversion_to_base,
       is_purchasable, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,'BASE',true,true,true,true,$6,1,true,$7,$7)`,
    [baseVariantId, installationId, productId, `BASE-R-${suffix}`, 'SKU reservation', unitId, 'test:seed'],
  );
  return { warehouseId, otherWarehouseId, locationId, baseVariantId };
}

function openingPayload(master, quantity, sourceDocumentId) {
  return {
    movementType: 'OPENING_BALANCE',
    sourceDomain: 'INVENTORY',
    sourceDocumentType: 'OPENING_BALANCE_IMPORT',
    sourceDocumentId,
    documentDate: '2026-07-28',
    lines: [{
      warehouseId: master.warehouseId,
      locationId: master.locationId,
      sourceVariantId: master.baseVariantId,
      sourceQuantity: quantity,
      direction: 'IN',
    }],
  };
}

function reservePayload(master, sourceKey, quantity, overrides = {}) {
  return {
    sourceKey,
    sourceDomain: 'SALES',
    sourceDocumentType: 'ORDER_ALLOCATION',
    sourceDocumentId: `doc-${sourceKey}`,
    sourceLineReference: '1',
    warehouseId: master.warehouseId,
    locationId: master.locationId,
    sourceVariantId: master.baseVariantId,
    sourceQuantity: quantity,
    ...overrides,
  };
}

async function readBalance(pool, installationId, master, requestId) {
  const result = await getInventoryBalance(pool, {
    requestContext: context(installationId, [master.warehouseId], requestId),
    warehouseId: master.warehouseId,
    locationId: master.locationId,
    baseVariantId: master.baseVariantId,
  });
  assert.equal(result.ok, true, result.message);
  return result.balance;
}

test('Inventory reservations — idempotency, release, consume, expire, reconciliation and negative-stock deny', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const master = await seedMasterData(pool, config.installationId);
    const opening = await executeInventoryPost({
      adapter: pool,
      requestContext: context(config.installationId, [master.warehouseId], `open-${randomUUID()}`),
      idempotencyKey: `open-${randomUUID()}`,
      payload: openingPayload(master, '20.000000', `opening-${randomUUID()}`),
    });
    assert.equal(opening.ok, true, opening.message);

    const reserveKey = `reserve-main-${randomUUID()}`;
    const sourceKey = `source-main-${randomUUID()}`;
    const reserve = await executeInventoryReserve({
      adapter: pool,
      requestContext: context(config.installationId, [master.warehouseId], `reserve-${randomUUID()}`),
      idempotencyKey: reserveKey,
      payload: reservePayload(master, sourceKey, '7.000000'),
    });
    assert.equal(reserve.ok, true, reserve.message);
    assert.equal(reserve.reservation.state, 'ACTIVE');
    assert.equal(String(reserve.reservation.base_quantity), '7.000000000000');

    const replay = await executeInventoryReserve({
      adapter: pool,
      requestContext: context(config.installationId, [master.warehouseId], `reserve-replay-${randomUUID()}`),
      idempotencyKey: reserveKey,
      payload: reservePayload(master, sourceKey, '7.000000'),
    });
    assert.equal(replay.ok, true, replay.message);
    assert.equal(replay.replayed, true);
    assert.equal(replay.reservation.id, reserve.reservation.id);

    const mismatch = await executeInventoryReserve({
      adapter: pool,
      requestContext: context(config.installationId, [master.warehouseId], `reserve-mismatch-${randomUUID()}`),
      idempotencyKey: reserveKey,
      payload: reservePayload(master, sourceKey, '8.000000'),
    });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.code, 'IDEMPOTENCY_PAYLOAD_MISMATCH');

    let balance = await readBalance(pool, config.installationId, master, `balance-1-${randomUUID()}`);
    assert.equal(String(balance.on_hand_quantity), '20.000000000000');
    assert.equal(String(balance.reserved_quantity), '7.000000000000');
    assert.equal(String(balance.available_quantity), '13.000000000000');

    const rebuiltWithActiveHold = await executeInventoryBalanceRebuild({
      adapter: pool,
      requestContext: context(config.installationId, [master.warehouseId], `rebuild-active-${randomUUID()}`),
    });
    assert.equal(rebuiltWithActiveHold.ok, true, rebuiltWithActiveHold.message);
    balance = await readBalance(pool, config.installationId, master, `balance-rebuilt-${randomUUID()}`);
    assert.equal(String(balance.reserved_quantity), '7.000000000000');
    assert.equal(String(balance.available_quantity), '13.000000000000');

    const releaseReservation = await executeInventoryReserve({
      adapter: pool,
      requestContext: context(config.installationId, [master.warehouseId], `reserve-release-${randomUUID()}`),
      idempotencyKey: `reserve-release-${randomUUID()}`,
      payload: reservePayload(master, `source-release-${randomUUID()}`, '5.000000'),
    });
    assert.equal(releaseReservation.ok, true, releaseReservation.message);
    const released = await executeInventoryReservationRelease({
      adapter: pool,
      requestContext: context(config.installationId, [master.warehouseId], `release-${randomUUID()}`),
      idempotencyKey: `release-${randomUUID()}`,
      reservationId: releaseReservation.reservation.id,
      payload: { baseQuantity: '5.000000000000', reasonCode: 'ORDER_CANCELLED', reasonNote: 'Order allocation cancelled.' },
    });
    assert.equal(released.ok, true, released.message);
    assert.equal(released.reservation.state, 'RELEASED');

    const expiring = await executeInventoryReserve({
      adapter: pool,
      requestContext: context(config.installationId, [master.warehouseId], `reserve-expire-${randomUUID()}`),
      idempotencyKey: `reserve-expire-${randomUUID()}`,
      payload: reservePayload(master, `source-expire-${randomUUID()}`, '3.000000', {
        expiresAt: '2026-07-28T02:00:00.000Z',
      }),
    });
    assert.equal(expiring.ok, true, expiring.message);
    const expired = await executeInventoryReservationExpire({
      adapter: pool,
      requestContext: context(
        config.installationId,
        [master.warehouseId],
        `expire-${randomUUID()}`,
        '2026-07-28T03:00:00.000Z',
      ),
      idempotencyKey: `expire-${randomUUID()}`,
      reservationId: expiring.reservation.id,
      payload: { baseQuantity: '3.000000000000', reasonCode: 'AUTO_EXPIRED', reasonNote: 'Allocation timeout.' },
    });
    assert.equal(expired.ok, true, expired.message);
    assert.equal(expired.reservation.state, 'EXPIRED');

    const badConsume = await executeInventoryReservationConsume({
      adapter: pool,
      requestContext: context(config.installationId, [master.warehouseId], `consume-bad-${randomUUID()}`),
      idempotencyKey: `consume-bad-${randomUUID()}`,
      reservationId: reserve.reservation.id,
      payload: { baseQuantity: '8.000000000000', reasonCode: 'ISSUE', reasonNote: 'Too much.' },
    });
    assert.equal(badConsume.ok, false);
    assert.equal(badConsume.code, 'RESERVATION_QUANTITY_MISMATCH');

    const consumeKey = `consume-${randomUUID()}`;
    const consumed = await executeInventoryReservationConsume({
      adapter: pool,
      requestContext: context(config.installationId, [master.warehouseId], `consume-${randomUUID()}`),
      idempotencyKey: consumeKey,
      reservationId: reserve.reservation.id,
      payload: { baseQuantity: '7.000000000000', reasonCode: 'ALLOCATED_ISSUE', reasonNote: 'Consume reserved stock.' },
    });
    assert.equal(consumed.ok, true, consumed.message);
    assert.equal(consumed.reservation.state, 'CONSUMED');
    assert.equal(consumed.movement.movement_type, 'RESERVATION_CONSUMPTION');
    assert.equal(String(consumed.movementLine.base_quantity_delta), '-7.000000000000');

    const consumeReplay = await executeInventoryReservationConsume({
      adapter: pool,
      requestContext: context(config.installationId, [master.warehouseId], `consume-replay-${randomUUID()}`),
      idempotencyKey: consumeKey,
      reservationId: reserve.reservation.id,
      payload: { baseQuantity: '7.000000000000', reasonCode: 'ALLOCATED_ISSUE', reasonNote: 'Consume reserved stock.' },
    });
    assert.equal(consumeReplay.ok, true, consumeReplay.message);
    assert.equal(consumeReplay.replayed, true);
    assert.equal(consumeReplay.movement.id, consumed.movement.id);

    balance = await readBalance(pool, config.installationId, master, `balance-2-${randomUUID()}`);
    assert.equal(String(balance.on_hand_quantity), '13.000000000000');
    assert.equal(String(balance.reserved_quantity), '0.000000000000');
    assert.equal(String(balance.available_quantity), '13.000000000000');

    const reconciliation = await reconcileInventoryReservationHolds(pool, {
      requestContext: context(config.installationId, [master.warehouseId], `reconcile-${randomUUID()}`),
    });
    assert.equal(reconciliation.ok, true, reconciliation.message);
    assert.equal(reconciliation.reconciled, true);
    assert.equal(reconciliation.differences.length, 0);

    await assert.rejects(
      executeInventoryReversal({
        adapter: pool,
        requestContext: context(config.installationId, [master.warehouseId], `negative-${randomUUID()}`),
        idempotencyKey: `negative-${randomUUID()}`,
        movementId: opening.movement.id,
        payload: {
          documentDate: '2026-07-28',
          reasonCode: 'NEGATIVE_DENY_TEST',
          reasonNote: 'Reversal would make available stock negative.',
        },
      }),
      /inventory_negative_stock_denied/,
    );

    const movementCount = await pool.query(
      `SELECT count(*)::int AS count
         FROM inventory.inventory_movements
        WHERE installation_id = $1 AND movement_type = 'RESERVATION_CONSUMPTION'`,
      [config.installationId],
    );
    assert.equal(movementCount.rows[0].count, 1);

    const auditCount = await pool.query(
      `SELECT count(*)::int AS count
         FROM shared.core_audit_records
        WHERE installation_id = $1 AND action LIKE 'inventory.reservation.%'`,
      [config.installationId],
    );
    const outboxCount = await pool.query(
      `SELECT count(*)::int AS count
         FROM shared.core_outbox_events
        WHERE installation_id = $1 AND event_type LIKE 'core.inventory.reservation.%'`,
      [config.installationId],
    );
    assert.equal(auditCount.rows[0].count, 6);
    assert.equal(outboxCount.rows[0].count, 6);

    await assert.rejects(
      pool.query(
        `UPDATE inventory.inventory_reservations SET metadata = '{"changed":true}'::jsonb
          WHERE installation_id = $1 AND id = $2`,
        [config.installationId, reserve.reservation.id],
      ),
      /inventory_reservation_write_requires_service/,
    );
    await assert.rejects(
      pool.query(
        `DELETE FROM inventory.inventory_reservation_events
          WHERE installation_id = $1 AND reservation_id = $2`,
        [config.installationId, reserve.reservation.id],
      ),
      /inventory_reservation_events_are_append_only/,
    );
  } finally {
    await closePool();
  }
});

test('Concurrent reserve is serialized and cannot oversell', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const master = await seedMasterData(pool, config.installationId);
    const opening = await executeInventoryPost({
      adapter: pool,
      requestContext: context(config.installationId, [master.warehouseId], `open-concurrent-${randomUUID()}`),
      idempotencyKey: `open-concurrent-${randomUUID()}`,
      payload: openingPayload(master, '10.000000', `opening-concurrent-${randomUUID()}`),
    });
    assert.equal(opening.ok, true, opening.message);

    const results = await Promise.all([
      executeInventoryReserve({
        adapter: pool,
        requestContext: context(config.installationId, [master.warehouseId], `concurrent-a-${randomUUID()}`),
        idempotencyKey: `concurrent-a-${randomUUID()}`,
        payload: reservePayload(master, `source-concurrent-a-${randomUUID()}`, '6.000000'),
      }),
      executeInventoryReserve({
        adapter: pool,
        requestContext: context(config.installationId, [master.warehouseId], `concurrent-b-${randomUUID()}`),
        idempotencyKey: `concurrent-b-${randomUUID()}`,
        payload: reservePayload(master, `source-concurrent-b-${randomUUID()}`, '6.000000'),
      }),
    ]);
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(results.filter((result) => !result.ok && result.code === 'INSUFFICIENT_AVAILABLE_STOCK').length, 1);

    const balance = await readBalance(pool, config.installationId, master, `balance-concurrent-${randomUUID()}`);
    assert.equal(String(balance.on_hand_quantity), '10.000000000000');
    assert.equal(String(balance.reserved_quantity), '6.000000000000');
    assert.equal(String(balance.available_quantity), '4.000000000000');

    const winner = results.find((result) => result.ok);
    await executeInventoryReservationRelease({
      adapter: pool,
      requestContext: context(config.installationId, [master.warehouseId], `cleanup-${randomUUID()}`),
      idempotencyKey: `cleanup-${randomUUID()}`,
      reservationId: winner.reservation.id,
      payload: { baseQuantity: '6.000000000000', reasonCode: 'TEST_CLEANUP', reasonNote: 'Release concurrency winner.' },
    });

    const sameKey = `same-key-${randomUUID()}`;
    const sameSource = `same-source-${randomUUID()}`;
    const identical = await Promise.all([
      executeInventoryReserve({
        adapter: pool,
        requestContext: context(config.installationId, [master.warehouseId], `same-a-${randomUUID()}`),
        idempotencyKey: sameKey,
        payload: reservePayload(master, sameSource, '4.000000'),
      }),
      executeInventoryReserve({
        adapter: pool,
        requestContext: context(config.installationId, [master.warehouseId], `same-b-${randomUUID()}`),
        idempotencyKey: sameKey,
        payload: reservePayload(master, sameSource, '4.000000'),
      }),
    ]);
    assert.equal(identical.every((result) => result.ok), true);
    assert.equal(identical[0].reservation.id, identical[1].reservation.id);
    assert.equal(identical.filter((result) => result.replayed).length, 1);

    const deniedPermission = await executeInventoryReserve({
      adapter: pool,
      requestContext: context(
        config.installationId,
        [master.warehouseId],
        `denied-permission-${randomUUID()}`,
        '2026-07-28T01:00:00.000Z',
        [PERMISSIONS.coreInventoryRead],
      ),
      idempotencyKey: `denied-permission-${randomUUID()}`,
      payload: reservePayload(master, `denied-permission-source-${randomUUID()}`, '1.000000'),
    });
    assert.equal(deniedPermission.ok, false);
    assert.equal(deniedPermission.code, 'FORBIDDEN');

    const deniedScope = await executeInventoryReserve({
      adapter: pool,
      requestContext: context(config.installationId, [master.otherWarehouseId], `denied-scope-${randomUUID()}`),
      idempotencyKey: `denied-scope-${randomUUID()}`,
      payload: reservePayload(master, `denied-scope-source-${randomUUID()}`, '1.000000'),
    });
    assert.equal(deniedScope.ok, false);
    assert.equal(deniedScope.code, 'WAREHOUSE_SCOPE_DENIED');

    const override = await executeInventoryReserve({
      adapter: pool,
      requestContext: context(config.installationId, [master.warehouseId], `override-${randomUUID()}`),
      idempotencyKey: `override-${randomUUID()}`,
      payload: reservePayload(master, `override-source-${randomUUID()}`, '99.000000', { overrideNegative: true }),
    });
    assert.equal(override.ok, false);
    assert.equal(override.code, 'NEGATIVE_STOCK_OVERRIDE_NOT_ENABLED');
  } finally {
    await closePool();
  }
});
