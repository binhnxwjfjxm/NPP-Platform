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
  listInventoryTransferInTransit,
} from '../src/services/inventory-transfer.js';
import {
  approveTransferReceiptDamage,
  closeTransferShortage,
  createTransferReceipt,
  listTransferReceipts,
  reverseTransferReceipt,
} from '../src/services/inventory-transfer-receipt.js';

function testEnv() {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3072',
    INSTALLATION_ID: `inventory-transfer-receipt-test-${randomUUID()}`,
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
    actorId: 'test:inventory-transfer-receiver',
    employeeId: null,
    sourceApp: 'npp-core-api',
    requestId,
    receivedAt: '2026-08-06T06:30:00.000Z',
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

async function seedMasterData(pool, installationId) {
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const branchId = randomUUID();
  const sourceWarehouseId = randomUUID();
  const destinationWarehouseId = randomUUID();
  const sourceLocationId = randomUUID();
  const destinationLocationId = randomUUID();
  const unitId = randomUUID();
  const productId = randomUUID();
  const baseVariantId = randomUUID();

  await pool.query(
    `INSERT INTO shared.branches (
       id, installation_id, code, name, is_active, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,true,$5,$5)`,
    [branchId, installationId, `B-${suffix}`, 'Chi nhánh nhận chuyển kho', 'test:seed'],
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
     ) VALUES
       ($1,$3,$4,$5,'Kệ nguồn','storage',true,$7,$7),
       ($2,$3,$6,$5,'Kệ đích','storage',true,$7,$7)`,
    [sourceLocationId, destinationLocationId, installationId, sourceWarehouseId, `L-${suffix}`, destinationWarehouseId, 'test:seed'],
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
     ) VALUES ($1,$2,$3,'Sản phẩm nhận chuyển kho',true,true,true,$4,$4)`,
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
  return {
    sourceWarehouseId,
    destinationWarehouseId,
    sourceLocationId,
    destinationLocationId,
    baseVariantId,
  };
}

async function createDispatchedTransfer(pool, context, master, quantity) {
  const created = await transaction(pool, (client) => createInventoryTransfer(client, {
    requestContext: context,
    payload: {
      transferDate: '2026-08-06',
      sourceWarehouseId: master.sourceWarehouseId,
      destinationWarehouseId: master.destinationWarehouseId,
      lines: [{
        sourceVariantId: master.baseVariantId,
        sourceLocationId: master.sourceLocationId,
        sourceQuantity: quantity,
      }],
    },
  }));
  assert.equal(created.ok, true, created.message);
  const approved = await transaction(pool, (client) => approveInventoryTransfer(client, {
    requestContext: context,
    id: created.transfer.id,
    payload: { expectedRevision: created.transfer.revision },
    idempotencyKey: `approve-${randomUUID()}`,
  }));
  assert.equal(approved.ok, true, approved.message);
  const dispatched = await transaction(pool, (client) => dispatchInventoryTransfer(client, {
    requestContext: context,
    id: created.transfer.id,
    payload: { expectedRevision: approved.transfer.revision },
    idempotencyKey: `dispatch-${randomUUID()}`,
  }));
  assert.equal(dispatched.ok, true, dispatched.message);
  return dispatched.transfer;
}

test('migration 059 keeps transfer receipt and variance facts append-only', () => {
  const sql = readFileSync(new URL('../../../database/migrations/inventory/059_inventory_transfer_receipt_resolution.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS inventory\.inventory_transfer_receipts/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS inventory\.inventory_transfer_receipt_lines/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS inventory\.inventory_transfer_short_closures/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS inventory\.inventory_transfer_receipt_reversals/);
  assert.match(sql, /inventory_transfer_resolution_rows_are_append_only/);
  assert.match(sql, /remaining_base_quantity > 0/);
  assert.doesNotMatch(sql, /UPDATE\s+inventory\.inventory_balances/i);
});

test('partial receipt posts accepted stock, isolates damage and overage, then closes shortage', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const master = await seedMasterData(pool, config.installationId);
    const context = requestContext(config.installationId, [master.sourceWarehouseId, master.destinationWarehouseId], `req-${randomUUID()}`);
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

    const transfer = await createDispatchedTransfer(pool, context, master, '6.000000');
    const receipt = await transaction(pool, (client) => createTransferReceipt(client, {
      requestContext: context,
      transferId: transfer.id,
      idempotencyKey: `receive-${randomUUID()}`,
      payload: {
        receiptDate: '2026-08-06',
        note: 'Nhận lần đầu',
        lines: [{
          transferLineId: transfer.lines[0].id,
          destinationLocationId: master.destinationLocationId,
          acceptedQuantity: '3.000000',
          damagedQuantity: '1.000000',
          overQuantity: '2.000000',
          note: 'Hai cái thừa chờ xác minh',
        }],
      },
    }));
    assert.equal(receipt.ok, true, receipt.message);
    assert.ok(receipt.receipt.inventoryMovementId);
    assert.equal(receipt.receipt.lines[0].acceptedQuantity, '3.000000');
    assert.equal(receipt.receipt.lines[0].damagedQuantity, '1.000000');
    assert.equal(receipt.receipt.lines[0].overQuantity, '2.000000');

    const movement = await pool.query(
      `SELECT movement_type, source_document_type
         FROM inventory.inventory_movements
        WHERE installation_id = $1 AND id = $2`,
      [config.installationId, receipt.receipt.inventoryMovementId],
    );
    assert.deepEqual(movement.rows[0], {
      movement_type: 'TRANSFER_RECEIPT',
      source_document_type: 'INVENTORY_TRANSFER_RECEIPT',
    });

    const destinationBalance = await pool.query(
      `SELECT on_hand_quantity::text, available_quantity::text
         FROM inventory.inventory_balances
        WHERE installation_id = $1
          AND warehouse_id = $2
          AND location_id = $3
          AND base_variant_id = $4`,
      [config.installationId, master.destinationWarehouseId, master.destinationLocationId, master.baseVariantId],
    );
    assert.equal(destinationBalance.rows[0].on_hand_quantity, '3.000000000000');
    assert.equal(destinationBalance.rows[0].available_quantity, '3.000000000000');

    const transit = await listInventoryTransferInTransit(pool, { requestContext: context, limit: 100, offset: 0 });
    assert.equal(transit.ok, true);
    assert.equal(transit.inTransit.length, 1);
    assert.equal(transit.inTransit[0].sourceQuantity, '2.000000');
    assert.equal(transit.inTransit[0].baseQuantity, '2.000000000000');

    const listed = await listTransferReceipts(pool, { requestContext: context, transferId: transfer.id });
    assert.equal(listed.ok, true, listed.message);
    assert.equal(listed.receipts.length, 1);
    assert.equal(listed.resolution[0].acceptedQuantity, '3.000000');
    assert.equal(listed.resolution[0].damagedQuantity, '1.000000');
    assert.equal(listed.resolution[0].overQuantity, '2.000000');
    assert.equal(listed.resolution[0].remainingQuantity, '2.000000');

    const damageApproval = await transaction(pool, (client) => approveTransferReceiptDamage(client, {
      requestContext: context,
      transferId: transfer.id,
      receiptId: receipt.receipt.id,
      payload: { note: 'Quản lý kho xác nhận biên bản hư hỏng' },
    }));
    assert.equal(damageApproval.ok, true, damageApproval.message);
    assert.ok(damageApproval.receipt.damageApproval);

    const closure = await transaction(pool, (client) => closeTransferShortage(client, {
      requestContext: context,
      transferId: transfer.id,
      payload: { reason: 'Xác minh phần còn lại thất lạc, không tiếp tục giao' },
    }));
    assert.equal(closure.ok, true, closure.message);
    assert.equal(closure.resolution[0].shortQuantity, '2.000000');
    assert.equal(closure.resolution[0].remainingQuantity, '0.000000');

    const noTransit = await listInventoryTransferInTransit(pool, { requestContext: context, limit: 100, offset: 0 });
    assert.equal(noTransit.ok, true);
    assert.equal(noTransit.inTransit.length, 0);

    const receiveAfterClose = await transaction(pool, (client) => createTransferReceipt(client, {
      requestContext: context,
      transferId: transfer.id,
      idempotencyKey: `receive-after-close-${randomUUID()}`,
      payload: {
        receiptDate: '2026-08-06',
        lines: [{
          transferLineId: transfer.lines[0].id,
          destinationLocationId: master.destinationLocationId,
          overQuantity: '1.000000',
        }],
      },
    }));
    assert.equal(receiveAfterClose.ok, false);
    assert.equal(receiveAfterClose.code, 'TRANSFER_SHORT_CLOSED');

    const reverseAfterClose = await transaction(pool, (client) => reverseTransferReceipt(client, {
      requestContext: context,
      transferId: transfer.id,
      receiptId: receipt.receipt.id,
      idempotencyKey: `reverse-after-close-${randomUUID()}`,
      payload: { documentDate: '2026-08-06', reason: 'Không cho đảo sau đóng thiếu' },
    }));
    assert.equal(reverseAfterClose.ok, false);
    assert.equal(reverseAfterClose.code, 'SHORT_CLOSURE_BLOCKS_RECEIPT_REVERSAL');
  } finally {
    await closePool();
  }
});

test('receipt reversal reopens in-transit before downstream consumption', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    const master = await seedMasterData(pool, config.installationId);
    const context = requestContext(config.installationId, [master.sourceWarehouseId, master.destinationWarehouseId], `req-${randomUUID()}`);
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
          sourceQuantity: '4.000000',
          direction: 'IN',
          sourceLineReference: 'OPEN-1',
        }],
      },
    });
    assert.equal(opening.ok, true, opening.message);
    const transfer = await createDispatchedTransfer(pool, context, master, '2.000000');
    const receipt = await transaction(pool, (client) => createTransferReceipt(client, {
      requestContext: context,
      transferId: transfer.id,
      idempotencyKey: `receive-${randomUUID()}`,
      payload: {
        receiptDate: '2026-08-06',
        lines: [{
          transferLineId: transfer.lines[0].id,
          destinationLocationId: master.destinationLocationId,
          acceptedQuantity: '2.000000',
        }],
      },
    }));
    assert.equal(receipt.ok, true, receipt.message);

    const reversed = await transaction(pool, (client) => reverseTransferReceipt(client, {
      requestContext: context,
      transferId: transfer.id,
      receiptId: receipt.receipt.id,
      idempotencyKey: `reverse-${randomUUID()}`,
      payload: { documentDate: '2026-08-06', reason: 'Biên bản nhận sai, đảo trước khi sử dụng' },
    }));
    assert.equal(reversed.ok, true, reversed.message);
    assert.ok(reversed.receipt.reversal);
    assert.ok(reversed.receipt.reversal.inventoryMovementId);

    const transit = await listInventoryTransferInTransit(pool, { requestContext: context, limit: 100, offset: 0 });
    assert.equal(transit.ok, true);
    assert.equal(transit.inTransit.length, 1);
    assert.equal(transit.inTransit[0].sourceQuantity, '2.000000');

    const destinationBalance = await pool.query(
      `SELECT on_hand_quantity::text
         FROM inventory.inventory_balances
        WHERE installation_id = $1
          AND warehouse_id = $2
          AND location_id = $3
          AND base_variant_id = $4`,
      [config.installationId, master.destinationWarehouseId, master.destinationLocationId, master.baseVariantId],
    );
    assert.equal(destinationBalance.rows[0].on_hand_quantity, '0.000000000000');
  } finally {
    await closePool();
  }
});
