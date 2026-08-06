import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { closePool, getPool } from '../src/db/pool.js';
import { executeInventoryPost } from '../src/services/inventory-ledger.js';
import {
  approveInventoryTransfer,
  createInventoryTransfer,
  dispatchInventoryTransfer,
  getInventoryTransfer,
  listInventoryTransferInTransit,
} from '../src/services/inventory-transfer.js';

function testEnv() {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3071',
    INSTALLATION_ID: `inventory-transfer-test-${randomUUID()}`,
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
    actorId: 'test:inventory-transfer-operator',
    employeeId: null,
    sourceApp: 'npp-core-api',
    requestId,
    receivedAt: '2026-08-06T05:30:00.000Z',
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

async function seedTransferMasterData(pool, installationId) {
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const branchId = randomUUID();
  const sourceWarehouseId = randomUUID();
  const destinationWarehouseId = randomUUID();
  const sourceLocationId = randomUUID();
  const unitId = randomUUID();
  const productId = randomUUID();
  const baseVariantId = randomUUID();

  await pool.query(
    `INSERT INTO shared.branches (
       id, installation_id, code, name, is_active, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,true,$5,$5)`,
    [branchId, installationId, `B-${suffix}`, 'Chi nhánh chuyển kho', 'test:seed'],
  );
  await pool.query(
    `INSERT INTO shared.warehouses (
       id, installation_id, branch_id, code, name, warehouse_type, is_active, created_by, updated_by
     ) VALUES
       ($1,$3,$4,$5,'Kho nguồn','main',true,$7,$7),
       ($2,$3,$4,$6,'Kho đích','main',true,$7,$7)`,
    [sourceWarehouseId, destinationWarehouseId, installationId, branchId, `SRC-${suffix}`, `DST-${suffix}`, 'test:seed'],
  );
  await pool.query(
    `INSERT INTO shared.warehouse_locations (
       id, installation_id, warehouse_id, code, name, location_type, is_active, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,'Kệ nguồn','storage',true,$5,$5)`,
    [sourceLocationId, installationId, sourceWarehouseId, `L-${suffix}`, 'test:seed'],
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
     ) VALUES ($1,$2,$3,'Sản phẩm chuyển kho',true,true,true,$4,$4)`,
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

  return { sourceWarehouseId, destinationWarehouseId, sourceLocationId, baseVariantId };
}

test('migration 058 keeps in-transit as a dispatched transfer projection', () => {
  const sql = readFileSync(new URL('../../../database/migrations/inventory/058_inventory_transfer_in_transit_foundation.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS inventory\.inventory_transfers/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS inventory\.inventory_transfer_lines/);
  assert.match(sql, /CREATE OR REPLACE VIEW inventory\.inventory_transfer_in_transit/);
  assert.match(sql, /WHERE transfer\.status = 'dispatched'/);
  assert.doesNotMatch(sql, /INSERT INTO shared\.warehouses[\s\S]*transit/i);
  assert.doesNotMatch(sql, /vehicle_virtual_location/i);
});

test('approved transfer dispatch posts one source issue and exposes in-transit without destination stock', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const master = await seedTransferMasterData(pool, config.installationId);
    const context = requestContext(
      config.installationId,
      [master.sourceWarehouseId, master.destinationWarehouseId],
      `req-transfer-${randomUUID()}`,
    );

    const opening = await executeInventoryPost({
      adapter: pool,
      requestContext: context,
      idempotencyKey: `opening-${randomUUID()}`,
      payload: {
        movementType: 'OPENING_BALANCE',
        sourceDomain: 'INVENTORY',
        sourceDocumentType: 'OPENING_BALANCE_IMPORT',
        sourceDocumentId: `opening-${randomUUID()}`,
        documentDate: '2026-08-06',
        lines: [{
          warehouseId: master.sourceWarehouseId,
          locationId: master.sourceLocationId,
          sourceVariantId: master.baseVariantId,
          sourceQuantity: '10.000000',
          direction: 'IN',
          sourceLineReference: 'OPEN-1',
        }],
      },
    });
    assert.equal(opening.ok, true, opening.message);

    const created = await transaction(pool, (client) => createInventoryTransfer(client, {
      requestContext: context,
      payload: {
        transferDate: '2026-08-06',
        sourceWarehouseId: master.sourceWarehouseId,
        destinationWarehouseId: master.destinationWarehouseId,
        note: 'Chuyển hàng nội bộ kiểm thử',
        lines: [{
          sourceVariantId: master.baseVariantId,
          sourceLocationId: master.sourceLocationId,
          sourceQuantity: '3.000000',
        }],
      },
    }));
    assert.equal(created.ok, true, created.message);
    assert.equal(created.transfer.status, 'draft');
    assert.equal(created.transfer.lines.length, 1);
    assert.equal(created.transfer.lines[0].baseQuantity, '3.000000000000');

    const denied = await transaction(pool, (client) => createInventoryTransfer(client, {
      requestContext: requestContext(config.installationId, [master.sourceWarehouseId], `req-denied-${randomUUID()}`),
      payload: {
        transferDate: '2026-08-06',
        sourceWarehouseId: master.sourceWarehouseId,
        destinationWarehouseId: master.destinationWarehouseId,
        lines: [{ sourceVariantId: master.baseVariantId, sourceQuantity: '1.000000' }],
      },
    }));
    assert.equal(denied.ok, false);
    assert.equal(denied.code, 'WAREHOUSE_SCOPE_DENIED');

    const approved = await transaction(pool, (client) => approveInventoryTransfer(client, {
      requestContext: context,
      id: created.transfer.id,
      payload: { expectedRevision: created.transfer.revision },
      idempotencyKey: `approve-${randomUUID()}`,
    }));
    assert.equal(approved.ok, true, approved.message);
    assert.equal(approved.transfer.status, 'approved');
    assert.match(approved.transfer.documentNumber, /^TR-/);

    const dispatched = await transaction(pool, (client) => dispatchInventoryTransfer(client, {
      requestContext: context,
      id: created.transfer.id,
      payload: { expectedRevision: approved.transfer.revision },
      idempotencyKey: `dispatch-${randomUUID()}`,
    }));
    assert.equal(dispatched.ok, true, dispatched.message);
    assert.equal(dispatched.transfer.status, 'dispatched');
    assert.ok(dispatched.transfer.inventoryMovementId);

    const movement = await pool.query(
      `SELECT movement_type, source_document_type, source_document_id
         FROM inventory.inventory_movements
        WHERE installation_id = $1 AND id = $2`,
      [config.installationId, dispatched.transfer.inventoryMovementId],
    );
    assert.deepEqual(movement.rows[0], {
      movement_type: 'TRANSFER_ISSUE',
      source_document_type: 'INVENTORY_TRANSFER',
      source_document_id: created.transfer.id,
    });

    const ledgerByWarehouse = await pool.query(
      `SELECT warehouse_id, sum(base_quantity_delta)::text AS quantity
         FROM inventory.inventory_movement_lines
        WHERE installation_id = $1 AND base_variant_id = $2
        GROUP BY warehouse_id`,
      [config.installationId, master.baseVariantId],
    );
    const quantityByWarehouse = new Map(ledgerByWarehouse.rows.map((row) => [row.warehouse_id, row.quantity]));
    assert.equal(quantityByWarehouse.get(master.sourceWarehouseId), '7.000000000000');
    assert.equal(quantityByWarehouse.has(master.destinationWarehouseId), false);

    const transit = await listInventoryTransferInTransit(pool, {
      requestContext: context,
      limit: 100,
      offset: 0,
    });
    assert.equal(transit.ok, true);
    assert.equal(transit.inTransit.length, 1);
    assert.equal(transit.inTransit[0].transferId, created.transfer.id);
    assert.equal(transit.inTransit[0].baseQuantity, '3.000000000000');
    assert.equal(transit.inTransit[0].destinationWarehouseId, master.destinationWarehouseId);

    const detail = await getInventoryTransfer(pool, { requestContext: context, id: created.transfer.id });
    assert.equal(detail.ok, true);
    assert.equal(detail.transfer.status, 'dispatched');
    assert.equal(detail.transfer.lines.length, 1);
  } finally {
    await closePool();
  }
});
