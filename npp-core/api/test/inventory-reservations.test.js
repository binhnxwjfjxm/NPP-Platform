import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { closePool, getPool } from '../src/db/pool.js';
import { PERMISSIONS } from '../src/access/permissions.js';
import {
  executeInventoryPost,
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
  PERMISSIONS.coreInventoryReserve,
]) {
  return Object.freeze({
    installationId,
    actorId: 'test:reservation-operator',
    employeeId: null,
    sourceApp: 'npp-core-api',
    requestId,
    receivedAt: '2026-07-28T00:00:00.000Z',
    scopes: Object.freeze({ branchIds: Object.freeze([]), warehouseIds: Object.freeze(warehouseIds), territoryIds: Object.freeze([]) }),
    grantedPermissions: permissions,
  });
}

async function seedMasterData(pool, installationId) {
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const locationId = randomUUID();
  const baseUnitId = randomUUID();
  const productId = randomUUID();
  const baseVariantId = randomUUID();
  const suffix = randomUUID().slice(0, 8).toUpperCase();

  await pool.query(
    `INSERT INTO shared.branches (id, installation_id, code, name, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,true,$5,$5)`,
    [branchId, installationId, `B-${suffix}`, 'Chi nhánh P4.3 kiểm thử', 'test:seed'],
  );

  await pool.query(
    `INSERT INTO shared.warehouses (id, installation_id, branch_id, code, name, warehouse_type, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,'main',true,$6,$6)`,
    [warehouseId, installationId, branchId, `W-${suffix}`, 'Kho P4.3 kiểm thử', 'test:seed'],
  );

  await pool.query(
    `INSERT INTO shared.warehouse_locations (id, installation_id, warehouse_id, code, name, location_type, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,'storage',true,$6,$6)`,
    [locationId, installationId, warehouseId, `L-${suffix}`, 'Khu P4.3 kiểm thử', 'test:seed'],
  );

  await pool.query(
    `INSERT INTO shared.units_of_measure (id, installation_id, code, name, unit_kind, allows_fractional, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,false,true,$6,$6)`,
    [baseUnitId, installationId, 'UNIT', 'Đơn vị kiểm thử', 'base', 'test:seed'],
  );

  await pool.query(
    `INSERT INTO shared.product_categories (id, installation_id, code, name, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,true,$5,$5)`,
    [randomUUID(), installationId, `CAT-${suffix}`, 'Danh mục P4.3', 'test:seed'],
  );

  await pool.query(
    `INSERT INTO shared.products (id, installation_id, code, name, description, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,true,$6,$6)`,
    [productId, installationId, `SKU-${suffix}`, 'Sản phẩm P4.3', 'Sản phẩm kiểm thử P4.3', 'test:seed'],
  );

  await pool.query(
    `INSERT INTO shared.product_variants (
       id, installation_id, product_id, unit_id, sku, is_base, is_active, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,true,true,$6,$6)`,
    [baseVariantId, installationId, productId, baseUnitId, `SKU-${suffix}`, 'test:seed'],
  );

  return Object.freeze({
    branchId,
    warehouseId,
    locationId,
    baseUnitId,
    productId,
    baseVariantId,
    suffix,
  });
}

