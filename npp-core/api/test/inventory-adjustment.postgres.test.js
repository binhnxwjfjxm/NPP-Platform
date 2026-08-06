import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { closePool, getPool } from '../src/db/pool.js';
import { executeInventoryPost } from '../src/services/inventory-ledger.js';
import { listAllocationCandidates } from '../src/db/repositories/sales-fulfillment-operations.js';
import { resolveWarehouseLocation } from '../src/db/repositories/inventory-reservations.js';
import {
  approveAdjustment,
  createAdjustment,
  postAdjustment,
  reverseAdjustment,
  submitAdjustment,
} from '../src/services/inventory-adjustment.js';

function testEnv() {
  return {
    NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '3081',
    INSTALLATION_ID: `adjustment-test-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable', BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap', CORS_ORIGINS: 'http://127.0.0.1:3003',
  };
}

function context(installationId, warehouseIds, actorId) {
  return Object.freeze({
    installationId, actorId, employeeId: null, sourceApp: 'npp-core-api',
    requestId: `req-${randomUUID()}`, receivedAt: '2026-08-06T12:00:00.000Z',
    roles: Object.freeze(['bootstrap']), permissions: Object.freeze([]),
    scopes: Object.freeze({ branchIds: Object.freeze([]), warehouseIds: Object.freeze(warehouseIds), territoryIds: Object.freeze([]) }),
  });
}

async function tx(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    if (result.ok) await client.query('COMMIT'); else await client.query('ROLLBACK');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function seed(pool, installationId) {
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const ids = {
    branchId: randomUUID(), warehouseId: randomUUID(), otherWarehouseId: randomUUID(),
    storageId: randomUUID(), quarantineId: randomUUID(), damagedId: randomUUID(),
    unitId: randomUUID(), productId: randomUUID(), variantId: randomUUID(),
  };
  await pool.query(`INSERT INTO shared.branches (id,installation_id,code,name,is_active,created_by,updated_by)
    VALUES ($1,$2,$3,'Chi nhánh điều chỉnh',true,'test:seed','test:seed')`, [ids.branchId, installationId, `B-${suffix}`]);
  await pool.query(`INSERT INTO shared.warehouses
    (id,installation_id,branch_id,code,name,warehouse_type,is_active,created_by,updated_by)
    VALUES ($1,$3,$4,$5,'Kho điều chỉnh','main',true,'test:seed','test:seed'),
           ($2,$3,$4,$6,'Kho ngoài phạm vi','main',true,'test:seed','test:seed')`,
  [ids.warehouseId, ids.otherWarehouseId, installationId, ids.branchId, `ADJ-${suffix}`, `OTH-${suffix}`]);
  await pool.query(`INSERT INTO shared.warehouse_locations
    (id,installation_id,warehouse_id,code,name,location_type,is_active,created_by,updated_by)
    VALUES ($1,$4,$5,$6,'Kệ khả dụng','storage',true,'test:seed','test:seed'),
           ($2,$4,$5,$7,'Vị trí cách ly','quarantine',true,'test:seed','test:seed'),
           ($3,$4,$5,$8,'Vị trí hư hỏng','damaged',true,'test:seed','test:seed')`,
  [ids.storageId, ids.quarantineId, ids.damagedId, installationId, ids.warehouseId, `ST-${suffix}`, `Q-${suffix}`, `DM-${suffix}`]);
  await pool.query(`INSERT INTO shared.units_of_measure
    (id,installation_id,code,name,unit_kind,allows_fractional,is_active,created_by,updated_by)
    VALUES ($1,$2,$3,'Cái','COUNT',true,true,'test:seed','test:seed')`, [ids.unitId, installationId, `EA${suffix}`]);
  await pool.query(`INSERT INTO shared.products
    (id,installation_id,code,name,is_catalog_visible,is_orderable,is_active,created_by,updated_by)
    VALUES ($1,$2,$3,'Sản phẩm điều chỉnh',true,true,true,'test:seed','test:seed')`, [ids.productId, installationId, `P-${suffix}`]);
  await pool.query(`INSERT INTO shared.product_variants
    (id,installation_id,product_id,sku,name,variant_kind,is_inventory_base,is_sellable,is_catalog_visible,is_active,unit_id,conversion_to_base,is_purchasable,created_by,updated_by)
    VALUES ($1,$2,$3,$4,'SKU cơ sở','BASE',true,true,true,true,$5,1,true,'test:seed','test:seed')`,
  [ids.variantId, installationId, ids.productId, `SKU-${suffix}`, ids.unitId]);
  await pool.query(`INSERT INTO inventory.product_tracking_policies
    (installation_id,base_variant_id,lot_tracking_mode,expiry_tracking_mode,location_required,version,created_at,created_by,updated_at,updated_by)
    VALUES ($1,$2,'NONE','NONE',true,1,now(),'test:seed',now(),'test:seed')`, [installationId, ids.variantId]);
  return ids;
}

async function opening(pool, requestContext, ids, quantity = '20.000000') {
  const result = await executeInventoryPost({
    adapter: pool, requestContext, idempotencyKey: `opening-${randomUUID()}`,
    payload: {
      movementType: 'OPENING_BALANCE', sourceDomain: 'INVENTORY', sourceDocumentType: 'OPENING_BALANCE_IMPORT',
      sourceDocumentId: `opening-${randomUUID()}`, documentDate: '2026-08-06',
      lines: [{ warehouseId: ids.warehouseId, locationId: ids.storageId, sourceVariantId: ids.variantId,
        sourceQuantity: quantity, direction: 'IN', sourceLineReference: 'OPEN-STORAGE' }],
    },
  });
  assert.equal(result.ok, true, result.message);
}

function payload(ids, documentKind, quantity, destinationLocationId = null) {
  const maps = {
    QUARANTINE_TRANSFER: ['QUALITY_HOLD', null],
    DAMAGED_TRANSFER: ['PHYSICAL_DAMAGE', null],
    SCRAP: ['APPROVED_SCRAP_EXPIRED', null],
    MANUAL_ADJUSTMENT: ['MANUAL_COUNT_CORRECTION_OUT', 'OUT'],
  };
  return {
    warehouseId: ids.warehouseId,
    documentKind,
    adjustmentDirection: maps[documentKind][1],
    reasonCode: maps[documentKind][0],
    reasonNote: `Lý do kiểm thử ${documentKind}`,
    lines: [{ sourceLocationId: ids.storageId, destinationLocationId, sourceVariantId: ids.variantId, quantity }],
  };
}

async function approveAndPost(pool, creator, approver, created) {
  const submitted = await tx(pool, (client) => submitAdjustment(client, {
    requestContext: creator, adjustmentId: created.adjustment.id,
    payload: { expectedRevision: created.adjustment.revision },
  }));
  assert.equal(submitted.ok, true, submitted.message);
  const selfDenied = await tx(pool, (client) => approveAdjustment(client, {
    requestContext: creator, adjustmentId: created.adjustment.id,
    payload: { expectedRevision: submitted.adjustment.revision },
  }));
  assert.equal(selfDenied.ok, false);
  assert.equal(selfDenied.code, 'INVENTORY_ADJUSTMENT_SELF_APPROVAL_DENIED');
  const approved = await tx(pool, (client) => approveAdjustment(client, {
    requestContext: approver, adjustmentId: created.adjustment.id,
    payload: { expectedRevision: submitted.adjustment.revision },
  }));
  assert.equal(approved.ok, true, approved.message);
  const posted = await tx(pool, (client) => postAdjustment(client, {
    requestContext: approver, adjustmentId: created.adjustment.id,
    payload: { expectedRevision: approved.adjustment.revision }, idempotencyKey: `post-${randomUUID()}`,
  }));
  assert.equal(posted.ok, true, posted.message);
  return posted.adjustment;
}

test('migration 061 stays append-only and owns disposition constraints', () => {
  const sql = readFileSync(new URL('../../../database/migrations/inventory/061_inventory_adjustments.sql', import.meta.url), 'utf8');
  assert.match(sql, /inventory_adjustment_reasons/);
  assert.match(sql, /inventory_adjustments_creator_approver_separation_ck/);
  assert.match(sql, /inventory_adjustment_quarantine_destination_invalid/);
  assert.match(sql, /inventory_adjustment_damaged_destination_invalid/);
  assert.match(sql, /inventory_adjustment_status_transition_invalid/);
  assert.match(sql, /inventory_adjustment_history_is_append_only/);
  assert.doesNotMatch(sql, /UPDATE\s+inventory\.inventory_balances/i);
});

test('quarantine is paired, scrap is exact OUT, stale and downstream gates fail closed', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const ids = await seed(pool, config.installationId);
    const creator = context(config.installationId, [ids.warehouseId], 'test:creator');
    const approver = context(config.installationId, [ids.warehouseId], 'test:approver');
    await opening(pool, creator, ids);

    const denied = await tx(pool, (client) => createAdjustment(client, {
      requestContext: context(config.installationId, [ids.otherWarehouseId], 'test:outsider'),
      payload: payload(ids, 'SCRAP', '1.000000'),
    }));
    assert.equal(denied.code, 'WAREHOUSE_SCOPE_DENIED');

    const quarantine = await tx(pool, (client) => createAdjustment(client, {
      requestContext: creator, payload: payload(ids, 'QUARANTINE_TRANSFER', '3.000000', ids.quarantineId),
    }));
    assert.equal(quarantine.ok, true, quarantine.message);
    const quarantinePosted = await approveAndPost(pool, creator, approver, quarantine);
    const pair = await pool.query(`SELECT direction, location_id, base_quantity_delta::text AS delta
      FROM inventory.inventory_movement_lines WHERE installation_id=$1 AND movement_id=$2 ORDER BY line_number`,
    [config.installationId, quarantinePosted.inventoryMovementId]);
    assert.deepEqual(pair.rows.map((row) => row.direction), ['OUT', 'IN']);
    assert.deepEqual(pair.rows.map((row) => row.location_id), [ids.storageId, ids.quarantineId]);

    const candidates = await listAllocationCandidates(pool, {
      installationId: config.installationId, warehouseId: ids.warehouseId, baseVariantId: ids.variantId,
    });
    assert.equal(candidates.some((row) => row.location_id === ids.quarantineId), false);
    assert.equal(candidates.some((row) => row.location_id === ids.damagedId), false);
    const reservationLocation = await resolveWarehouseLocation(pool, {
      installationId: config.installationId, warehouseId: ids.warehouseId, locationId: ids.quarantineId,
    });
    assert.equal(reservationLocation.location_id, null);

    const damaged = await tx(pool, (client) => createAdjustment(client, {
      requestContext: creator, payload: payload(ids, 'DAMAGED_TRANSFER', '1.000000', ids.damagedId),
    }));
    assert.equal(damaged.ok, true, damaged.message);
    const damagedPosted = await approveAndPost(pool, creator, approver, damaged);
    const damagedPair = await pool.query(`SELECT direction, location_id
      FROM inventory.inventory_movement_lines WHERE installation_id=$1 AND movement_id=$2 ORDER BY line_number`,
    [config.installationId, damagedPosted.inventoryMovementId]);
    assert.deepEqual(damagedPair.rows.map((row) => row.direction), ['OUT', 'IN']);
    assert.deepEqual(damagedPair.rows.map((row) => row.location_id), [ids.storageId, ids.damagedId]);

    const scrap = await tx(pool, (client) => createAdjustment(client, {
      requestContext: creator, payload: payload(ids, 'SCRAP', '2.000000'),
    }));
    const scrapPosted = await approveAndPost(pool, creator, approver, scrap);
    const scrapLines = await pool.query(`SELECT direction, base_quantity_delta::text AS delta
      FROM inventory.inventory_movement_lines WHERE installation_id=$1 AND movement_id=$2`,
    [config.installationId, scrapPosted.inventoryMovementId]);
    assert.equal(scrapLines.rowCount, 1);
    assert.equal(scrapLines.rows[0].direction, 'OUT');
    assert.equal(scrapLines.rows[0].delta, '-2.000000000000');

    const stale = await tx(pool, (client) => createAdjustment(client, {
      requestContext: creator, payload: payload(ids, 'MANUAL_ADJUSTMENT', '1.000000'),
    }));
    const staleMovement = await executeInventoryPost({
      adapter: pool, requestContext: creator, idempotencyKey: `downstream-${randomUUID()}`,
      payload: { movementType: 'PURCHASE_RECEIPT', sourceDomain: 'PURCHASING', sourceDocumentType: 'GOODS_RECEIPT', sourceDocumentId: randomUUID(), documentDate: '2026-08-06',
        lines: [{ warehouseId: ids.warehouseId, locationId: ids.storageId, sourceVariantId: ids.variantId, sourceQuantity: '1.000000', direction: 'IN', sourceLineReference: 'STALE' }] },
    });
    assert.equal(staleMovement.ok, true, staleMovement.message);
    const staleSubmit = await tx(pool, (client) => submitAdjustment(client, {
      requestContext: creator, adjustmentId: stale.adjustment.id, payload: { expectedRevision: stale.adjustment.revision },
    }));
    assert.equal(staleSubmit.code, 'INVENTORY_ADJUSTMENT_SCOPE_CHANGED');

    const afterScrapMovement = await executeInventoryPost({
      adapter: pool, requestContext: creator, idempotencyKey: `after-scrap-${randomUUID()}`,
      payload: { movementType: 'PURCHASE_RECEIPT', sourceDomain: 'PURCHASING', sourceDocumentType: 'GOODS_RECEIPT', sourceDocumentId: randomUUID(), documentDate: '2026-08-06',
        lines: [{ warehouseId: ids.warehouseId, locationId: ids.storageId, sourceVariantId: ids.variantId, sourceQuantity: '1.000000', direction: 'IN', sourceLineReference: 'AFTER-SCRAP' }] },
    });
    assert.equal(afterScrapMovement.ok, true, afterScrapMovement.message);
    const reverse = await tx(pool, (client) => reverseAdjustment(client, {
      requestContext: approver, adjustmentId: scrapPosted.id,
      payload: { expectedRevision: scrapPosted.revision, reason: 'Thử đảo sau downstream' },
      idempotencyKey: `reverse-${randomUUID()}`,
    }));
    assert.equal(reverse.code, 'INVENTORY_ADJUSTMENT_REVERSAL_DOWNSTREAM_CONFLICT');
  } finally {
    await closePool();
  }
});
