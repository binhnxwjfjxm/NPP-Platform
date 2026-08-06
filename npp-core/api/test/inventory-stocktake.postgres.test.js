import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { closePool, getPool } from '../src/db/pool.js';
import { executeInventoryPost } from '../src/services/inventory-ledger.js';
import {
  approveStocktake,
  countStocktake,
  createStocktake,
  getStocktake,
  postStocktake,
  requestRecount,
  reverseStocktake,
  submitStocktake,
} from '../src/services/inventory-stocktake.js';

function testEnv() {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3076',
    INSTALLATION_ID: `stocktake-test-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
  };
}

function requestContext(installationId, warehouseIds, actorId, requestId = `req-${randomUUID()}`) {
  return Object.freeze({
    installationId,
    actorId,
    employeeId: null,
    sourceApp: 'npp-core-api',
    requestId,
    receivedAt: '2026-08-06T09:30:00.000Z',
    roles: Object.freeze(['bootstrap']),
    permissions: Object.freeze([]),
    scopes: Object.freeze({
      branchIds: Object.freeze([]),
      warehouseIds: Object.freeze(warehouseIds),
      territoryIds: Object.freeze([]),
    }),
  });
}

async function transaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    if (!result.ok) await client.query('ROLLBACK');
    else await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function seedStocktakeMasterData(pool, installationId) {
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const otherWarehouseId = randomUUID();
  const locationOneId = randomUUID();
  const locationTwoId = randomUUID();
  const unitId = randomUUID();
  const productId = randomUUID();
  const baseVariantId = randomUUID();

  await pool.query(
    `INSERT INTO shared.branches (
       id, installation_id, code, name, is_active, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,true,$5,$5)`,
    [branchId, installationId, `B-${suffix}`, 'Chi nhánh kiểm kê', 'test:seed'],
  );
  await pool.query(
    `INSERT INTO shared.warehouses (
       id, installation_id, branch_id, code, name, warehouse_type, is_active, created_by, updated_by
     ) VALUES
       ($1,$3,$4,$5,'Kho kiểm kê','main',true,$7,$7),
       ($2,$3,$4,$6,'Kho ngoài phạm vi','main',true,$7,$7)`,
    [warehouseId, otherWarehouseId, installationId, branchId, `STK-${suffix}`, `OTH-${suffix}`, 'test:seed'],
  );
  await pool.query(
    `INSERT INTO shared.warehouse_locations (
       id, installation_id, warehouse_id, code, name, location_type, is_active, created_by, updated_by
     ) VALUES
       ($1,$3,$4,$5,'Kệ A','storage',true,$7,$7),
       ($2,$3,$4,$6,'Kệ B','storage',true,$7,$7)`,
    [locationOneId, locationTwoId, installationId, warehouseId, `A-${suffix}`, `B-${suffix}`, 'test:seed'],
  );
  await pool.query(
    `INSERT INTO shared.units_of_measure (
       id, installation_id, code, name, unit_kind, allows_fractional, is_active, created_by, updated_by
     ) VALUES ($1,$2,$3,'Cái','COUNT',true,true,$4,$4)`,
    [unitId, installationId, `EA${suffix}`, 'test:seed'],
  );
  await pool.query(
    `INSERT INTO shared.products (
       id, installation_id, code, name, is_catalog_visible, is_orderable, is_active, created_by, updated_by
     ) VALUES ($1,$2,$3,'Sản phẩm kiểm kê',true,true,true,$4,$4)`,
    [productId, installationId, `P-${suffix}`, 'test:seed'],
  );
  await pool.query(
    `INSERT INTO shared.product_variants (
       id, installation_id, product_id, sku, name, variant_kind, is_inventory_base,
       is_sellable, is_catalog_visible, is_active, unit_id, conversion_to_base,
       is_purchasable, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,'SKU cơ sở','BASE',true,true,true,true,$5,1,true,$6,$6)`,
    [baseVariantId, installationId, productId, `SKU-${suffix}`, unitId, 'test:seed'],
  );
  await pool.query(
    `INSERT INTO inventory.product_tracking_policies (
       installation_id, base_variant_id, lot_tracking_mode, expiry_tracking_mode,
       location_required, version, created_at, created_by, updated_at, updated_by
     ) VALUES ($1,$2,'NONE','NONE',true,1,now(),$3,now(),$3)`,
    [installationId, baseVariantId, 'test:seed'],
  );

  return { warehouseId, otherWarehouseId, locationOneId, locationTwoId, baseVariantId };
}

async function postOpening(pool, context, master) {
  const result = await executeInventoryPost({
    adapter: pool,
    requestContext: context,
    idempotencyKey: `opening-${randomUUID()}`,
    payload: {
      movementType: 'OPENING_BALANCE',
      sourceDomain: 'INVENTORY',
      sourceDocumentType: 'OPENING_BALANCE_IMPORT',
      sourceDocumentId: `opening-${randomUUID()}`,
      documentDate: '2026-08-06',
      lines: [
        {
          warehouseId: master.warehouseId,
          locationId: master.locationOneId,
          sourceVariantId: master.baseVariantId,
          sourceQuantity: '10.000000',
          direction: 'IN',
          sourceLineReference: 'OPEN-A',
        },
        {
          warehouseId: master.warehouseId,
          locationId: master.locationTwoId,
          sourceVariantId: master.baseVariantId,
          sourceQuantity: '5.000000',
          direction: 'IN',
          sourceLineReference: 'OPEN-B',
        },
      ],
    },
  });
  assert.equal(result.ok, true, result.message);
}

async function balanceByLocation(pool, installationId, warehouseId, variantId) {
  const result = await pool.query(
    `SELECT location_id, on_hand_quantity::text AS quantity
       FROM inventory.inventory_balances
      WHERE installation_id = $1 AND warehouse_id = $2 AND base_variant_id = $3`,
    [installationId, warehouseId, variantId],
  );
  return new Map(result.rows.map((row) => [row.location_id, row.quantity]));
}

function scopes(master) {
  return [
    { locationId: master.locationOneId, baseVariantId: master.baseVariantId, lotId: null },
    { locationId: master.locationTwoId, baseVariantId: master.baseVariantId, lotId: null },
  ];
}

test('migration 060 adds append-only stocktake scopes without direct balance writes', () => {
  const sql = readFileSync(new URL('../../../database/migrations/inventory/060_inventory_stocktake.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS inventory\.inventory_scope_versions/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS inventory\.stocktakes/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS inventory\.stocktake_rounds/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS inventory\.stocktake_lines/);
  assert.match(sql, /inventory_movement_lines_scope_version/);
  assert.match(sql, /stocktake_history_is_append_only/);
  assert.doesNotMatch(sql, /UPDATE\s+inventory\.inventory_balances/i);
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+inventory\.inventory_balances/i);
});

test('blind count posts one mixed-direction adjustment and guarded reversal restores exact scopes', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const master = await seedStocktakeMasterData(pool, config.installationId);
    const counter = requestContext(config.installationId, [master.warehouseId], 'test:counter');
    const approver = requestContext(config.installationId, [master.warehouseId], 'test:approver');
    await postOpening(pool, counter, master);

    const denied = await transaction(pool, (client) => createStocktake(client, {
      requestContext: requestContext(config.installationId, [master.otherWarehouseId], 'test:outsider'),
      payload: { warehouseId: master.warehouseId, scopes: scopes(master) },
    }));
    assert.equal(denied.ok, false);
    assert.equal(denied.code, 'WAREHOUSE_SCOPE_DENIED');

    const created = await transaction(pool, (client) => createStocktake(client, {
      requestContext: counter,
      payload: { warehouseId: master.warehouseId, note: 'Kiểm kê hỗn hợp', scopes: scopes(master) },
    }));
    assert.equal(created.ok, true, created.message);
    assert.equal(created.stocktake.status, 'draft');
    assert.equal(created.stocktake.lines.length, 2);
    assert.equal(created.stocktake.lines[0].expectedBaseQuantity, undefined);
    assert.equal(created.stocktake.lines[0].snapshotScopeVersion, undefined);

    const counted = await transaction(pool, (client) => countStocktake(client, {
      requestContext: counter,
      stocktakeId: created.stocktake.id,
      payload: {
        expectedRevision: created.stocktake.revision,
        counts: created.stocktake.lines.map((line) => ({
          lineId: line.id,
          countedBaseQuantity: line.locationId === master.locationOneId ? '12.000000000000' : '3.000000000000',
        })),
      },
    }));
    assert.equal(counted.ok, true, counted.message);
    assert.equal(counted.stocktake.lines[0].expectedBaseQuantity, undefined);

    const submitted = await transaction(pool, (client) => submitStocktake(client, {
      requestContext: counter,
      stocktakeId: created.stocktake.id,
      payload: { expectedRevision: counted.stocktake.revision },
    }));
    assert.equal(submitted.ok, true, submitted.message);
    assert.equal(submitted.stocktake.status, 'submitted');
    assert.notEqual(submitted.stocktake.lines[0].expectedBaseQuantity, undefined);

    const selfApproval = await transaction(pool, (client) => approveStocktake(client, {
      requestContext: counter,
      stocktakeId: created.stocktake.id,
      payload: { expectedRevision: submitted.stocktake.revision },
    }));
    assert.equal(selfApproval.ok, false);
    assert.equal(selfApproval.code, 'STOCKTAKE_SELF_APPROVAL_DENIED');

    const approved = await transaction(pool, (client) => approveStocktake(client, {
      requestContext: approver,
      stocktakeId: created.stocktake.id,
      payload: { expectedRevision: submitted.stocktake.revision },
    }));
    assert.equal(approved.ok, true, approved.message);
    assert.equal(approved.stocktake.status, 'approved');

    const posted = await transaction(pool, (client) => postStocktake(client, {
      requestContext: approver,
      stocktakeId: created.stocktake.id,
      payload: { expectedRevision: approved.stocktake.revision },
      idempotencyKey: `post-${randomUUID()}`,
    }));
    assert.equal(posted.ok, true, posted.message);
    assert.equal(posted.stocktake.status, 'posted');
    assert.ok(posted.stocktake.inventoryMovementId);

    const movement = await pool.query(
      `SELECT movement_type, source_document_type
         FROM inventory.inventory_movements
        WHERE installation_id = $1 AND id = $2`,
      [config.installationId, posted.stocktake.inventoryMovementId],
    );
    assert.deepEqual(movement.rows[0], {
      movement_type: 'STOCKTAKE_ADJUSTMENT',
      source_document_type: 'STOCKTAKE',
    });
    const directions = await pool.query(
      `SELECT direction, base_quantity_delta::text AS delta
         FROM inventory.inventory_movement_lines
        WHERE installation_id = $1 AND movement_id = $2
        ORDER BY direction`,
      [config.installationId, posted.stocktake.inventoryMovementId],
    );
    assert.deepEqual(directions.rows, [
      { direction: 'IN', delta: '2.000000000000' },
      { direction: 'OUT', delta: '-2.000000000000' },
    ]);

    let balances = await balanceByLocation(pool, config.installationId, master.warehouseId, master.baseVariantId);
    assert.equal(balances.get(master.locationOneId), '12.000000000000');
    assert.equal(balances.get(master.locationTwoId), '3.000000000000');

    const reversed = await transaction(pool, (client) => reverseStocktake(client, {
      requestContext: approver,
      stocktakeId: created.stocktake.id,
      payload: { expectedRevision: posted.stocktake.revision, reason: 'Đảo kiểm kê smoke' },
      idempotencyKey: `reverse-${randomUUID()}`,
    }));
    assert.equal(reversed.ok, true, reversed.message);
    assert.equal(reversed.stocktake.status, 'reversed');
    assert.ok(reversed.stocktake.reversalMovementId);

    balances = await balanceByLocation(pool, config.installationId, master.warehouseId, master.baseVariantId);
    assert.equal(balances.get(master.locationOneId), '10.000000000000');
    assert.equal(balances.get(master.locationTwoId), '5.000000000000');
  } finally {
    await closePool();
  }
});

test('scope movement conflicts fail closed and recount preserves old round before retry', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const master = await seedStocktakeMasterData(pool, config.installationId);
    const counter = requestContext(config.installationId, [master.warehouseId], 'test:counter');
    const approver = requestContext(config.installationId, [master.warehouseId], 'test:approver');
    await postOpening(pool, counter, master);

    const created = await transaction(pool, (client) => createStocktake(client, {
      requestContext: counter,
      payload: { warehouseId: master.warehouseId, scopes: scopes(master) },
    }));
    const counted = await transaction(pool, (client) => countStocktake(client, {
      requestContext: counter,
      stocktakeId: created.stocktake.id,
      payload: {
        expectedRevision: created.stocktake.revision,
        counts: created.stocktake.lines.map((line) => ({ lineId: line.id, countedBaseQuantity: '5.000000000000' })),
      },
    }));

    const movement = await executeInventoryPost({
      adapter: pool,
      requestContext: counter,
      idempotencyKey: `after-snapshot-${randomUUID()}`,
      payload: {
        movementType: 'OPENING_BALANCE',
        sourceDomain: 'INVENTORY',
        sourceDocumentType: 'OPENING_BALANCE_IMPORT',
        sourceDocumentId: `after-snapshot-${randomUUID()}`,
        documentDate: '2026-08-06',
        lines: [{
          warehouseId: master.warehouseId,
          locationId: master.locationOneId,
          sourceVariantId: master.baseVariantId,
          sourceQuantity: '1.000000',
          direction: 'IN',
          sourceLineReference: 'AFTER-SNAPSHOT',
        }],
      },
    });
    assert.equal(movement.ok, true, movement.message);

    const staleSubmit = await transaction(pool, (client) => submitStocktake(client, {
      requestContext: counter,
      stocktakeId: created.stocktake.id,
      payload: { expectedRevision: counted.stocktake.revision },
    }));
    assert.equal(staleSubmit.ok, false);
    assert.equal(staleSubmit.code, 'STOCKTAKE_SCOPE_CHANGED');

    const recounted = await transaction(pool, (client) => requestRecount(client, {
      requestContext: approver,
      stocktakeId: created.stocktake.id,
      payload: { expectedRevision: counted.stocktake.revision, reason: 'Tồn thay đổi sau snapshot' },
    }));
    assert.equal(recounted.ok, true, recounted.message);
    assert.equal(recounted.stocktake.status, 'recount_required');
    assert.equal(recounted.stocktake.currentRound, 2);
    assert.equal(recounted.stocktake.rounds.length, 2);
    assert.equal(recounted.stocktake.rounds[0].status, 'recount_required');
    assert.equal(recounted.stocktake.lines[0].expectedBaseQuantity, undefined);

    const secondCount = await transaction(pool, (client) => countStocktake(client, {
      requestContext: counter,
      stocktakeId: created.stocktake.id,
      payload: {
        expectedRevision: recounted.stocktake.revision,
        counts: recounted.stocktake.lines.map((line) => ({
          lineId: line.id,
          countedBaseQuantity: line.locationId === master.locationOneId ? '11.000000000000' : '5.000000000000',
        })),
      },
    }));
    const submitted = await transaction(pool, (client) => submitStocktake(client, {
      requestContext: counter,
      stocktakeId: created.stocktake.id,
      payload: { expectedRevision: secondCount.stocktake.revision },
    }));
    const approved = await transaction(pool, (client) => approveStocktake(client, {
      requestContext: approver,
      stocktakeId: created.stocktake.id,
      payload: { expectedRevision: submitted.stocktake.revision },
    }));
    assert.equal(approved.ok, true, approved.message);

    const zeroPosted = await transaction(pool, (client) => postStocktake(client, {
      requestContext: approver,
      stocktakeId: created.stocktake.id,
      payload: { expectedRevision: approved.stocktake.revision },
      idempotencyKey: `post-zero-${randomUUID()}`,
    }));
    assert.equal(zeroPosted.ok, true, zeroPosted.message);
    assert.equal(zeroPosted.stocktake.status, 'posted');
    assert.equal(zeroPosted.stocktake.inventoryMovementId, null);

    const detail = await transaction(pool, (client) => getStocktake(client, {
      requestContext: approver,
      stocktakeId: created.stocktake.id,
    }));
    assert.equal(detail.ok, true);
    assert.equal(detail.stocktake.rounds.length, 2);
  } finally {
    await closePool();
  }
});