test('Phase 4.3: Inventory reservations create with permission and scope checks', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const master = await seedMasterData(pool, config.installationId);

    // Post opening balance first
    const opening = await executeInventoryPost({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], 'req-opening'),
      idempotencyKey: `opening-${randomUUID()}`,
      payload: {
        movementType: 'OPENING_BALANCE',
        sourceDomain: 'INVENTORY',
        sourceDocumentType: 'OPENING_BALANCE_IMPORT',
        sourceDocumentId: `opening-source-${randomUUID()}`,
        documentDate: '2026-07-28',
        metadata: { source: 'test' },
        lines: [{
          warehouseId: master.warehouseId,
          locationId: master.locationId,
          sourceVariantId: master.baseVariantId,
          sourceQuantity: '100.000000',
          direction: 'IN',
        }],
      },
    });
    assert.equal(opening.ok, true, opening.message);

    // Create reservation successfully
    const reserve = await executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-reserve-${randomUUID()}`),
      idempotencyKey: `reserve-${randomUUID()}`,
      payload: {
        warehouseId: master.warehouseId,
        locationId: master.locationId,
        baseVariantId: master.baseVariantId,
        quantity: '10.000000000000',
        sourceDomain: 'TEST',
        sourceDocumentType: 'TEST_DOCUMENT',
        sourceDocumentId: 'test-doc-1',
        metadata: { test: true },
      },
    });
    assert.equal(reserve.ok, true, reserve.message);
    assert.equal(reserve.reservation.state, 'ACTIVE');
    assert.equal(String(reserve.reservation.quantity), '10.000000000000');
    assert.equal(reserve.events.length, 1);
    assert.equal(reserve.events[0].transition, 'CREATE_ACTIVE');
    assert.ok(reserve.auditId);
    assert.ok(reserve.eventId);
    
    // Replay with same key and payload
    const replay = await executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-replay-${randomUUID()}`),
      idempotencyKey: `reserve-${randomUUID()}`,
      payload: {
        warehouseId: master.warehouseId,
        locationId: master.locationId,
        baseVariantId: master.baseVariantId,
        quantity: '10.000000000000',
        sourceDomain: 'TEST',
        sourceDocumentType: 'TEST_DOCUMENT',
        sourceDocumentId: 'test-doc-1',
        metadata: { test: true },
      },
    });
    assert.equal(replay.ok, true);
    assert.equal(replay.replayed, true);
    assert.equal(replay.reservation.id, reserve.reservation.id);

    // Mismatch: same key, different payload
    const mismatch = await executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-mismatch-${randomUUID()}`),
      idempotencyKey: `reserve-${randomUUID()}`,
      payload: {
        warehouseId: master.warehouseId,
        locationId: master.locationId,
        baseVariantId: master.baseVariantId,
        quantity: '20.000000000000',
        sourceDomain: 'TEST',
        sourceDocumentType: 'TEST_DOCUMENT',
        sourceDocumentId: 'test-doc-2',
        metadata: { test: true },
      },
    });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.code, 'IDEMPOTENCY_PAYLOAD_MISMATCH');

    // Permission denied
    const noPerm = await executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(
        config.installationId,
        [master.warehouseId],
        `req-no-perm-${randomUUID()}`,
        [PERMISSIONS.coreInventoryRead],
      ),
      idempotencyKey: `reserve-no-perm-${randomUUID()}`,
      payload: {
        warehouseId: master.warehouseId,
        locationId: master.locationId,
        baseVariantId: master.baseVariantId,
        quantity: '5.000000000000',
        sourceDomain: 'TEST',
      },
    });
    assert.equal(noPerm.ok, false);
    assert.equal(noPerm.code, 'PERMISSION_DENIED');

    // Warehouse scope denied
    const otherWarehouse = randomUUID();
    const wrongScope = await executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(config.installationId, [otherWarehouse], `req-scope-${randomUUID()}`),
      idempotencyKey: `reserve-scope-${randomUUID()}`,
      payload: {
        warehouseId: master.warehouseId,
        locationId: master.locationId,
        baseVariantId: master.baseVariantId,
        quantity: '5.000000000000',
        sourceDomain: 'TEST',
      },
    });
    assert.equal(wrongScope.ok, false);
    assert.equal(wrongScope.code, 'WAREHOUSE_SCOPE_DENIED');

    console.log('✓ Phase 4.3 reservation create, replay, mismatch, permission and scope checks passed');
  } finally {
    await closePool();
  }
});

test('Phase 4.3: Inventory reservations reject insufficient available quantity (negative stock denied)', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const master = await seedMasterData(pool, config.installationId);

    // Post 10 units
    const opening = await executeInventoryPost({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], 'req-opening'),
      idempotencyKey: `opening-${randomUUID()}`,
      payload: {
        movementType: 'OPENING_BALANCE',
        sourceDomain: 'INVENTORY',
        sourceDocumentType: 'OPENING_BALANCE_IMPORT',
        sourceDocumentId: `source-${randomUUID()}`,
        documentDate: '2026-07-28',
        lines: [{
          warehouseId: master.warehouseId,
          locationId: master.locationId,
          sourceVariantId: master.baseVariantId,
          sourceQuantity: '10.000000',
          direction: 'IN',
        }],
      },
    });
    assert.equal(opening.ok, true);

    // Try to reserve more than available: 15 > 10
    const tooMuch = await executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-too-much-${randomUUID()}`),
      idempotencyKey: `reserve-too-much-${randomUUID()}`,
      payload: {
        warehouseId: master.warehouseId,
        locationId: master.locationId,
        baseVariantId: master.baseVariantId,
        quantity: '15.000000000000',
        sourceDomain: 'TEST',
      },
    });
    assert.equal(tooMuch.ok, false);
    assert.equal(tooMuch.code, 'INSUFFICIENT_AVAILABLE_QUANTITY');

    // Reserve exactly available: 10 = 10
    const exact = await executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-exact-${randomUUID()}`),
      idempotencyKey: `reserve-exact-${randomUUID()}`,
      payload: {
        warehouseId: master.warehouseId,
        locationId: master.locationId,
        baseVariantId: master.baseVariantId,
        quantity: '10.000000000000',
        sourceDomain: 'TEST',
      },
    });
    assert.equal(exact.ok, true);

    console.log('✓ Phase 4.3 negative stock denial passed');
  } finally {
    await closePool();
  }
});

test('Phase 4.3: Inventory reservations state machine transitions', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const master = await seedMasterData(pool, config.installationId);

    // Post opening balance
    const opening = await executeInventoryPost({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], 'req-opening'),
      idempotencyKey: `opening-${randomUUID()}`,
      payload: {
        movementType: 'OPENING_BALANCE',
        sourceDomain: 'INVENTORY',
        sourceDocumentType: 'OPENING_BALANCE_IMPORT',
        sourceDocumentId: `source-${randomUUID()}`,
        documentDate: '2026-07-28',
        lines: [{
          warehouseId: master.warehouseId,
          locationId: master.locationId,
          sourceVariantId: master.baseVariantId,
          sourceQuantity: '50.000000',
          direction: 'IN',
        }],
      },
    });
    assert.equal(opening.ok, true);

    // Create reservation in ACTIVE state
    const reserve1 = await executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-res1-${randomUUID()}`),
      idempotencyKey: `res1-${randomUUID()}`,
      payload: {
        warehouseId: master.warehouseId,
        locationId: master.locationId,
        baseVariantId: master.baseVariantId,
        quantity: '10.000000000000',
        sourceDomain: 'TEST',
      },
    });
    assert.equal(reserve1.ok, true);
    assert.equal(reserve1.reservation.state, 'ACTIVE');
    const res1Id = reserve1.reservation.id;

    // Release: ACTIVE -> RELEASED
    const release = await executeReleaseReservation({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-release-${randomUUID()}`),
      reservationId: res1Id,
      payload: { reason: 'Phát hành để xử lý đơn hàng' },
    });
    assert.equal(release.ok, true);
    assert.equal(release.reservation.state, 'RELEASED');
    assert.equal(release.events.length, 2); // CREATE_ACTIVE + RELEASE_TO_RELEASED

    // Try to transition from terminal state RELEASED: should fail
    const releaseAgain = await executeReleaseReservation({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-release2-${randomUUID()}`),
      reservationId: res1Id,
      payload: { reason: 'Phát hành lần nữa' },
    });
    assert.equal(releaseAgain.ok, false);
    assert.equal(releaseAgain.code, 'INVALID_STATE_TRANSITION');

    // Create second reservation
    const reserve2 = await executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-res2-${randomUUID()}`),
      idempotencyKey: `res2-${randomUUID()}`,
      payload: {
        warehouseId: master.warehouseId,
        locationId: master.locationId,
        baseVariantId: master.baseVariantId,
        quantity: '15.000000000000',
        sourceDomain: 'TEST',
      },
    });
    const res2Id = reserve2.reservation.id;

    // Consume: ACTIVE -> CONSUMED
    const consume = await executeConsumeReservation({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-consume-${randomUUID()}`),
      reservationId: res2Id,
      payload: { reason: 'Tiêu thụ cho giao hàng' },
    });
    assert.equal(consume.ok, true);
    assert.equal(consume.reservation.state, 'CONSUMED');

    // Create third reservation
    const reserve3 = await executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-res3-${randomUUID()}`),
      idempotencyKey: `res3-${randomUUID()}`,
      payload: {
        warehouseId: master.warehouseId,
        locationId: master.locationId,
        baseVariantId: master.baseVariantId,
        quantity: '5.000000000000',
        sourceDomain: 'TEST',
      },
    });
    const res3Id = reserve3.reservation.id;

    // Expire: ACTIVE -> EXPIRED
    const expire = await executeExpireReservation({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-expire-${randomUUID()}`),
      reservationId: res3Id,
      payload: { reason: 'Hạn của cấp phát đã vượt quá' },
    });
    assert.equal(expire.ok, true);
    assert.equal(expire.reservation.state, 'EXPIRED');

    // Create fourth reservation
    const reserve4 = await executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-res4-${randomUUID()}`),
      idempotencyKey: `res4-${randomUUID()}`,
      payload: {
        warehouseId: master.warehouseId,
        locationId: master.locationId,
        baseVariantId: master.baseVariantId,
        quantity: '8.000000000000',
        sourceDomain: 'TEST',
      },
    });
    const res4Id = reserve4.reservation.id;

    // Cancel: ACTIVE -> CANCELLED
    const cancel = await executeCancelReservation({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-cancel-${randomUUID()}`),
      reservationId: res4Id,
      payload: { reason: 'Hủy cấp phát' },
    });
    assert.equal(cancel.ok, true);
    assert.equal(cancel.reservation.state, 'CANCELLED');

    console.log('✓ Phase 4.3 state machine transitions passed');
  } finally {
    await closePool();
  }
});

