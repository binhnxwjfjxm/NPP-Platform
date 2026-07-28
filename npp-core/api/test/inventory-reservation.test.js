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
     ) VALUES ($1,$2,$3,$4,$5,'main',true,$6,$6)`,
    [warehouseId, installationId, branchId, `WR-${suffix}`, 'Kho reservation', 'test:seed'],
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

async function reserve(pool, config, master, label, quantity, overrides = {}) {
  return executeInventoryReserve({
    adapter: pool,
    requestContext: context(config.installationId, [master.warehouseId], `${label}-request-${randomUUID()}`),
    idempotencyKey: `${label}-key-${randomUUID()}`,
    payload: reservePayload(master, `${label}-source-${randomUUID()}`, quantity, overrides),
  });
}

test('Inventory reservations preserve exact holds through release, consume, expire and rebuild', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const master = await seedMasterData(pool, config.installationId);
    const opening = await executeInventoryPost({
      adapter: pool,
      requestContext: context(config.installationId, [master.warehouseId], `opening-request-${randomUUID()}`),
      idempotencyKey: `opening-key-${randomUUID()}`,
      payload: openingPayload(master, '20.000000', `opening-${randomUUID()}`),
    });
    assert.equal(opening.ok, true, opening.message);

    const reserveKey = `reserve-main-key-${randomUUID()}`;
    const sourceKey = `reserve-main-source-${randomUUID()}`;
    const reserveCommand = () => executeInventoryReserve({
      adapter: pool,
      requestContext: context(config.installationId, [master.warehouseId], `reserve-main-request-${randomUUID()}`),
      idempotencyKey: reserveKey,
      payload: reservePayload(master, sourceKey, '7.000000'),
    });
    const held = await reserveCommand();
    assert.equal(held.ok, true, held.message);
    assert.equal(held.reservation.state, 'ACTIVE');
    assert.equal(String(held.reservation.base_quantity), '7.000000000000');

    const replay = await reserveCommand();
    assert.equal(replay.ok, true, replay.message);
    assert.equal(replay.replayed, true);
    assert.equal(replay.reservation.id, held.reservation.id);

    const mismatch = await executeInventoryReserve({
      adapter: pool,
      requestContext: context(config.installationId, [master.warehouseId], `reserve-mismatch-${randomUUID()}`),
      idempotencyKey: reserveKey,
      payload: reservePayload(master, sourceKey, '8.000000'),
    });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.code, 'IDEMPOTENCY_PAYLOAD_MISMATCH');

    let balance = await readBalance(pool, config.installationId, master, `balance-before-rebuild-${randomUUID()}`);
    assert.equal(String(balance.on_hand_quantity), '20.000000000000');
    assert.equal(String(balance.reserved_quantity), '7.000000000000');
    assert.equal(String(balance.available_quantity), '13.000000000000');

    const rebuilt = await executeInventoryBalanceRebuild({
      adapter: pool,
      requestContext: context(config.installationId, [master.warehouseId], `rebuild-${randomUUID()}`),
    });
    assert.equal(rebuilt.ok, true, rebuilt.message);
    balance = await readBalance(pool, config.installationId, master, `balance-after-rebuild-${randomUUID()}`);
    assert.equal(String(balance.reserved_quantity), '7.000000000000');
    assert.equal(String(balance.available_quantity), '13.000000000000');

    const releasable = await reserve(pool, config, master, 'release', '5.000000');
    assert.equal(releasable.ok, true, releasable.message);
    const released = await executeInventoryReservationRelease({
      adapter: pool,
      requestContext: context(config.installationId, [master.warehouseId], `release-request-${randomUUID()}`),
      idempotencyKey: `release-key-${randomUUID()}`,
      reservationId: releasable.reservation.id,
      payload: { baseQuantity: '5.000000000000', reasonCode: 'ORDER_CANCELLED', reasonNote: 'Order allocation cancelled.' },
    });
    assert.equal(released.ok, true, released.message);
    assert.equal(released.reservation.state, 'RELEASED');

    const expiring = await reserve(pool, config, master, 'expire', '3.000000', {
      expiresAt: '2026-07-28T02:00:00.000Z',
    });
    assert.equal(expiring.ok, true, expiring.message);
    const expired = await executeInventoryReservationExpire({
      adapter: pool,
      requestContext: context(config.installationId, [master.warehouseId], `expire-request-${randomUUID()}`, '2026-07-28T03:00:00.000Z'),
      idempotencyKey: `expire-key-${randomUUID()}`,
      reservationId: expiring.reservation.id,
      payload: { baseQuantity: '3.000000000000', reasonCode: 'AUTO_EXPIRED', reasonNote: 'Allocation timeout.' },
    });
    assert.equal(expired.ok, true, expired.message);
    assert.equal(expired.reservation.state, 'EXPIRED');

    const badConsume = await executeInventoryReservationConsume({
      adapter: pool,
      requestContext: context(config.installationId, [master.warehouseId], `bad-consume-${randomUUID()}`),
      idempotencyKey: `bad-consume-key-${randomUUID()}`,
      reservationId: held.reservation.id,
      payload: { baseQuantity: '8.000000000000', reasonCode: 'ISSUE', reasonNote: 'Too much.' },
    });
    assert.equal(badConsume.ok, false);
    assert.equal(badConsume.code, 'RESERVATION_QUANTITY_MISMATCH');

    const consumeKey = `consume-key-${randomUUID()}`;
    const consumePayload = { baseQuantity: '7.000000000000', reasonCode: 'ALLOCATED_ISSUE', reasonNote: 'Consume reserved stock.' };
    const consumeCommand = () => executeInventoryReservationConsume({
      adapter: pool,
      requestContext: context(config.installationId, [master.warehouseId], `consume-request-${randomUUID()}`),
      idempotencyKey: consumeKey,
      reservationId: held.reservation.id,
      payload: consumePayload,
    });
    const consumed = await consumeCommand();
    assert.equal(consumed.ok, true, consumed.message);
    assert.equal(consumed.reservation.state, 'CONSUMED');
    assert.equal(consumed.movement.movement_type, 'RESERVATION_CONSUMPTION');
    assert.equal(String(consumed.movementLine.base_quantity_delta), '-7.000000000000');

    const consumeReplay = await consumeCommand();
    assert.equal(consumeReplay.ok, true, consumeReplay.message);
    assert.equal(consumeReplay.replayed, true);
    assert.equal(consumeReplay.movement.id, consumed.movement.id);

    balance = await readBalance(pool, config.installationId, master, `balance-after-consume-${randomUUID()}`);
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
        requestContext: context(config.installationId, [master.warehouseId], `negative-reversal-${randomUUID()}`),
        idempotencyKey: `negative-reversal-key-${randomUUID()}`,
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
        [config.installationId, held.reservation.id],
      ),
      /inventory_reservation_write_requires_service/,
    );
    await assert.rejects(
      pool.query(
        `DELETE FROM inventory.inventory_reservation_events
          WHERE installation_id = $1 AND reservation_id = $2`,
        [config.installationId, held.reservation.id],
      ),
      /inventory_reservation_events_are_append_only/,
    );
  } finally {
    await closePool();
  }
});

test('Concurrent reservations cannot oversell and identical retries create one hold', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const master = await seedMasterData(pool, config.installationId);
    const opening = await executeInventoryPost({
      adapter: pool,
      requestContext: context(config.installationId, [master.warehouseId], `concurrent-opening-${randomUUID()}`),
      idempotencyKey: `concurrent-opening-key-${randomUUID()}`,
      payload: openingPayload(master, '10.000000', `concurrent-opening-${randomUUID()}`),
    });
    assert.equal(opening.ok, true, opening.message);

    const results = await Promise.all([
      reserve(pool, config, master, 'concurrent-a', '6.000000'),
      reserve(pool, config, master, 'concurrent-b', '6.000000'),
    ]);
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(results.filter((result) => !result.ok && result.code === 'INSUFFICIENT_AVAILABLE_STOCK').length, 1);

    let balance = await readBalance(pool, config.installationId, master, `concurrent-balance-${randomUUID()}`);
    assert.equal(String(balance.reserved_quantity), '6.000000000000');
    assert.equal(String(balance.available_quantity), '4.000000000000');

    const winner = results.find((result) => result.ok);
    const cleanup = await executeInventoryReservationRelease({
      adapter: pool,
      requestContext: context(config.installationId, [master.warehouseId], `cleanup-${randomUUID()}`),
      idempotencyKey: `cleanup-key-${randomUUID()}`,
      reservationId: winner.reservation.id,
      payload: { baseQuantity: '6.000000000000', reasonCode: 'TEST_CLEANUP', reasonNote: 'Release concurrency winner.' },
    });
    assert.equal(cleanup.ok, true, cleanup.message);

    const sameKey = `same-key-${randomUUID()}`;
    const sameSource = `same-source-${randomUUID()}`;
    const samePayload = reservePayload(master, sameSource, '4.000000');
    const identical = await Promise.all([
      executeInventoryReserve({
        adapter: pool,
        requestContext: context(config.installationId, [master.warehouseId], `same-a-${randomUUID()}`),
        idempotencyKey: sameKey,
        payload: samePayload,
      }),
      executeInventoryReserve({
        adapter: pool,
        requestContext: context(config.installationId, [master.warehouseId], `same-b-${randomUUID()}`),
        idempotencyKey: sameKey,
        payload: samePayload,
      }),
    ]);
    assert.equal(identical.every((result) => result.ok), true);
    assert.equal(identical[0].reservation.id, identical[1].reservation.id);
    assert.equal(identical.filter((result) => result.replayed).length, 1);

    balance = await readBalance(pool, config.installationId, master, `same-balance-${randomUUID()}`);
    assert.equal(String(balance.reserved_quantity), '4.000000000000');
    assert.equal(String(balance.available_quantity), '6.000000000000');

    const deniedPermission = await executeInventoryReserve({
      adapter: pool,
      requestContext: context(
        config.installationId,
        [master.warehouseId],
        `denied-permission-${randomUUID()}`,
        '2026-07-28T01:00:00.000Z',
        [PERMISSIONS.coreInventoryRead],
      ),
      idempotencyKey: `denied-permission-key-${randomUUID()}`,
      payload: reservePayload(master, `denied-permission-source-${randomUUID()}`, '1.000000'),
    });
    assert.equal(deniedPermission.ok, false);
    assert.equal(deniedPermission.code, 'FORBIDDEN');

    const deniedScope = await executeInventoryReserve({
      adapter: pool,
      requestContext: context(config.installationId, [master.otherWarehouseId], `denied-scope-${randomUUID()}`),
      idempotencyKey: `denied-scope-key-${randomUUID()}`,
      payload: reservePayload(master, `denied-scope-source-${randomUUID()}`, '1.000000'),
    });
    assert.equal(deniedScope.ok, false);
    assert.equal(deniedScope.code, 'WAREHOUSE_SCOPE_DENIED');

    const override = await executeInventoryReserve({
      adapter: pool,
      requestContext: context(config.installationId, [master.warehouseId], `override-${randomUUID()}`),
      idempotencyKey: `override-key-${randomUUID()}`,
      payload: reservePayload(master, `override-source-${randomUUID()}`, '99.000000', { overrideNegative: true }),
    });
    assert.equal(override.ok, false);
    assert.equal(override.code, 'NEGATIVE_STOCK_OVERRIDE_NOT_ENABLED');
  } finally {
    await closePool();
  }
});
