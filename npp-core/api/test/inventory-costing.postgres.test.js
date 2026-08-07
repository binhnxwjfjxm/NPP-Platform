import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { closePool, getPool } from '../src/db/pool.js';
import { executeInventoryPost } from '../src/services/inventory-ledger.js';
import {
  rebuildCosting,
  listAnomalies,
  listBalances,
  listReconciliation,
} from '../src/services/inventory-costing.js';

function testEnv() {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3082',
    INSTALLATION_ID: `costing-test-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL
      || process.env.DATABASE_URL
      || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
  };
}

function context(installationId, warehouseIds) {
  return Object.freeze({
    installationId,
    actorId: 'test:costing',
    employeeId: null,
    sourceApp: 'npp-core-api',
    requestId: `req-${randomUUID()}`,
    receivedAt: '2026-08-06T14:00:00.000Z',
    roles: Object.freeze(['bootstrap']),
    permissions: Object.freeze([
      'core.inventory-cost.read',
      'core.inventory-cost.rebuild',
      'core.inventory-cost.reconcile',
    ]),
    scopes: Object.freeze({
      branchIds: Object.freeze([]),
      warehouseIds: Object.freeze(warehouseIds),
      territoryIds: Object.freeze([]),
    }),
  });
}

async function tx(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    if (result.ok) await client.query('COMMIT');
    else await client.query('ROLLBACK');
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
    branchId: randomUUID(),
    sourceWarehouseId: randomUUID(),
    destinationWarehouseId: randomUUID(),
    sourceLocationId: randomUUID(),
    destinationLocationId: randomUUID(),
    unitId: randomUUID(),
    productId: randomUUID(),
    variantId: randomUUID(),
    anomalyProductId: randomUUID(),
    anomalyVariantId: randomUUID(),
  };
  await pool.query(
    `INSERT INTO shared.branches
      (id,installation_id,code,name,is_active,created_by,updated_by)
     VALUES ($1,$2,$3,'Chi nhánh giá vốn',true,'test:seed','test:seed')`,
    [ids.branchId, installationId, `B-${suffix}`],
  );
  await pool.query(
    `INSERT INTO shared.warehouses
      (id,installation_id,branch_id,code,name,warehouse_type,is_active,created_by,updated_by)
     VALUES
      ($1,$3,$4,$5,'Kho nguồn','main',true,'test:seed','test:seed'),
      ($2,$3,$4,$6,'Kho đích','main',true,'test:seed','test:seed')`,
    [
      ids.sourceWarehouseId,
      ids.destinationWarehouseId,
      installationId,
      ids.branchId,
      `SRC-${suffix}`,
      `DST-${suffix}`,
    ],
  );
  await pool.query(
    `INSERT INTO shared.warehouse_locations
      (id,installation_id,warehouse_id,code,name,location_type,is_active,created_by,updated_by)
     VALUES
      ($1,$3,$4,$5,'Kệ nguồn','storage',true,'test:seed','test:seed'),
      ($2,$3,$6,$7,'Kệ đích','storage',true,'test:seed','test:seed')`,
    [
      ids.sourceLocationId,
      ids.destinationLocationId,
      installationId,
      ids.sourceWarehouseId,
      `SL-${suffix}`,
      ids.destinationWarehouseId,
      `DL-${suffix}`,
    ],
  );
  await pool.query(
    `INSERT INTO shared.units_of_measure
      (id,installation_id,code,name,unit_kind,allows_fractional,is_active,created_by,updated_by)
     VALUES ($1,$2,$3,'Cái','COUNT',true,true,'test:seed','test:seed')`,
    [ids.unitId, installationId, `EA${suffix}`],
  );
  await pool.query(
    `INSERT INTO shared.products
      (id,installation_id,code,name,is_catalog_visible,is_orderable,is_active,created_by,updated_by)
     VALUES
      ($1,$3,$4,'Sản phẩm có giá',true,true,true,'test:seed','test:seed'),
      ($2,$3,$5,'Sản phẩm thiếu giá',true,true,true,'test:seed','test:seed')`,
    [
      ids.productId,
      ids.anomalyProductId,
      installationId,
      `P-${suffix}`,
      `PX-${suffix}`,
    ],
  );
  await pool.query(
    `INSERT INTO shared.product_variants
      (id,installation_id,product_id,sku,name,variant_kind,is_inventory_base,
       is_sellable,is_catalog_visible,is_active,unit_id,conversion_to_base,
       is_purchasable,created_by,updated_by)
     VALUES
      ($1,$3,$4,$5,'SKU có giá','BASE',true,true,true,true,$6,1,true,'test:seed','test:seed'),
      ($2,$3,$7,$8,'SKU thiếu giá','BASE',true,true,true,true,$6,1,true,'test:seed','test:seed')`,
    [
      ids.variantId,
      ids.anomalyVariantId,
      installationId,
      ids.productId,
      `SKU-${suffix}`,
      ids.unitId,
      ids.anomalyProductId,
      `SKUX-${suffix}`,
    ],
  );
  for (const variantId of [ids.variantId, ids.anomalyVariantId]) {
    await pool.query(
      `INSERT INTO inventory.product_tracking_policies
        (installation_id,base_variant_id,lot_tracking_mode,expiry_tracking_mode,
         location_required,version,created_at,created_by,updated_at,updated_by)
       VALUES ($1,$2,'NONE','NONE',true,1,now(),'test:seed',now(),'test:seed')`,
      [installationId, variantId],
    );
  }
  return ids;
}

async function insertTransferReceiptFixture(pool, requestContext, payload) {
  assert.equal(payload.lines.length, 1, 'Transfer receipt fixture expects one line');
  const line = payload.lines[0];
  const snapshot = await pool.query(
    `SELECT variant.sku, variant.unit_id, unit.code AS unit_code
       FROM shared.product_variants variant
       JOIN shared.units_of_measure unit
         ON unit.installation_id = variant.installation_id
        AND unit.id = variant.unit_id
      WHERE variant.installation_id = $1
        AND variant.id = $2`,
    [requestContext.installationId, line.sourceVariantId],
  );
  assert.equal(snapshot.rowCount, 1, 'Transfer receipt variant snapshot must exist');
  const movementId = randomUUID();
  const movementLineId = randomUUID();
  await pool.query(
    `INSERT INTO inventory.inventory_movements
      (id, installation_id, movement_type, source_domain,
       source_document_type, source_document_id, document_date,
       posted_at, posted_by, request_id, source_app, idempotency_key,
       payload_hash, reason_code, reason_note, metadata)
     VALUES
      ($1,$2,'TRANSFER_RECEIPT',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
       'TRANSFER_RECEIPT','Transfer receipt test fixture',$13::jsonb)`,
    [
      movementId,
      requestContext.installationId,
      payload.sourceDomain,
      payload.sourceDocumentType,
      payload.sourceDocumentId,
      payload.documentDate,
      requestContext.receivedAt,
      requestContext.actorId,
      requestContext.requestId,
      requestContext.sourceApp,
      `costing-transfer-receipt-${randomUUID()}`,
      '0'.repeat(64),
      JSON.stringify(payload.metadata ?? {}),
    ],
  );
  await pool.query(
    `INSERT INTO inventory.inventory_movement_lines
      (id, installation_id, movement_id, line_number, warehouse_id,
       location_id, source_variant_id, source_sku, source_unit_id,
       source_unit_code, source_quantity, conversion_to_base,
       base_variant_id, base_sku, direction, base_quantity_delta,
       source_line_reference, metadata)
     VALUES
      ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,1,$6,$7,'IN',$10,$11,$12::jsonb)`,
    [
      movementLineId,
      requestContext.installationId,
      movementId,
      line.warehouseId,
      line.locationId,
      line.sourceVariantId,
      snapshot.rows[0].sku,
      snapshot.rows[0].unit_id,
      snapshot.rows[0].unit_code,
      line.sourceQuantity,
      line.sourceLineReference,
      JSON.stringify(line.metadata ?? {}),
    ],
  );
  return Object.freeze({
    ok: true,
    movement: Object.freeze({ id: movementId }),
    lines: Object.freeze([Object.freeze({ id: movementLineId })]),
  });
}

async function postMovement(pool, requestContext, payload) {
  if (payload.movementType === 'TRANSFER_RECEIPT') {
    return insertTransferReceiptFixture(pool, requestContext, payload);
  }
  const result = await executeInventoryPost({
    adapter: pool,
    requestContext,
    idempotencyKey: `costing-movement-${randomUUID()}`,
    payload,
  });
  assert.equal(result.ok, true, result.message);
  return result;
}

test('moving-average rebuild preserves transfer carrying cost and exposes source anomalies', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const ids = await seed(pool, config.installationId);
    const requestContext = context(
      config.installationId,
      [ids.sourceWarehouseId, ids.destinationWarehouseId],
    );
    await postMovement(pool, requestContext, {
      movementType: 'OPENING_BALANCE',
      sourceDomain: 'INVENTORY',
      sourceDocumentType: 'OPENING_BALANCE_IMPORT',
      sourceDocumentId: `opening-${randomUUID()}`,
      documentDate: '2026-08-01',
      lines: [{
        warehouseId: ids.sourceWarehouseId,
        locationId: ids.sourceLocationId,
        sourceVariantId: ids.variantId,
        sourceQuantity: '10.000000',
        direction: 'IN',
        sourceLineReference: 'OPEN-COSTED',
        metadata: {
          unitCost: '100.000000000000',
          currencyCode: 'VND',
        },
      }],
    });
    const transferLineId = randomUUID();
    await postMovement(pool, requestContext, {
      movementType: 'TRANSFER_ISSUE',
      sourceDomain: 'INVENTORY',
      sourceDocumentType: 'INVENTORY_TRANSFER',
      sourceDocumentId: randomUUID(),
      documentDate: '2026-08-02',
      lines: [{
        warehouseId: ids.sourceWarehouseId,
        locationId: ids.sourceLocationId,
        sourceVariantId: ids.variantId,
        sourceQuantity: '4.000000',
        direction: 'OUT',
        sourceLineReference: 'TRANSFER-OUT',
        metadata: { inventoryTransferLineId: transferLineId },
      }],
    });
    await postMovement(pool, requestContext, {
      movementType: 'TRANSFER_RECEIPT',
      sourceDomain: 'INVENTORY',
      sourceDocumentType: 'INVENTORY_TRANSFER_RECEIPT',
      sourceDocumentId: randomUUID(),
      documentDate: '2026-08-03',
      lines: [{
        warehouseId: ids.destinationWarehouseId,
        locationId: ids.destinationLocationId,
        sourceVariantId: ids.variantId,
        sourceQuantity: '4.000000',
        direction: 'IN',
        sourceLineReference: 'TRANSFER-IN',
        metadata: { inventoryTransferLineId: transferLineId },
      }],
    });
    await postMovement(pool, requestContext, {
      movementType: 'OPENING_BALANCE',
      sourceDomain: 'INVENTORY',
      sourceDocumentType: 'OPENING_BALANCE_IMPORT',
      sourceDocumentId: `opening-${randomUUID()}`,
      documentDate: '2026-08-04',
      lines: [{
        warehouseId: ids.sourceWarehouseId,
        locationId: ids.sourceLocationId,
        sourceVariantId: ids.anomalyVariantId,
        sourceQuantity: '2.000000',
        direction: 'IN',
        sourceLineReference: 'OPEN-MISSING-COST',
      }],
    });

    const idempotencyKey = `costing-rebuild-${randomUUID()}`;
    const rebuilt = await tx(pool, (client) => rebuildCosting(client, {
      requestContext,
      idempotencyKey,
      payload: {
        warehouseIds: [
          ids.destinationWarehouseId,
          ids.sourceWarehouseId,
        ],
      },
    }));
    assert.equal(rebuilt.ok, true, rebuilt.message);
    assert.equal(rebuilt.replayed, false);
    assert.equal(rebuilt.run.methodVersion, 'MWA_V1');

    const balances = await listBalances(pool, {
      requestContext,
      limit: 100,
      offset: 0,
    });
    assert.equal(balances.ok, true);
    const source = balances.balances.find(
      (row) => row.warehouseId === ids.sourceWarehouseId
        && row.baseVariantId === ids.variantId,
    );
    const destination = balances.balances.find(
      (row) => row.warehouseId === ids.destinationWarehouseId
        && row.baseVariantId === ids.variantId,
    );
    const anomalyBalance = balances.balances.find(
      (row) => row.baseVariantId === ids.anomalyVariantId,
    );
    assert.equal(source.quantity, '6.000000000000');
    assert.equal(source.inventoryValue, '600.000000000000');
    assert.equal(source.averageUnitCost, '100.000000000000');
    assert.equal(destination.quantity, '4.000000000000');
    assert.equal(destination.inventoryValue, '400.000000000000');
    assert.equal(destination.averageUnitCost, '100.000000000000');
    assert.equal(anomalyBalance.status, 'ANOMALY');
    assert.equal(anomalyBalance.inventoryValue, null);

    const anomalies = await listAnomalies(pool, {
      requestContext,
      limit: 100,
      offset: 0,
    });
    assert.equal(
      anomalies.anomalies.some((row) => row.code === 'OPENING_COST_MISSING'),
      true,
    );

    const reconciliation = await listReconciliation(pool, {
      requestContext,
      status: null,
      limit: 100,
      offset: 0,
    });
    assert.equal(
      reconciliation.reconciliation.every(
        (row) => row.quantityDifference === '0.000000000000',
      ),
      true,
    );
    assert.equal(
      reconciliation.reconciliation.some(
        (row) => row.reconciliationStatus === 'COST_ANOMALY',
      ),
      true,
    );

    const replay = await tx(pool, (client) => rebuildCosting(client, {
      requestContext,
      idempotencyKey,
      payload: {
        warehouseIds: [
          ids.sourceWarehouseId,
          ids.destinationWarehouseId,
        ],
      },
    }));
    assert.equal(replay.ok, true);
    assert.equal(replay.replayed, true);
    assert.equal(replay.run.id, rebuilt.run.id);

    await assert.rejects(
      pool.query(
        `UPDATE inventory.inventory_cost_facts
            SET source_cost_type = 'ILLEGAL'
          WHERE installation_id = $1
            AND rebuild_run_id = $2`,
        [config.installationId, rebuilt.run.id],
      ),
      /inventory_cost_facts_are_append_only/,
    );
    await assert.rejects(
      pool.query(
        `UPDATE inventory.inventory_cost_balances
            SET anomaly_count = anomaly_count
          WHERE installation_id = $1`,
        [config.installationId],
      ),
      /inventory_cost_balances_projector_only/,
    );
  } finally {
    await closePool();
  }
});