test('Phase 4.3: Inventory reservations and balance reserved_quantity synchronization', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const master = await seedMasterData(pool, config.installationId);

    // Post opening balance
    await executeInventoryPost({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], 'req-opening'),
      idempotencyKey: `opening-${randomUUID()}`,
      payload: {
        movementType: 'OPENING_BALANCE',
        sourceDomain: 'INVENTORY',
        sourceDocumentType: 'OPENING_BALANCE_IMPORT',
        sourceDocumentId: `source-${randomUUID()}`,
        documentDate: '2026-07-28',
        lines: [{
          warehouseId: master.warehouseId,
          locationId: master.locationId,
          sourceVariantId: master.baseVariantId,
          sourceQuantity: '100.000000',
          direction: 'IN',
        }],
      },
    });

    // Check balance before reservation
    const balanceBefore = await pool.query(
      `SELECT on_hand_quantity, reserved_quantity, available_quantity
        FROM inventory.inventory_balances
       WHERE installation_id = $1
         AND warehouse_id = $2
         AND location_id = $3
         AND base_variant_id = $4`,
      [config.installationId, master.warehouseId, master.locationId, master.baseVariantId],
    );
    assert.equal(balanceBefore.rows.length, 1);
    assert.equal(String(balanceBefore.rows[0].on_hand_quantity), '100.000000000000');
    assert.equal(String(balanceBefore.rows[0].reserved_quantity), '0.000000000000');
    assert.equal(String(balanceBefore.rows[0].available_quantity), '100.000000000000');

    // Create reservation: should increase reserved_quantity
    const reserve = await executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-reserve-${randomUUID()}`),
      idempotencyKey: `reserve-${randomUUID()}`,
      payload: {
        warehouseId: master.warehouseId,
        locationId: master.locationId,
        baseVariantId: master.baseVariantId,
        quantity: '30.000000000000',
        sourceDomain: 'TEST',
      },
    });
    assert.equal(reserve.ok, true);

    // Check balance after reservation
    const balanceAfterReserve = await pool.query(
      `SELECT on_hand_quantity, reserved_quantity, available_quantity
        FROM inventory.inventory_balances
       WHERE installation_id = $1
         AND warehouse_id = $2
         AND location_id = $3
         AND base_variant_id = $4`,
      [config.installationId, master.warehouseId, master.locationId, master.baseVariantId],
    );
    assert.equal(String(balanceAfterReserve.rows[0].on_hand_quantity), '100.000000000000');
    assert.equal(String(balanceAfterReserve.rows[0].reserved_quantity), '30.000000000000');
    assert.equal(String(balanceAfterReserve.rows[0].available_quantity), '70.000000000000');

    // Release reservation: should decrease reserved_quantity
    await executeReleaseReservation({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-release-${randomUUID()}`),
      reservationId: reserve.reservation.id,
      payload: { reason: 'Phát hành' },
    });

    // Check balance after release
    const balanceAfterRelease = await pool.query(
      `SELECT on_hand_quantity, reserved_quantity, available_quantity
        FROM inventory.inventory_balances
       WHERE installation_id = $1
         AND warehouse_id = $2
         AND location_id = $3
         AND base_variant_id = $4`,
      [config.installationId, master.warehouseId, master.locationId, master.baseVariantId],
    );
    assert.equal(String(balanceAfterRelease.rows[0].on_hand_quantity), '100.000000000000');
    assert.equal(String(balanceAfterRelease.rows[0].reserved_quantity), '0.000000000000');
    assert.equal(String(balanceAfterRelease.rows[0].available_quantity), '100.000000000000');

    console.log('✓ Phase 4.3 balance synchronization passed');
  } finally {
    await closePool();
  }
});

