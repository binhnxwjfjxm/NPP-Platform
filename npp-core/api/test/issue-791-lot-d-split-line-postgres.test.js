import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { getPool, closePool } from '../src/db/pool.js';
import { CORE_API_MIGRATIONS, runMigrations } from '../src/migrations/index.js';
import { migrationVerifyWithAdapter } from '../src/migrations/cli.js';
import * as service from '../src/services/sales-order.js';

function env() {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3050',
    INSTALLATION_ID: `sales-split-line-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
  };
}

async function fixtures(pool, installationId) {
  const actor = 'test:fixture';
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const customerId = randomUUID();
  const addressId = randomUUID();
  const unitId = randomUUID();
  const productId = randomUUID();
  const variantId = randomUUID();
  const channelId = randomUUID();
  const priceListId = randomUUID();

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
       ward, province, country_code, is_default, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,'Cửa hàng','Người nhận','123 Đường thử nghiệm',
       'Phường thử nghiệm','TP HCM','VN',true,true,$4,$4)`,
    [addressId, installationId, customerId, actor],
  );
  await pool.query(
    `INSERT INTO shared.units_of_measure
      (id, installation_id, code, name, unit_kind, allows_fractional, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,'COUNT',true,true,$5,$5)`,
    [unitId, installationId, `EA${suffix.slice(0, 4)}`, `Đơn vị ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.products
      (id, installation_id, code, name, is_orderable, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,true,true,$5,$5)`,
    [productId, installationId, `PR-${suffix}`, `Sản phẩm ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.product_variants
      (id, installation_id, product_id, sku, name, variant_kind,
       is_inventory_base, is_sellable, is_catalog_visible, is_active,
       unit_id, conversion_to_base, is_purchasable, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,'BASE',true,true,true,true,$6,1,true,$7,$7)`,
    [variantId, installationId, productId, `SKU-${suffix}`, `SKU ${suffix}`, unitId, actor],
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
     VALUES ($1,$2,$3,$4,'FIXED_PRICE',10000,0,'ADMIN',true,$5,$5)`,
    [randomUUID(), installationId, priceListId, variantId, actor],
  );

  return { warehouseId, customerId, addressId, variantId, channelId };
}

test('Issue #791 Lô D stores duplicate SKU as distinct Sales Order lines after migration 115', async () => {
  const config = loadConfig(env());
  const pool = getPool(config);
  try {
    await runMigrations(pool, CORE_API_MIGRATIONS);
    const verify = await migrationVerifyWithAdapter(pool);
    assert.equal(verify.verified, true, verify.issues.join(', '));

    const constraint = await pool.query(
      `SELECT 1
         FROM pg_constraint
        WHERE conname = 'sales_order_version_lines_variant_unique'`,
    );
    assert.equal(constraint.rowCount, 0);

    const lookupIndex = await pool.query(
      `SELECT indexdef
         FROM pg_indexes
        WHERE schemaname = 'sales'
          AND tablename = 'sales_order_version_lines'
          AND indexname = 'sales_order_version_lines_version_variant_line_idx'`,
    );
    assert.equal(lookupIndex.rowCount, 1);
    assert.match(lookupIndex.rows[0].indexdef, /installation_id, sales_order_version_id, variant_id, line_number/);

    const fixture = await fixtures(pool, config.installationId);
    const requestContext = Object.freeze({
      installationId: config.installationId,
      actorId: 'test:sales-split-line',
      employeeId: null,
      roles: Object.freeze(['test']),
      permissions: Object.freeze(['core.sales-order.price.override']),
      scopes: Object.freeze({
        branchIds: Object.freeze([]),
        warehouseIds: Object.freeze([fixture.warehouseId]),
        territoryIds: Object.freeze([]),
      }),
      requestId: `req_${randomUUID()}`,
      sourceApp: 'test',
      receivedAt: new Date().toISOString(),
    });

    const result = await service.createSalesOrder(pool, {
      requestContext,
      payload: {
        sourceType: 'MANUAL',
        customerId: fixture.customerId,
        customerAddressId: fixture.addressId,
        warehouseId: fixture.warehouseId,
        salesChannelId: fixture.channelId,
        deliveryMode: 'DELIVERY',
        collectionPolicy: 'COLLECT_ON_DELIVERY',
        currency: 'VND',
        lines: [
          {
            variantId: fixture.variantId,
            quantity: '1',
            discountMode: 'PERCENT',
            discountValue: '0',
            taxMode: 'EXCLUSIVE',
            taxRate: '0',
          },
          {
            variantId: fixture.variantId,
            quantity: '1',
            manualUnitPriceMinor: '0',
            discountMode: 'PERCENT',
            discountValue: '0',
            taxMode: 'EXCLUSIVE',
            taxRate: '0',
          },
        ],
      },
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const rows = await pool.query(
      `SELECT id, variant_id, line_number, unit_price
         FROM sales.sales_order_version_lines
        WHERE installation_id = $1
        ORDER BY line_number ASC`,
      [config.installationId],
    );
    assert.equal(rows.rowCount, 2);
    assert.equal(rows.rows[0].variant_id, fixture.variantId);
    assert.equal(rows.rows[1].variant_id, fixture.variantId);
    assert.notEqual(rows.rows[0].id, rows.rows[1].id);
    assert.deepEqual(rows.rows.map((row) => Number(row.unit_price)), [10000, 0]);
  } finally {
    await closePool();
  }
});
