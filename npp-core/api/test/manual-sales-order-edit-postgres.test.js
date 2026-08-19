import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { getPool, closePool } from '../src/db/pool.js';
import {
  confirmSalesOrder,
  createSalesOrder,
  quickEditManualSalesOrder,
} from '../src/services/sales-order.js';

function testConfig() {
  return loadConfig({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3094',
    INSTALLATION_ID: `manual-edit-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:manual-edit-bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
  });
}

function requestContext(installationId, warehouseId, requestId) {
  return Object.freeze({
    installationId,
    actorId: 'test:manual-edit',
    employeeId: null,
    sourceApp: 'npp-core-api',
    requestId,
    receivedAt: '2026-08-19T02:00:00.000Z',
    roles: Object.freeze(['sales-operator']),
    permissions: Object.freeze([]),
    scopes: Object.freeze({
      branchIds: Object.freeze([]),
      warehouseIds: Object.freeze([warehouseId]),
      territoryIds: Object.freeze([]),
    }),
  });
}

async function seedFixture(pool, installationId) {
  const actor = 'test:manual-edit-fixture';
  const suffix = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const customerId = randomUUID();
  const addressId = randomUUID();
  const unitId = randomUUID();
  const channelId = randomUUID();
  const priceListId = randomUUID();
  const firstProductId = randomUUID();
  const secondProductId = randomUUID();
  const firstVariantId = randomUUID();
  const secondVariantId = randomUUID();

  await pool.query(
    `INSERT INTO shared.branches
      (id, installation_id, code, name, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,true,$5,$5)`,
    [branchId, installationId, `BR-${suffix}`, `Chi nhánh ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.warehouses
      (id, installation_id, branch_id, code, name, warehouse_type, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,'main',true,$6,$6)`,
    [warehouseId, installationId, branchId, `WH-${suffix}`, `Kho ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.customers
      (id, installation_id, code, name, payment_terms_days, credit_limit,
       is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,15,10000000,true,$5,$5)`,
    [customerId, installationId, `CUS-${suffix}`, `Khách ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.customer_addresses
      (id, installation_id, customer_id, label, recipient_name, address_line1,
       province, country_code, is_default, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,'Cửa hàng','Người nhận','123 Đường kiểm thử',
       'TP HCM','VN',true,true,$4,$4)`,
    [addressId, installationId, customerId, actor],
  );
  await pool.query(
    `INSERT INTO shared.units_of_measure
      (id, installation_id, code, name, unit_kind, allows_fractional, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,'COUNT',false,true,$5,$5)`,
    [unitId, installationId, `EA${suffix.slice(0, 4)}`, `Đơn vị ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.products
      (id, installation_id, code, name, is_orderable, is_active, created_by, updated_by)
     VALUES
      ($1,$3,$4,$5,true,true,$9,$9),
      ($2,$3,$6,$7,true,true,$9,$9)`,
    [
      firstProductId,
      secondProductId,
      installationId,
      `P1-${suffix}`,
      `Sản phẩm 1 ${suffix}`,
      `P2-${suffix}`,
      `Sản phẩm 2 ${suffix}`,
      null,
      actor,
    ],
  );
  await pool.query(
    `INSERT INTO shared.product_variants
      (id, installation_id, product_id, sku, name, variant_kind,
       is_inventory_base, is_sellable, is_catalog_visible, is_active,
       unit_id, conversion_to_base, is_purchasable, created_by, updated_by)
     VALUES
      ($1,$3,$4,$5,$6,'BASE',true,true,true,true,$10,1,true,$11,$11),
      ($2,$3,$7,$8,$9,'BASE',true,true,true,true,$10,1,true,$11,$11)`,
    [
      firstVariantId,
      secondVariantId,
      installationId,
      firstProductId,
      `SKU1-${suffix}`,
      `SKU 1 ${suffix}`,
      secondProductId,
      `SKU2-${suffix}`,
      `SKU 2 ${suffix}`,
      unitId,
      actor,
    ],
  );
  await pool.query(
    `INSERT INTO shared.sales_channels
      (id, installation_id, code, name, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,true,$5,$5)`,
    [channelId, installationId, `CH-${suffix}`, `Kênh ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.price_lists
      (id, installation_id, code, name, list_type, currency_code, priority,
       stacking_mode, stop_processing, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,'BASE','VND',100,'EXCLUSIVE',true,true,$5,$5)`,
    [priceListId, installationId, `BASE-${suffix}`, `Giá ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.price_list_items
      (id, installation_id, price_list_id, variant_id, adjustment_type,
       amount_minor, min_quantity, source_kind, is_active, created_by, updated_by)
     VALUES
      ($1,$3,$4,$5,'FIXED_PRICE',10000,0,'ADMIN',true,$7,$7),
      ($2,$3,$4,$6,'FIXED_PRICE',20000,0,'ADMIN',true,$7,$7)`,
    [randomUUID(), randomUUID(), installationId, priceListId, firstVariantId, secondVariantId, actor],
  );
  await pool.query(
    `INSERT INTO shared.sales_order_settings
      (installation_id, allow_backorder, created_by, updated_by)
     VALUES ($1,true,$2,$2)
     ON CONFLICT (installation_id) DO UPDATE
       SET allow_backorder=true, updated_at=now(), updated_by=EXCLUDED.updated_by`,
    [installationId, actor],
  );

  const balanceClient = await pool.connect();
  try {
    await balanceClient.query('BEGIN');
    await balanceClient.query(
      "SELECT set_config('npp.inventory_balance_write_context', 'rebuild', true)",
    );
    await balanceClient.query(
      `INSERT INTO inventory.inventory_balances (
         installation_id, warehouse_id, location_id, base_variant_id, lot_id,
         on_hand_quantity, reserved_quantity, updated_at
       ) VALUES
         ($1,$2,NULL,$3,NULL,20,0,now()),
         ($1,$2,NULL,$4,NULL,20,0,now())`,
      [installationId, warehouseId, firstVariantId, secondVariantId],
    );
    await balanceClient.query('COMMIT');
  } catch (error) {
    await balanceClient.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    balanceClient.release();
  }

  return {
    warehouseId,
    customerId,
    addressId,
    channelId,
    firstVariantId,
    secondVariantId,
  };
}

function payload(fixture, lines) {
  return {
    sourceType: 'MANUAL',
    customerId: fixture.customerId,
    customerAddressId: fixture.addressId,
    warehouseId: fixture.warehouseId,
    salesChannelId: fixture.channelId,
    deliveryMode: 'DELIVERY',
    deliveryExecutionMode: 'MANUAL',
    collectionPolicy: 'COLLECT_ON_DELIVERY',
    currency: 'VND',
    lines: lines.map(({ variantId, quantity }) => ({
      variantId,
      quantity,
      discountMode: 'TOTAL_AMOUNT',
      discountValue: '0',
      taxMode: 'EXCLUSIVE',
      taxRate: '0',
    })),
  };
}

async function demandRows(client, installationId, salesOrderId) {
  const result = await client.query(
    `SELECT base_variant_id,
            state,
            reserved_base_quantity::text,
            backordered_base_quantity::text
       FROM sales.sales_order_fulfillment_demands
      WHERE installation_id = $1
        AND sales_order_id = $2::uuid
      ORDER BY created_at, line_number`,
    [installationId, salesOrderId],
  );
  return result.rows;
}

test('Giao thủ công sửa thực tế được thêm/xóa SKU trước Xuất kho và giữ nguyên nguồn đơn', async () => {
  const config = testConfig();
  const pool = getPool(config);
  try {
    const fixture = await seedFixture(pool, config.installationId);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const context = requestContext(config.installationId, fixture.warehouseId, `req-${randomUUID()}`);
      const sourceId = `CUSTOMER-ORDER-${randomUUID()}`;
      const created = await createSalesOrder(client, {
        requestContext: context,
        payload: {
          ...payload(fixture, [{ variantId: fixture.firstVariantId, quantity: '2' }]),
          sourceType: 'API',
          sourceId,
        },
      });
      assert.equal(created.ok, true, JSON.stringify(created));

      const confirmed = await confirmSalesOrder(client, {
        requestContext: context,
        id: created.salesOrder.id,
        versionNumber: 1,
        idempotencyKey: `confirm.${randomUUID()}`,
      });
      assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
      assert.equal(confirmed.salesOrder.deliveryExecutionMode, 'MANUAL');

      const added = await quickEditManualSalesOrder(client, {
        requestContext: { ...context, requestId: `req-${randomUUID()}` },
        id: created.salesOrder.id,
        payload: payload(fixture, [
          { variantId: fixture.firstVariantId, quantity: '2' },
          { variantId: fixture.secondVariantId, quantity: '3' },
        ]),
        idempotencyKey: `manual-edit-add.${randomUUID()}`,
      });
      assert.equal(added.ok, true, JSON.stringify(added));
      const addedCurrent = added.salesOrder.versions.find(
        (version) => String(version.versionNumber) === String(added.salesOrder.currentVersionNumber),
      );
      assert.equal(addedCurrent.sourceType, 'API');
      assert.equal(addedCurrent.sourceId, sourceId);
      assert.deepEqual(
        addedCurrent.lines.map((line) => line.variantId).sort(),
        [fixture.firstVariantId, fixture.secondVariantId].sort(),
      );

      const afterAdd = await demandRows(client, config.installationId, created.salesOrder.id);
      const activeAfterAdd = afterAdd.filter((row) => row.state === 'ACTIVE');
      assert.equal(activeAfterAdd.length, 2);
      assert.equal(activeAfterAdd.every((row) => Number(row.reserved_base_quantity) > 0), true);

      const removed = await quickEditManualSalesOrder(client, {
        requestContext: { ...context, requestId: `req-${randomUUID()}` },
        id: created.salesOrder.id,
        payload: payload(fixture, [
          { variantId: fixture.secondVariantId, quantity: '3' },
        ]),
        idempotencyKey: `manual-edit-remove.${randomUUID()}`,
      });
      assert.equal(removed.ok, true, JSON.stringify(removed));
      const removedCurrent = removed.salesOrder.versions.find(
        (version) => String(version.versionNumber) === String(removed.salesOrder.currentVersionNumber),
      );
      assert.equal(removedCurrent.sourceType, 'API');
      assert.equal(removedCurrent.sourceId, sourceId);
      assert.deepEqual(removedCurrent.lines.map((line) => line.variantId), [fixture.secondVariantId]);

      const afterRemove = await demandRows(client, config.installationId, created.salesOrder.id);
      const activeAfterRemove = afterRemove.filter((row) => row.state === 'ACTIVE');
      assert.equal(activeAfterRemove.length, 1);
      assert.equal(activeAfterRemove[0].base_variant_id, fixture.secondVariantId);
      assert.equal(Number(activeAfterRemove[0].reserved_base_quantity), 3);
      assert.equal(
        afterRemove.some((row) => row.base_variant_id === fixture.firstVariantId && row.state === 'SUPERSEDED'),
        true,
      );

      const held = await client.query(
        `SELECT base_variant_id,
                COALESCE(sum(reserved_base_quantity), 0)::text AS held
           FROM sales.sales_order_fulfillment_demands
          WHERE installation_id = $1
            AND sales_order_id = $2::uuid
            AND state = 'ACTIVE'
          GROUP BY base_variant_id`,
        [config.installationId, created.salesOrder.id],
      );
      assert.deepEqual(held.rows, [{ base_variant_id: fixture.secondVariantId, held: '3.000000000000' }]);

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  } finally {
    await closePool();
  }
});