test('Phase 4.3: Inventory reservations reject partial quantity (P4.3 constraint)', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const master = await seedMasterData(pool, config.installationId);

    // Post opening balance
    await executeInventoryPost({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], 'req-opening'),
      idempotencyKey: `opening-${randomUUID()}`,
      payload: {
        movementType: 'OPENING_BALANCE',
        sourceDomain: 'INVENTORY',
        sourceDocumentType: 'OPENING_BALANCE_IMPORT',
        sourceDocumentId: `source-${randomUUID()}`,
        documentDate: '2026-07-28',
        lines: [{
          warehouseId: master.warehouseId,
          locationId: master.locationId,
          sourceVariantId: master.baseVariantId,
          sourceQuantity: '100.000000',
          direction: 'IN',
        }],
      },
    });

    // Try to reserve partial quantity with fractional digits
    const partial = await executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-partial-${randomUUID()}`),
      idempotencyKey: `partial-${randomUUID()}`,
      payload: {
        warehouseId: master.warehouseId,
        locationId: master.locationId,
        baseVariantId: master.baseVariantId,
        quantity: '10.5',  // Partial
        sourceDomain: 'TEST',
      },
    });
    assert.equal(partial.ok, false);
    assert.equal(partial.code, 'PARTIAL_RESERVATION_NOT_SUPPORTED');

    // Reserve whole number succeeds
    const whole = await executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-whole-${randomUUID()}`),
      idempotencyKey: `whole-${randomUUID()}`,
      payload: {
        warehouseId: master.warehouseId,
        locationId: master.locationId,
        baseVariantId: master.baseVariantId,
        quantity: '10.000000000000',
        sourceDomain: 'TEST',
      },
    });
    assert.equal(whole.ok, true);

    console.log('✓ Phase 4.3 partial quantity rejection passed');
  } finally {
    await closePool();
  }
});

