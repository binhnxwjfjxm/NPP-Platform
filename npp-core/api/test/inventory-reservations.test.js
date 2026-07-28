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
  executeReserveInventory,
  executeReleaseReservation,
  executeConsumeReservation,
  executeExpireReservation,
  executeCancelReservation,
  inventoryReservationInternals,
} from '../src/services/inventory-reservations.js';

function testEnv() {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3041',
    INSTALLATION_ID: `reservation-test-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL
      || process.env.DATABASE_URL
      || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
  };
}

function requestContext(
  installationId,
  warehouseIds,
  requestId,
  permissions = [
    PERMISSIONS.coreInventoryRead,
    PERMISSIONS.coreInventoryPost,
    PERMISSIONS.coreInventoryReverse,
    PERMISSIONS.coreInventoryReserve,
  ],
) {
  return Object.freeze({
    installationId,
    actorId: 'test:reservation-operator',
    employeeId: null,
    sourceApp: 'npp-core-api',
    requestId,
    receivedAt: new Date().toISOString(),
    scopes: Object.freeze({
      branchIds: Object.freeze([]),
      warehouseIds: Object.freeze(warehouseIds),
      territoryIds: Object.freeze([]),
    }),
    grantedPermissions: Object.freeze(permissions),
  });
}

async function seedMasterData(pool, installationId) {
  const actor = 'test:seed';
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const otherWarehouseId = randomUUID();
  const locationId = randomUUID();
  const otherLocationId = randomUUID();
  const fractionalUnitId = randomUUID();
  const countUnitId = randomUUID();
  const fractionalProductId = randomUUID();
  const countProductId = randomUUID();
  const fractionalVariantId = randomUUID();
  const countVariantId = randomUUID();
  const nonBaseVariantId = randomUUID();

  await pool.query(
    `INSERT INTO shared.branches (
       id, installation_id, code, name, is_active, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,true,$5,$5)`,
    [branchId, installationId, `B-${suffix}`, 'Chi nhánh P4.3', actor],
  );

  await pool.query(
    `INSERT INTO shared.warehouses (
       id, installation_id, branch_id, code, name, warehouse_type,
       is_active, created_by, updated_by
     ) VALUES
       ($1,$3,$4,$5,'Kho P4.3 chính','main',true,$7,$7),
       ($2,$3,$4,$6,'Kho P4.3 khác','main',true,$7,$7)`,
    [
      warehouseId,
      otherWarehouseId,
      installationId,
      branchId,
      `W1-${suffix}`,
      `W2-${suffix}`,
      actor,
    ],
  );

  await pool.query(
    `INSERT INTO shared.warehouse_locations (
       id, installation_id, warehouse_id, code, name, location_type,
       is_active, created_by, updated_by
     ) VALUES
       ($1,$3,$4,$6,'Vị trí P4.3 chính','storage',true,$8,$8),
       ($2,$3,$5,$7,'Vị trí P4.3 khác','storage',true,$8,$8)`,
    [
      locationId,
      otherLocationId,
      installationId,
      warehouseId,
      otherWarehouseId,
      `L1-${suffix}`,
      `L2-${suffix}`,
      actor,
    ],
  );

  await pool.query(
    `INSERT INTO shared.units_of_measure (
       id, installation_id, code, name, unit_kind, allows_fractional,
       is_active, created_by, updated_by
     ) VALUES
       ($1,$3,$4,'Kilogram P4.3','WEIGHT',true,true,$6,$6),
       ($2,$3,$5,'Cái P4.3','COUNT',false,true,$6,$6)`,
    [
      fractionalUnitId,
      countUnitId,
      installationId,
      `KG${suffix}`,
      `EA${suffix}`,
      actor,
    ],
  );

  await pool.query(
    `INSERT INTO shared.products (
       id, installation_id, code, name, is_catalog_visible,
       is_orderable, is_active, created_by, updated_by
     ) VALUES
       ($1,$3,$4,'Sản phẩm cân P4.3',true,true,true,$6,$6),
       ($2,$3,$5,'Sản phẩm đếm P4.3',true,true,true,$6,$6)`,
    [
      fractionalProductId,
      countProductId,
      installationId,
      `PF-${suffix}`,
      `PC-${suffix}`,
      actor,
    ],
  );

  await pool.query(
    `INSERT INTO shared.product_variants (
       id, installation_id, product_id, sku, name, variant_kind,
       is_inventory_base, is_sellable, is_catalog_visible, is_active,
       unit_id, conversion_to_base, is_purchasable, created_by, updated_by
     ) VALUES
       ($1,$4,$5,$7,'SKU cân cơ sở','BASE',true,true,true,true,$10,1,true,$12,$12),
       ($2,$4,$6,$8,'SKU đếm cơ sở','BASE',true,true,true,true,$11,1,true,$12,$12),
       ($3,$4,$5,$9,'SKU cân không cơ sở','OTHER',false,true,true,true,$11,1,true,$12,$12)`,
    [
      fractionalVariantId,
      countVariantId,
      nonBaseVariantId,
      installationId,
      fractionalProductId,
      countProductId,
      `VF-${suffix}`,
      `VC-${suffix}`,
      `VN-${suffix}`,
      fractionalUnitId,
      countUnitId,
      actor,
    ],
  );

  return Object.freeze({
    branchId,
    warehouseId,
    otherWarehouseId,
    locationId,
    otherLocationId,
    fractionalUnitId,
    countUnitId,
    fractionalVariantId,
    countVariantId,
    nonBaseVariantId,
  });
}

async function postOpening(
  pool,
  config,
  master,
  quantity,
  variantId = master.fractionalVariantId,
  label = randomUUID(),
) {
  return executeInventoryPost({
    adapter: pool,
    requestContext: requestContext(
      config.installationId,
      [master.warehouseId],
      `req-opening-${label}`,
    ),
    idempotencyKey: `opening-${label}`,
    payload: {
      movementType: 'OPENING_BALANCE',
      sourceDomain: 'INVENTORY',
      sourceDocumentType: 'OPENING_BALANCE_IMPORT',
      sourceDocumentId: `opening-source-${label}`,
      documentDate: '2026-07-28',
      metadata: { test: true },
      lines: [{
        warehouseId: master.warehouseId,
        locationId: master.locationId,
        sourceVariantId: variantId,
        sourceQuantity: quantity,
        direction: 'IN',
      }],
    },
  });
}

async function readBalance(pool, config, master, variantId = master.fractionalVariantId) {
  const result = await pool.query(
    `SELECT on_hand_quantity, reserved_quantity, available_quantity
       FROM inventory.inventory_balances
      WHERE installation_id = $1
        AND warehouse_id = $2
        AND location_id = $3
        AND base_variant_id = $4
        AND lot_id IS NULL`,
    [config.installationId, master.warehouseId, master.locationId, variantId],
  );
  return result.rows[0] ?? null;
}

function reservationPayload(master, quantity, overrides = {}) {
  return {
    warehouseId: master.warehouseId,
    locationId: master.locationId,
    baseVariantId: master.fractionalVariantId,
    quantity,
    sourceDomain: 'TEST',
    sourceDocumentType: 'TEST_DOCUMENT',
    sourceDocumentId: `doc-${randomUUID()}`,
    metadata: { test: true },
    ...overrides,
  };
}

test('P4.3 exact decimal parsing rejects JavaScript numbers', () => {
  const exact = inventoryReservationInternals.parseDecimal('123.456789123456', 'quantity');
  assert.equal(exact.ok, true);
  assert.equal(exact.value, '123.456789123456');

  const normalized = inventoryReservationInternals.parseDecimal('10.5', 'quantity');
  assert.equal(normalized.ok, true);
  assert.equal(normalized.value, '10.500000000000');

  const numberInput = inventoryReservationInternals.parseDecimal(10.5, 'quantity');
  assert.equal(numberInput.ok, false);
  assert.equal(numberInput.code, 'INVALID_QUANTITY');

  const partial = inventoryReservationInternals.normalizeTransitionPayload(
    'RELEASE_TO_RELEASED',
    { quantity: '5.000000000000' },
  );
  assert.equal(partial.ok, false);
  assert.equal(partial.code, 'PARTIAL_RESERVATION_NOT_SUPPORTED');
});

test('P4.3 create, canonical replay, mismatch, permission and scope are fail-closed', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const master = await seedMasterData(pool, config.installationId);
    const opening = await postOpening(pool, config, master, '100.000000');
    assert.equal(opening.ok, true, opening.message);

    const key = `reserve-${randomUUID()}`;
    const payload = reservationPayload(master, '10.5', {
      sourceDocumentId: 'replay-doc',
      metadata: { second: 2, first: 1 },
    });
    const created = await executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(
        config.installationId,
        [master.warehouseId],
        `req-create-${randomUUID()}`,
      ),
      idempotencyKey: key,
      payload,
    });
    assert.equal(created.ok, true, created.message);
    assert.equal(created.replayed, false);
    assert.equal(created.reservation.state, 'ACTIVE');
    assert.equal(String(created.reservation.quantity), '10.500000000000');

    const replayed = await executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(
        config.installationId,
        [master.warehouseId],
        `req-replay-${randomUUID()}`,
      ),
      idempotencyKey: key,
      payload: {
        ...payload,
        quantity: '10.500000000000',
        metadata: { first: 1, second: 2 },
      },
    });
    assert.equal(replayed.ok, true, replayed.message);
    assert.equal(replayed.replayed, true);
    assert.equal(replayed.reservation.id, created.reservation.id);

    const mismatch = await executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(
        config.installationId,
        [master.warehouseId],
        `req-mismatch-${randomUUID()}`,
      ),
      idempotencyKey: key,
      payload: { ...payload, quantity: '11.000000000000' },
    });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.code, 'IDEMPOTENCY_PAYLOAD_MISMATCH');

    const reservationCount = await pool.query(
      `SELECT count(*)::int AS count
         FROM inventory.inventory_reservations
        WHERE installation_id = $1 AND idempotency_key = $2`,
      [config.installationId, key],
    );
    assert.equal(reservationCount.rows[0].count, 1);

    const createEventCount = await pool.query(
      `SELECT count(*)::int AS count
         FROM inventory.inventory_reservation_events
        WHERE installation_id = $1
          AND reservation_id = $2
          AND transition = 'CREATE_ACTIVE'`,
      [config.installationId, created.reservation.id],
    );
    assert.equal(createEventCount.rows[0].count, 1);

    const auditCount = await pool.query(
      `SELECT count(*)::int AS count
         FROM shared.core_audit_records
        WHERE installation_id = $1
          AND resource_type = 'inventory_reservation'
          AND resource_id = $2
          AND action = 'inventory.reserve'`,
      [config.installationId, created.reservation.id],
    );
    assert.equal(auditCount.rows[0].count, 1);

    const outboxCount = await pool.query(
      `SELECT count(*)::int AS count
         FROM shared.core_outbox_events
        WHERE installation_id = $1
          AND aggregate_type = 'inventory_reservation'
          AND aggregate_id = $2
          AND event_type = 'core.inventory.reservation.created'`,
      [config.installationId, created.reservation.id],
    );
    assert.equal(outboxCount.rows[0].count, 1);

    const deniedPermission = await executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(
        config.installationId,
        [master.warehouseId],
        `req-permission-${randomUUID()}`,
        [PERMISSIONS.coreInventoryRead],
      ),
      idempotencyKey: `permission-${randomUUID()}`,
      payload: reservationPayload(master, '1.000000000000'),
    });
    assert.equal(deniedPermission.ok, false);
    assert.equal(deniedPermission.code, 'PERMISSION_DENIED');

    const deniedScope = await executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(
        config.installationId,
        [master.otherWarehouseId],
        `req-scope-${randomUUID()}`,
      ),
      idempotencyKey: `scope-${randomUUID()}`,
      payload: reservationPayload(master, '1.000000000000'),
    });
    assert.equal(deniedScope.ok, false);
    assert.equal(deniedScope.code, 'WAREHOUSE_SCOPE_DENIED');

    const deniedLocation = await executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(
        config.installationId,
        [master.warehouseId],
        `req-location-${randomUUID()}`,
      ),
      idempotencyKey: `location-${randomUUID()}`,
      payload: reservationPayload(master, '1.000000000000', {
        locationId: master.otherLocationId,
      }),
    });
    assert.equal(deniedLocation.ok, false);
    assert.equal(deniedLocation.code, 'LOCATION_NOT_AVAILABLE');
  } finally {
    await closePool();
  }
});

test('P4.3 fractional policy follows the active inventory-base UOM', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const master = await seedMasterData(pool, config.installationId);
    assert.equal((await postOpening(pool, config, master, '50.000000')).ok, true);
    assert.equal((await postOpening(
      pool,
      config,
      master,
      '50.000000',
      master.countVariantId,
    )).ok, true);

    const fractional = await executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(
        config.installationId,
        [master.warehouseId],
        `req-fractional-${randomUUID()}`,
      ),
      idempotencyKey: `fractional-${randomUUID()}`,
      payload: reservationPayload(master, '10.125'),
    });
    assert.equal(fractional.ok, true, fractional.message);
    assert.equal(String(fractional.reservation.quantity), '10.125000000000');

    const nonFractional = await executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(
        config.installationId,
        [master.warehouseId],
        `req-count-${randomUUID()}`,
      ),
      idempotencyKey: `count-${randomUUID()}`,
      payload: reservationPayload(master, '10.5', {
        baseVariantId: master.countVariantId,
      }),
    });
    assert.equal(nonFractional.ok, false);
    assert.equal(nonFractional.code, 'FRACTIONAL_QUANTITY_NOT_ALLOWED');

    const nonBase = await executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(
        config.installationId,
        [master.warehouseId],
        `req-non-base-${randomUUID()}`,
      ),
      idempotencyKey: `non-base-${randomUUID()}`,
      payload: reservationPayload(master, '1.000000000000', {
        baseVariantId: master.nonBaseVariantId,
      }),
    });
    assert.equal(nonBase.ok, false);
    assert.equal(nonBase.code, 'BASE_VARIANT_REQUIRED');
  } finally {
    await closePool();
  }
});

test('P4.3 concurrent requests are idempotent, allow multiple active rows and cannot oversell', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const master = await seedMasterData(pool, config.installationId);
    const opening = await postOpening(pool, config, master, '10.000000');
    assert.equal(opening.ok, true, opening.message);

    const sameKey = `same-${randomUUID()}`;
    const samePayload = reservationPayload(master, '4.000000000000', {
      sourceDocumentId: 'same-key-doc',
    });
    const sameResults = await Promise.all([
      executeReserveInventory({
        adapter: pool,
        requestContext: requestContext(
          config.installationId,
          [master.warehouseId],
          `req-same-a-${randomUUID()}`,
        ),
        idempotencyKey: sameKey,
        payload: samePayload,
      }),
      executeReserveInventory({
        adapter: pool,
        requestContext: requestContext(
          config.installationId,
          [master.warehouseId],
          `req-same-b-${randomUUID()}`,
        ),
        idempotencyKey: sameKey,
        payload: samePayload,
      }),
    ]);
    assert.equal(sameResults.every((result) => result.ok), true);
    assert.equal(sameResults.filter((result) => result.replayed).length, 1);
    assert.equal(sameResults[0].reservation.id, sameResults[1].reservation.id);

    const reset = await executeReleaseReservation({
      adapter: pool,
      requestContext: requestContext(
        config.installationId,
        [master.warehouseId],
        `req-reset-${randomUUID()}`,
      ),
      reservationId: sameResults[0].reservation.id,
      payload: { reason: 'reset same-key fixture' },
    });
    assert.equal(reset.ok, true, reset.message);

    const oversellPayload = reservationPayload(master, '7.000000000000');
    const oversellResults = await Promise.all([
      executeReserveInventory({
        adapter: pool,
        requestContext: requestContext(
          config.installationId,
          [master.warehouseId],
          `req-over-a-${randomUUID()}`,
        ),
        idempotencyKey: `over-a-${randomUUID()}`,
        payload: { ...oversellPayload, sourceDocumentId: 'over-a' },
      }),
      executeReserveInventory({
        adapter: pool,
        requestContext: requestContext(
          config.installationId,
          [master.warehouseId],
          `req-over-b-${randomUUID()}`,
        ),
        idempotencyKey: `over-b-${randomUUID()}`,
        payload: { ...oversellPayload, sourceDocumentId: 'over-b' },
      }),
    ]);
    assert.equal(oversellResults.filter((result) => result.ok).length, 1);
    assert.equal(
      oversellResults.filter(
        (result) => !result.ok && result.code === 'INSUFFICIENT_AVAILABLE_QUANTITY',
      ).length,
      1,
    );

    const successfulOversell = oversellResults.find((result) => result.ok);
    const releasedOversell = await executeReleaseReservation({
      adapter: pool,
      requestContext: requestContext(
        config.installationId,
        [master.warehouseId],
        `req-release-over-${randomUUID()}`,
      ),
      reservationId: successfulOversell.reservation.id,
      payload: { reason: 'release oversell winner' },
    });
    assert.equal(releasedOversell.ok, true, releasedOversell.message);

    const multipleResults = await Promise.all([
      executeReserveInventory({
        adapter: pool,
        requestContext: requestContext(
          config.installationId,
          [master.warehouseId],
          `req-multiple-a-${randomUUID()}`,
        ),
        idempotencyKey: `multiple-a-${randomUUID()}`,
        payload: reservationPayload(master, '4.000000000000', {
          sourceDocumentId: 'multiple-a',
        }),
      }),
      executeReserveInventory({
        adapter: pool,
        requestContext: requestContext(
          config.installationId,
          [master.warehouseId],
          `req-multiple-b-${randomUUID()}`,
        ),
        idempotencyKey: `multiple-b-${randomUUID()}`,
        payload: reservationPayload(master, '4.000000000000', {
          sourceDocumentId: 'multiple-b',
        }),
      }),
    ]);
    assert.equal(multipleResults.every((result) => result.ok), true);

    const activeCount = await pool.query(
      `SELECT count(*)::int AS count
         FROM inventory.inventory_reservations
        WHERE installation_id = $1
          AND warehouse_id = $2
          AND location_id = $3
          AND base_variant_id = $4
          AND state = 'ACTIVE'`,
      [
        config.installationId,
        master.warehouseId,
        master.locationId,
        master.fractionalVariantId,
      ],
    );
    assert.equal(activeCount.rows[0].count, 2);

    const balance = await readBalance(pool, config, master);
    assert.equal(String(balance.on_hand_quantity), '10.000000000000');
    assert.equal(String(balance.reserved_quantity), '8.000000000000');
    assert.equal(String(balance.available_quantity), '2.000000000000');
  } finally {
    await closePool();
  }
});

test('P4.3 lifecycle applies full quantity and terminal states are immutable', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const master = await seedMasterData(pool, config.installationId);
    assert.equal((await postOpening(pool, config, master, '100.000000')).ok, true);

    const create = async (quantity, label) => executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(
        config.installationId,
        [master.warehouseId],
        `req-${label}-${randomUUID()}`,
      ),
      idempotencyKey: `${label}-${randomUUID()}`,
      payload: reservationPayload(master, quantity, { sourceDocumentId: label }),
    });

    const releasedReservation = await create('10.500000000000', 'release');
    const consumedReservation = await create('15.000000000000', 'consume');
    const expiredReservation = await create('5.000000000000', 'expire');
    const cancelledReservation = await create('8.000000000000', 'cancel');
    assert.equal([
      releasedReservation,
      consumedReservation,
      expiredReservation,
      cancelledReservation,
    ].every((result) => result.ok), true);

    const partialRelease = await executeReleaseReservation({
      adapter: pool,
      requestContext: requestContext(
        config.installationId,
        [master.warehouseId],
        `req-partial-${randomUUID()}`,
      ),
      reservationId: releasedReservation.reservation.id,
      payload: { quantity: '5.250000000000', reason: 'not supported' },
    });
    assert.equal(partialRelease.ok, false);
    assert.equal(partialRelease.code, 'PARTIAL_RESERVATION_NOT_SUPPORTED');

    const released = await executeReleaseReservation({
      adapter: pool,
      requestContext: requestContext(
        config.installationId,
        [master.warehouseId],
        `req-release-${randomUUID()}`,
      ),
      reservationId: releasedReservation.reservation.id,
      payload: { reason: 'release complete reservation' },
    });
    assert.equal(released.ok, true, released.message);
    assert.equal(released.reservation.state, 'RELEASED');
    assert.deepEqual(
      released.events.map((event) => event.transition),
      ['CREATE_ACTIVE', 'RELEASE_TO_RELEASED'],
    );

    const terminalRetry = await executeReleaseReservation({
      adapter: pool,
      requestContext: requestContext(
        config.installationId,
        [master.warehouseId],
        `req-terminal-${randomUUID()}`,
      ),
      reservationId: releasedReservation.reservation.id,
      payload: { reason: 'retry terminal transition' },
    });
    assert.equal(terminalRetry.ok, false);
    assert.equal(terminalRetry.code, 'TERMINAL_STATE_NO_TRANSITION');

    const consumed = await executeConsumeReservation({
      adapter: pool,
      requestContext: requestContext(
        config.installationId,
        [master.warehouseId],
        `req-consume-${randomUUID()}`,
      ),
      reservationId: consumedReservation.reservation.id,
      payload: { reason: 'consume complete reservation' },
    });
    assert.equal(consumed.ok, true, consumed.message);
    assert.equal(consumed.reservation.state, 'CONSUMED');

    const expired = await executeExpireReservation({
      adapter: pool,
      requestContext: requestContext(
        config.installationId,
        [master.warehouseId],
        `req-expire-${randomUUID()}`,
      ),
      reservationId: expiredReservation.reservation.id,
      payload: { reason: 'reservation expired' },
    });
    assert.equal(expired.ok, true, expired.message);
    assert.equal(expired.reservation.state, 'EXPIRED');

    const cancelled = await executeCancelReservation({
      adapter: pool,
      requestContext: requestContext(
        config.installationId,
        [master.warehouseId],
        `req-cancel-${randomUUID()}`,
      ),
      reservationId: cancelledReservation.reservation.id,
      payload: { reason: 'reservation cancelled' },
    });
    assert.equal(cancelled.ok, true, cancelled.message);
    assert.equal(cancelled.reservation.state, 'CANCELLED');

    const balance = await readBalance(pool, config, master);
    assert.equal(String(balance.reserved_quantity), '0.000000000000');
    assert.equal(String(balance.available_quantity), '100.000000000000');
  } finally {
    await closePool();
  }
});

test('P4.3 direct writes and cross-installation access are denied', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const master = await seedMasterData(pool, config.installationId);
    assert.equal((await postOpening(pool, config, master, '20.000000')).ok, true);

    const reserve = await executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(
        config.installationId,
        [master.warehouseId],
        `req-guard-${randomUUID()}`,
      ),
      idempotencyKey: `guard-${randomUUID()}`,
      payload: reservationPayload(master, '5.000000000000'),
    });
    assert.equal(reserve.ok, true, reserve.message);

    await assert.rejects(
      pool.query(
        `UPDATE inventory.inventory_reservations
            SET state = 'RELEASED'
          WHERE installation_id = $1 AND id = $2`,
        [config.installationId, reserve.reservation.id],
      ),
      /inventory_reservation_write_requires_service_context/,
    );

    await assert.rejects(
      pool.query(
        `UPDATE inventory.inventory_reservation_events
            SET metadata = '{"changed":true}'::jsonb
          WHERE installation_id = $1 AND reservation_id = $2`,
        [config.installationId, reserve.reservation.id],
      ),
      /inventory_reservation_events_are_append_only/,
    );

    await assert.rejects(
      pool.query(
        `INSERT INTO inventory.inventory_reservation_events (
           id, installation_id, reservation_id, transition, actor_id,
           request_id, source_app, payload_hash, metadata
         ) VALUES ($1,$2,$3,'CANCEL_TO_CANCELLED','test:direct','req-direct',
                   'test',repeat('a',64),'{}'::jsonb)`,
        [randomUUID(), config.installationId, reserve.reservation.id],
      ),
      /inventory_reservation_event_insert_requires_service_context/,
    );

    await assert.rejects(
      pool.query(
        `UPDATE inventory.inventory_balances
            SET reserved_quantity = 0
          WHERE installation_id = $1 AND warehouse_id = $2`,
        [config.installationId, master.warehouseId],
      ),
      /inventory_balance_write_requires_projector/,
    );

    const isolated = await executeReleaseReservation({
      adapter: pool,
      requestContext: requestContext(
        `other-${randomUUID()}`,
        [master.warehouseId],
        `req-isolated-${randomUUID()}`,
      ),
      reservationId: reserve.reservation.id,
      payload: { reason: 'cross-installation attempt' },
    });
    assert.equal(isolated.ok, false);
    assert.equal(isolated.code, 'RESERVATION_NOT_FOUND');
  } finally {
    await closePool();
  }
});

test('P4.3 audit failure rolls back reservation, event, balance and outbox atomically', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const master = await seedMasterData(pool, config.installationId);
    assert.equal((await postOpening(pool, config, master, '20.000000')).ok, true);

    const failedKey = `rollback-${randomUUID()}`;
    const failedRequestId = `req-rollback-${randomUUID()}`;
    const failingAdapter = {
      connect: async () => {
        const client = await pool.connect();
        return {
          query: async (sql, values = []) => {
            if (/insert\s+into\s+shared\.core_audit_records/i.test(String(sql))) {
              throw new Error('forced_audit_failure');
            }
            return client.query(sql, values);
          },
          release: () => client.release(),
        };
      },
    };

    await assert.rejects(
      executeReserveInventory({
        adapter: failingAdapter,
        requestContext: requestContext(
          config.installationId,
          [master.warehouseId],
          failedRequestId,
        ),
        idempotencyKey: failedKey,
        payload: reservationPayload(master, '6.000000000000'),
      }),
      /forced_audit_failure/,
    );

    const reservationCount = await pool.query(
      `SELECT count(*)::int AS count
         FROM inventory.inventory_reservations
        WHERE installation_id = $1 AND idempotency_key = $2`,
      [config.installationId, failedKey],
    );
    assert.equal(reservationCount.rows[0].count, 0);

    const eventCount = await pool.query(
      `SELECT count(*)::int AS count
         FROM inventory.inventory_reservation_events
        WHERE installation_id = $1 AND request_id = $2`,
      [config.installationId, failedRequestId],
    );
    assert.equal(eventCount.rows[0].count, 0);

    const auditCount = await pool.query(
      `SELECT count(*)::int AS count
         FROM shared.core_audit_records
        WHERE installation_id = $1 AND request_id = $2`,
      [config.installationId, failedRequestId],
    );
    assert.equal(auditCount.rows[0].count, 0);

    const outboxCount = await pool.query(
      `SELECT count(*)::int AS count
         FROM shared.core_outbox_events
        WHERE installation_id = $1 AND request_id = $2`,
      [config.installationId, failedRequestId],
    );
    assert.equal(outboxCount.rows[0].count, 0);

    const balance = await readBalance(pool, config, master);
    assert.equal(String(balance.reserved_quantity), '0.000000000000');
    assert.equal(String(balance.available_quantity), '20.000000000000');
  } finally {
    await closePool();
  }
});

test('P4.3 reversal cannot reduce on-hand below reserved quantity', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const master = await seedMasterData(pool, config.installationId);
    const opening = await postOpening(pool, config, master, '20.000000');
    assert.equal(opening.ok, true, opening.message);

    const reserve = await executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(
        config.installationId,
        [master.warehouseId],
        `req-reversal-reserve-${randomUUID()}`,
      ),
      idempotencyKey: `reversal-reserve-${randomUUID()}`,
      payload: reservationPayload(master, '15.000000000000'),
    });
    assert.equal(reserve.ok, true, reserve.message);

    await assert.rejects(
      executeInventoryReversal({
        adapter: pool,
        requestContext: requestContext(
          config.installationId,
          [master.warehouseId],
          `req-reversal-denied-${randomUUID()}`,
        ),
        idempotencyKey: `reversal-denied-${randomUUID()}`,
        movementId: opening.movement.id,
        payload: {
          documentDate: '2026-07-28',
          reasonCode: 'TEST_CORRECTION',
          reasonNote: 'Reserved stock cannot be reversed below zero availability',
        },
      }),
      /inventory_negative_stock_denied/,
    );

    const reversalCount = await pool.query(
      `SELECT count(*)::int AS count
         FROM inventory.inventory_movements
        WHERE installation_id = $1 AND reversal_of_movement_id = $2`,
      [config.installationId, opening.movement.id],
    );
    assert.equal(reversalCount.rows[0].count, 0);

    let balance = await readBalance(pool, config, master);
    assert.equal(String(balance.on_hand_quantity), '20.000000000000');
    assert.equal(String(balance.reserved_quantity), '15.000000000000');
    assert.equal(String(balance.available_quantity), '5.000000000000');

    const release = await executeReleaseReservation({
      adapter: pool,
      requestContext: requestContext(
        config.installationId,
        [master.warehouseId],
        `req-reversal-release-${randomUUID()}`,
      ),
      reservationId: reserve.reservation.id,
      payload: { reason: 'release before valid reversal' },
    });
    assert.equal(release.ok, true, release.message);

    const reversal = await executeInventoryReversal({
      adapter: pool,
      requestContext: requestContext(
        config.installationId,
        [master.warehouseId],
        `req-reversal-valid-${randomUUID()}`,
      ),
      idempotencyKey: `reversal-valid-${randomUUID()}`,
      movementId: opening.movement.id,
      payload: {
        documentDate: '2026-07-28',
        reasonCode: 'TEST_CORRECTION',
        reasonNote: 'Valid reversal after reservation release',
      },
    });
    assert.equal(reversal.ok, true, reversal.message);

    balance = await readBalance(pool, config, master);
    assert.equal(String(balance.on_hand_quantity), '0.000000000000');
    assert.equal(String(balance.reserved_quantity), '0.000000000000');
    assert.equal(String(balance.available_quantity), '0.000000000000');
  } finally {
    await closePool();
  }
});
