import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { closePool, getPool } from '../src/db/pool.js';
import {
  executeInventoryPost,
  executeInventoryReversal,
  inventoryLedgerInternals,
} from '../src/services/inventory-ledger.js';

function testEnv() {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3041',
    INSTALLATION_ID: `inventory-test-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
  };
}

function requestContext(installationId, warehouseIds, requestId) {
  return Object.freeze({
    installationId,
    actorId: 'test:warehouse-operator',
    employeeId: null,
    sourceApp: 'npp-core-api',
    requestId,
    receivedAt: '2026-07-28T00:00:00.000Z',
    scopes: Object.freeze({ branchIds: Object.freeze([]), warehouseIds: Object.freeze(warehouseIds), territoryIds: Object.freeze([]) }),
  });
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
    [branchId, installationId, `B-${suffix}`, 'Chi nhánh kiểm thử', 'test:seed'],
  );
  await pool.query(
    `INSERT INTO shared.warehouses (
       id, installation_id, branch_id, code, name, warehouse_type, is_active, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,'main',true,$6,$6)`,
    [warehouseId, installationId, branchId, `W-${suffix}`, 'Kho kiểm thử', 'test:seed'],
  );
  await pool.query(
    `INSERT INTO shared.warehouse_locations (
       id, installation_id, warehouse_id, code, name, location_type, is_active, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,'storage',true,$6,$6)`,
    [locationId, installationId, warehouseId, `L-${suffix}`, 'Vị trí kiểm thử', 'test:seed'],
  );
  await pool.query(
    `INSERT INTO shared.units_of_measure (
       id, installation_id, code, name, unit_kind, allows_fractional, is_active, created_by, updated_by
     ) VALUES
       ($1,$3,$4,'Cái','COUNT',false,true,$6,$6),
       ($2,$3,$5,'Thùng','PACKAGE',false,true,$6,$6)`,
    [eachUnitId, cartonUnitId, installationId, `EA${suffix}`, `CT${suffix}`, 'test:seed'],
  );
  await pool.query(
    `INSERT INTO shared.products (
       id, installation_id, code, name, is_catalog_visible, is_orderable, is_active, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,true,true,true,$5,$5)`,
    [productId, installationId, `P-${suffix}`, 'Sản phẩm kiểm thử', 'test:seed'],
  );
  await pool.query(
    `INSERT INTO shared.product_variants (
       id, installation_id, product_id, sku, name, variant_kind, is_inventory_base,
       is_sellable, is_catalog_visible, is_active, unit_id, conversion_to_base,
       is_purchasable, created_by, updated_by
     ) VALUES
       ($1,$3,$4,$5,'SKU cơ sở','BASE',true,true,true,true,$7,1,true,$9,$9),
       ($2,$3,$4,$6,'SKU thùng','CARTON',false,true,true,true,$8,12,true,$9,$9)`,
    [baseVariantId, cartonVariantId, installationId, productId, `BASE-${suffix}`, `CARTON-${suffix}`, eachUnitId, cartonUnitId, 'test:seed'],
  );

  return { warehouseId, locationId, baseVariantId, cartonVariantId };
}

test('Inventory quantity normalization uses exact decimal strings', () => {
  const exact = inventoryLedgerInternals.multiplyToBase('2.500000', '12.000000', 'IN');
  assert.equal(exact.ok, true);
  assert.equal(exact.baseQuantityDelta, '30.000000000000');

  const outbound = inventoryLedgerInternals.multiplyToBase('0.125000', '8.000000', 'OUT');
  assert.equal(outbound.ok, true);
  assert.equal(outbound.baseQuantityDelta, '-1.000000000000');

  const numberInput = inventoryLedgerInternals.multiplyToBase(0.1, '1.000000', 'IN');
  assert.equal(numberInput.ok, false);
  assert.equal(numberInput.code, 'INVALID_QUANTITY');
});

test('Inventory ledger post/replay/reversal is immutable, scoped and transactional', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const master = await seedMasterData(pool, config.installationId);
    const payload = {
      movementType: 'OPENING_BALANCE',
      sourceDomain: 'INVENTORY',
      sourceDocumentType: 'OPENING_BALANCE_IMPORT',
      sourceDocumentId: `source-${randomUUID()}`,
      documentDate: '2026-07-28',
      metadata: { source: 'test' },
      lines: [{
        warehouseId: master.warehouseId,
        locationId: master.locationId,
        sourceVariantId: master.cartonVariantId,
        sourceQuantity: '2.000000',
        direction: 'IN',
        sourceLineReference: 'ROW-1',
      }],
    };

    const first = await executeInventoryPost({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-post-${randomUUID()}`),
      idempotencyKey: `post-${randomUUID()}`,
      payload,
    });
    assert.equal(first.ok, true, first.message);
    assert.equal(first.replayed, false);
    assert.equal(first.lines.length, 1);
    assert.equal(String(first.lines[0].base_quantity_delta), '24.000000000000');
    assert.equal(first.lines[0].base_variant_id, master.baseVariantId);
    assert.ok(first.auditId);
    assert.ok(first.eventId);

    const replay = await executeInventoryPost({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-replay-${randomUUID()}`),
      idempotencyKey: first.movement.idempotency_key,
      payload,
    });
    assert.equal(replay.ok, true);
    assert.equal(replay.replayed, true);
    assert.equal(replay.movement.id, first.movement.id);

    const mismatch = await executeInventoryPost({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-mismatch-${randomUUID()}`),
      idempotencyKey: first.movement.idempotency_key,
      payload: { ...payload, lines: [{ ...payload.lines[0], sourceQuantity: '3.000000' }] },
    });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.code, 'IDEMPOTENCY_PAYLOAD_MISMATCH');

    const denied = await executeInventoryPost({
      adapter: pool,
      requestContext: requestContext(config.installationId, [], `req-denied-${randomUUID()}`),
      idempotencyKey: `denied-${randomUUID()}`,
      payload,
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.code, 'WAREHOUSE_SCOPE_DENIED');

    const concurrentKey = `concurrent-${randomUUID()}`;
    const concurrentPayload = {
      ...payload,
      sourceDocumentId: `concurrent-source-${randomUUID()}`,
      lines: [{ ...payload.lines[0], sourceQuantity: '1.000000' }],
    };
    const concurrent = await Promise.all([
      executeInventoryPost({
        adapter: pool,
        requestContext: requestContext(config.installationId, [master.warehouseId], `req-concurrent-a-${randomUUID()}`),
        idempotencyKey: concurrentKey,
        payload: concurrentPayload,
      }),
      executeInventoryPost({
        adapter: pool,
        requestContext: requestContext(config.installationId, [master.warehouseId], `req-concurrent-b-${randomUUID()}`),
        idempotencyKey: concurrentKey,
        payload: concurrentPayload,
      }),
    ]);
    assert.equal(concurrent.every((result) => result.ok), true);
    assert.equal(new Set(concurrent.map((result) => result.movement.id)).size, 1);
    assert.equal(concurrent.filter((result) => result.replayed).length, 1);

    await assert.rejects(
      pool.query(
        `UPDATE inventory.inventory_movements SET metadata = '{"changed":true}'::jsonb WHERE installation_id = $1 AND id = $2`,
        [config.installationId, first.movement.id],
      ),
      /inventory_ledger_rows_are_append_only/,
    );

    const reversed = await executeInventoryReversal({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-reverse-${randomUUID()}`),
      idempotencyKey: `reverse-${randomUUID()}`,
      movementId: first.movement.id,
      payload: {
        documentDate: '2026-07-28',
        reasonCode: 'TEST_CORRECTION',
        reasonNote: 'Đảo movement trong kiểm thử tích hợp.',
      },
    });
    assert.equal(reversed.ok, true, reversed.message);
    assert.equal(reversed.movement.reversal_of_movement_id, first.movement.id);
    assert.equal(String(reversed.lines[0].base_quantity_delta), '-24.000000000000');

    const secondReverse = await executeInventoryReversal({
      adapter: pool,
      requestContext: requestContext(config.installationId, [master.warehouseId], `req-reverse-2-${randomUUID()}`),
      idempotencyKey: `reverse-2-${randomUUID()}`,
      movementId: first.movement.id,
      payload: {
        documentDate: '2026-07-28',
        reasonCode: 'TEST_CORRECTION',
        reasonNote: 'Không được đảo lần hai.',
      },
    });
    assert.equal(secondReverse.ok, false);
    assert.equal(secondReverse.code, 'MOVEMENT_ALREADY_REVERSED');

    const ledgerTotal = await pool.query(
      `SELECT COALESCE(sum(line.base_quantity_delta), 0)::text AS quantity
         FROM inventory.inventory_movement_lines line
        WHERE line.installation_id = $1
          AND line.warehouse_id = $2
          AND line.base_variant_id = $3`,
      [config.installationId, master.warehouseId, master.baseVariantId],
    );
    assert.equal(ledgerTotal.rows[0].quantity, '12.000000000000');

    const evidence = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM shared.core_audit_records WHERE installation_id = $1 AND resource_type = 'inventory_movement') AS audits,
         (SELECT count(*)::int FROM shared.core_outbox_events WHERE installation_id = $1 AND aggregate_type = 'inventory_movement') AS events`,
      [config.installationId],
    );
    assert.equal(evidence.rows[0].audits, 3);
    assert.equal(evidence.rows[0].events, 3);
  } finally {
    await closePool();
  }
});