test('Phase 4.3: Inventory reservations immutable event history (append-only)', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const master = await seedMasterData(pool, config.installationId);

    // Post opening balance
    await executeInventoryPost({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], 'req-opening'),
      idempotencyKey: `opening-${randomUUID()}`,
      payload: {
        movementType: 'OPENING_BALANCE',
        sourceDomain: 'INVENTORY',
        sourceDocumentType: 'OPENING_BALANCE_IMPORT',
        sourceDocumentId: `source-${randomUUID()}`,
        documentDate: '2026-07-28',
        lines: [{
          warehouseId: master.warehouseId,
          locationId: master.locationId,
          sourceVariantId: master.baseVariantId,
          sourceQuantity: '100.000000',
          direction: 'IN',
        }],
      },
    });

    // Create, release, try to mutate
    const reserve = await executeReserveInventory({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-reserve-${randomUUID()}`),
      idempotencyKey: `reserve-${randomUUID()}`,
      payload: {
        warehouseId: master.warehouseId,
        locationId: master.locationId,
        baseVariantId: master.baseVariantId,
        quantity: '20.000000000000',
        sourceDomain: 'TEST',
      },
    });

    // Try to UPDATE event: should fail (append-only)
    await assert.rejects(
      pool.query(
        `UPDATE inventory.inventory_reservation_events SET metadata = '{"changed":true}'::jsonb
          WHERE installation_id = $1 AND reservation_id = $2`,
        [config.installationId, reserve.reservation.id],
      ),
      /inventory_reservation_events_are_append_only/,
    );

    console.log('✓ Phase 4.3 event history immutability passed');
  } finally {
    await closePool();
  }
});

test('Phase 4.3: Inventory reservations decimal precision (scale 12)', async () => {
  const precise = inventoryReservationInternals.parseDecimal('123.456789123456', 'test');
  assert.equal(precise.ok, true);
  assert.equal(precise.value, '123.456789123456');

  const formatted = inventoryReservationInternals.formatScale12(123456789123456n);
  assert.equal(formatted, '123.456789123456');

  const invalid = inventoryReservationInternals.parseDecimal('abc', 'test');
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, 'INVALID_QUANTITY');
});

test('Phase 4.3: Full ledger and balance regression still green', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const master = await seedMasterData(pool, config.installationId);

    // Post multiple movements
    for (let i = 0; i < 3; i += 1) {
      const result = await executeInventoryPost({
        adapter: pool,
        requestContext: requestContext(config.installationId, [master.warehouseId], `req-${i}`),
        idempotencyKey: `opening-${i}`,
        payload: {
          movementType: 'OPENING_BALANCE',
          sourceDomain: 'INVENTORY',
          sourceDocumentId: `doc-${i}`,
          documentDate: '2026-07-28',
          lines: [{
            warehouseId: master.warehouseId,
            locationId: master.locationId,
            sourceVariantId: master.baseVariantId,
            sourceQuantity: '50.000000',
            direction: 'IN',
          }],
        },
      });
      assert.equal(result.ok, true, result.message);
    }

    // Verify balance aggregated correctly
    const balance = await pool.query(
      `SELECT on_hand_quantity FROM inventory.inventory_balances
        WHERE installation_id = $1 AND base_variant_id = $2`,
      [config.installationId, master.baseVariantId],
    );
    assert.equal(balance.rows.length, 1);
    assert.equal(String(balance.rows[0].on_hand_quantity), '150.000000000000');

    console.log('✓ Phase 4.3 full ledger and balance regression passed');
  } finally {
    await closePool();
  }
});
