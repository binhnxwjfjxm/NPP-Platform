import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { closePool, getPool } from '../src/db/pool.js';
import { startServer } from '../src/server.js';
import { CORE_API_MIGRATIONS, runMigrations } from '../src/migrations/index.js';
import { migrationVerifyWithAdapter } from '../src/migrations/cli.js';
import { PERMISSIONS } from '../src/request-context.js';
import {
  getInventoryTrackingPolicy,
  listInventoryLots,
  resolveOrCreateInventoryLot,
  upsertInventoryTrackingPolicy,
} from '../src/services/inventory-lots.js';
import {
  getOpeningBalanceImport,
  postOpeningBalanceImport,
  validateOpeningBalanceImport,
} from '../src/services/opening-balance.js';
import { executeInventoryPost } from '../src/services/inventory-ledger.js';
import { getInventoryBalance, listInventoryMovementDrillDown, reconcileInventoryBalances } from '../src/services/inventory-balance.js';

function testEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3051',
    INSTALLATION_ID: `p44-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
    ...overrides,
  };
}

function requestContext(installationId, warehouseIds, requestId, permissions = [
  PERMISSIONS.coreInventoryRead,
  PERMISSIONS.coreInventoryPost,
  PERMISSIONS.coreInventoryReverse,
  PERMISSIONS.coreInventoryTrackingPolicyRead,
  PERMISSIONS.coreInventoryTrackingPolicyManage,
  PERMISSIONS.coreInventoryLotRead,
  PERMISSIONS.coreInventoryLotManage,
  PERMISSIONS.coreInventoryOpeningBalanceImport,
]) {
  return Object.freeze({
    installationId,
    actorId: 'test:inventory-operator',
    employeeId: null,
    sourceApp: 'npp-core-api',
    requestId,
    receivedAt: '2026-07-28T00:00:00.000Z',
    permissions: Object.freeze([...permissions]),
    scopes: Object.freeze({
      branchIds: Object.freeze([]),
      warehouseIds: Object.freeze([...warehouseIds]),
      territoryIds: Object.freeze([]),
    }),
  });
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function sha256Hex(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

async function seedInventoryMasterData(pool, installationId) {
  const actor = 'test:seed';
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const locationId = randomUUID();
  const unitId = randomUUID();
  const cartonUnitId = randomUUID();
  const productId = randomUUID();
  const product2Id = randomUUID();
  const baseVariantId = randomUUID();
  const sourceVariantId = randomUUID();
  const baseVariant2Id = randomUUID();
  const sourceVariant2Id = randomUUID();

  await pool.query(
    `INSERT INTO shared.branches (
       id, installation_id, code, name, is_active, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,true,$5,$5)`,
    [branchId, installationId, `BR-${suffix}`, `Chi nhánh ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.warehouses (
       id, installation_id, branch_id, code, name, warehouse_type, is_active, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,'main',true,$6,$6)`,
    [warehouseId, installationId, branchId, `WH-${suffix}`, `Kho ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.warehouse_locations (
       id, installation_id, warehouse_id, code, name, location_type, is_active, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,'storage',true,$6,$6)`,
    [locationId, installationId, warehouseId, `LOC-${suffix}`, `Vị trí ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.units_of_measure (
       id, installation_id, code, name, unit_kind, allows_fractional, is_active, created_by, updated_by
     ) VALUES
       ($1,$3,$4,'Đơn vị', 'COUNT', false, true, $6, $6),
       ($2,$3,$5,'Thùng', 'PACKAGE', false, true, $6, $6)`,
    [unitId, cartonUnitId, installationId, `EA-${suffix}`, `CT-${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.products (
       id, installation_id, code, name, is_catalog_visible, is_orderable, is_active, created_by, updated_by
     ) VALUES
       ($1,$2,$3,$4,true,true,true,$5,$5),
       ($6,$2,$7,$8,true,true,true,$5,$5)`,
    [productId, installationId, `P-${suffix}`, `Sản phẩm ${suffix}`, actor, product2Id, `P2-${suffix}`, `Sản phẩm ${suffix} B`],
  );
  await pool.query(
    `INSERT INTO shared.product_variants (
       id, installation_id, product_id, sku, name, variant_kind, is_inventory_base, is_sellable,
       is_catalog_visible, is_active, unit_id, conversion_to_base, is_purchasable, created_by, updated_by
     ) VALUES
       ($1,$2,$3,$4,'Base SKU', 'BASE', true, true, true, true, $5, 1, true, $6, $6),
       ($7,$2,$3,$8,'Source SKU', 'CARTON', false, true, true, true, $9, 12, true, $6, $6),
       ($10,$2,$11,$12,'Base SKU 2', 'BASE', true, true, true, true, $5, 1, true, $6, $6),
       ($13,$2,$11,$14,'Source SKU 2', 'CARTON', false, true, true, true, $9, 12, true, $6, $6)`,
    [baseVariantId, installationId, productId, `BASE-${suffix}`, unitId, actor, sourceVariantId, `SRC-${suffix}`, cartonUnitId, baseVariant2Id, product2Id, `BASE2-${suffix}`, sourceVariant2Id, `SRC2-${suffix}`],
  );

  return {
    branchId,
    warehouseId,
    locationId,
    unitId,
    cartonUnitId,
    productId,
    product2Id,
    baseVariantId,
    sourceVariantId,
    baseVariant2Id,
    sourceVariant2Id,
  };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test('Migration 020 registers lot, opening balance and inventory policy tables idempotently', async () => {
  const migration = CORE_API_MIGRATIONS.find(({ id }) => id === '020_inventory_lots_opening_balance');
  assert.ok(migration);
  assert.match(migration.sql, /CREATE TABLE IF NOT EXISTS inventory\.product_tracking_policies/);
  assert.match(migration.sql, /CREATE TABLE IF NOT EXISTS inventory\.inventory_lots/);
  assert.match(migration.sql, /CREATE TABLE IF NOT EXISTS inventory\.opening_balance_imports/);
  assert.match(migration.sql, /CREATE TABLE IF NOT EXISTS inventory\.opening_balance_import_rows/);
  assert.match(migration.sql, /lot_id uuid null/);
  assert.match(migration.sql, /lot_code text null/);
  assert.match(migration.sql, /expiry_date date null/);

  const config = loadConfig(testEnv({ INSTALLATION_ID: `migration-${randomUUID()}` }));
  const pool = getPool(config);
  try {
    await runMigrations(pool, CORE_API_MIGRATIONS);
    const rerun = await runMigrations(pool, CORE_API_MIGRATIONS);
    const verify = await migrationVerifyWithAdapter(pool);
    assert.deepEqual(rerun.applied, []);
    assert.equal(verify.verified, true, verify.issues.join(', '));

    const permissions = await pool.query(
      `SELECT permission_key
         FROM shared.permission_catalog
        WHERE permission_key IN (
          'core.inventory.tracking-policy.read',
          'core.inventory.tracking-policy.manage',
          'core.inventory.lot.read',
          'core.inventory.lot.manage',
          'core.inventory.opening-balance.import'
        )
        ORDER BY permission_key ASC`,
    );
    assert.deepEqual(permissions.rows.map((row) => row.permission_key), [
      'core.inventory.lot.manage',
      'core.inventory.lot.read',
      'core.inventory.opening-balance.import',
      'core.inventory.tracking-policy.manage',
      'core.inventory.tracking-policy.read',
    ]);
  } finally {
    await closePool();
  }
});

test('Tracking policy, lot and opening balance services obey the Phase 4.4 matrix', async () => {
  const config = loadConfig(testEnv({ INSTALLATION_ID: `services-${randomUUID()}` }));
  const pool = getPool(config);
  try {
    const master = await seedInventoryMasterData(pool, config.installationId);
    const context = requestContext(config.installationId, [master.warehouseId], `req-${randomUUID()}`);

    const invalidPolicy = await upsertInventoryTrackingPolicy(pool, {
      requestContext: context,
      payload: {
        baseVariantId: master.baseVariantId,
        lotTrackingMode: 'NONE',
        expiryTrackingMode: 'OPTIONAL',
        locationRequired: false,
      },
    });
    assert.equal(invalidPolicy.ok, false);
    assert.equal(invalidPolicy.code, 'TRACKING_POLICY_CONFLICT');

    const createdPolicy = await upsertInventoryTrackingPolicy(pool, {
      requestContext: context,
      payload: {
        baseVariantId: master.baseVariantId,
        lotTrackingMode: 'REQUIRED',
        expiryTrackingMode: 'OPTIONAL',
        locationRequired: true,
      },
    });
    assert.equal(createdPolicy.ok, true, createdPolicy.message);
    assert.equal(createdPolicy.replayed, false);

    const staleUpdate = await upsertInventoryTrackingPolicy(pool, {
      requestContext: context,
      payload: {
        baseVariantId: master.baseVariantId,
        lotTrackingMode: 'REQUIRED',
        expiryTrackingMode: 'OPTIONAL',
        locationRequired: true,
        expectedVersion: 999,
      },
    });
    assert.equal(staleUpdate.ok, false);
    assert.equal(staleUpdate.code, 'TRACKING_POLICY_CONFLICT');

    const readPolicy = await getInventoryTrackingPolicy(pool, {
      requestContext: context,
      baseVariantId: master.baseVariantId,
    });
    assert.equal(readPolicy.ok, true);
    assert.equal(readPolicy.policy.lot_tracking_mode, 'REQUIRED');

    const createdLot = await resolveOrCreateInventoryLot(pool, {
      requestContext: context,
      baseVariantId: master.baseVariantId,
      lotCode: 'LOT-001',
      expiryDate: '2027-01-01',
      manufacturedDate: '2026-01-01',
      supplierLotReference: 'SUP-001',
      metadata: { source: 'test' },
    });
    assert.equal(createdLot.ok, true);
    assert.equal(createdLot.replayed, false);

    const replayedLot = await resolveOrCreateInventoryLot(pool, {
      requestContext: context,
      baseVariantId: master.baseVariantId,
      lotCode: 'lot-001',
      expiryDate: '2027-01-01',
    });
    assert.equal(replayedLot.ok, true);
    assert.equal(replayedLot.replayed, true);
    assert.equal(replayedLot.lot.id, createdLot.lot.id);

    const expiryConflict = await resolveOrCreateInventoryLot(pool, {
      requestContext: context,
      baseVariantId: master.baseVariantId,
      lotCode: 'LOT-001',
      expiryDate: '2027-02-01',
    });
    assert.equal(expiryConflict.ok, false);
    assert.equal(expiryConflict.code, 'LOT_EXPIRY_MISMATCH');

    const otherLot = await resolveOrCreateInventoryLot(pool, {
      requestContext: context,
      baseVariantId: master.baseVariant2Id,
      lotCode: 'LOT-001',
      expiryDate: '2027-01-01',
    });
    assert.equal(otherLot.ok, false);
    assert.equal(otherLot.code, 'TRACKING_POLICY_NOT_FOUND');

    await upsertInventoryTrackingPolicy(pool, {
      requestContext: context,
      payload: {
        baseVariantId: master.baseVariant2Id,
        lotTrackingMode: 'REQUIRED',
        expiryTrackingMode: 'OPTIONAL',
        locationRequired: false,
      },
    });

    const otherLotWithPolicy = await resolveOrCreateInventoryLot(pool, {
      requestContext: context,
      baseVariantId: master.baseVariant2Id,
      lotCode: 'LOT-001',
      expiryDate: '2027-01-01',
    });
    assert.equal(otherLotWithPolicy.ok, true);
    assert.notEqual(otherLotWithPolicy.lot.id, createdLot.lot.id);

    const lotList = await listInventoryLots(pool, {
      requestContext: context,
      search: 'LOT-001',
      limit: 50,
      offset: 0,
    });
    assert.equal(lotList.ok, true);
    assert.ok(lotList.lots.length >= 2);

    const openingPayload = {
      sourceKey: 'opening-2026-test',
      sourceFilename: 'opening-balance.xlsx',
      contentChecksum: sha256Hex({
        sourceKey: 'opening-2026-test',
        sourceFilename: 'opening-balance.xlsx',
        documentDate: '2026-07-28',
        metadata: { source: 'test' },
        rows: [{
          warehouseId: master.warehouseId,
          locationId: master.locationId,
          sourceVariantId: master.sourceVariantId,
          sourceQuantity: '12.000000',
          lotCode: 'LOT-001',
          manufacturedDate: '2026-01-01',
          expiryDate: '2027-01-01',
          supplierLotReference: 'SUP-001',
          sourceLineReference: 'Sheet1!2',
          metadata: { row: 1 },
        }],
      }),
      documentDate: '2026-07-28',
      metadata: { source: 'test' },
      rows: [{
        warehouseId: master.warehouseId,
        locationId: master.locationId,
        sourceVariantId: master.sourceVariantId,
        sourceQuantity: '12.000000',
        lotCode: 'LOT-001',
        manufacturedDate: '2026-01-01',
        expiryDate: '2027-01-01',
        supplierLotReference: 'SUP-001',
        sourceLineReference: 'Sheet1!2',
        metadata: { row: 1 },
      }],
    };

    const validation = await validateOpeningBalanceImport(pool, {
      requestContext: context,
      payload: openingPayload,
    });
    assert.equal(validation.ok, true);
    assert.equal(validation.rowErrors.length, 0);
    assert.equal(validation.totals.rowCount, 1);

    const posted = await postOpeningBalanceImport({
      adapter: pool,
      requestContext: context,
      idempotencyKey: `opening-${randomUUID()}`,
      payload: openingPayload,
    });
    assert.equal(posted.ok, true, posted.message);
    assert.equal(posted.replayed, false);
    assert.equal(posted.import.status, 'POSTED');
    assert.equal(posted.rows.length, 1);
    assert.ok(posted.movement.id);

    const replayed = await postOpeningBalanceImport({
      adapter: pool,
      requestContext: context,
      idempotencyKey: `opening-${randomUUID()}`,
      payload: openingPayload,
    });
    assert.equal(replayed.ok, true);
    assert.equal(replayed.replayed, true);

    const conflict = await postOpeningBalanceImport({
      adapter: pool,
      requestContext: context,
      idempotencyKey: `opening-${randomUUID()}`,
      payload: { ...openingPayload, rows: [{ ...openingPayload.rows[0], sourceQuantity: '13.000000' }] },
    });
    assert.equal(conflict.ok, false);
    assert.equal(conflict.code, 'OPENING_BALANCE_SOURCE_KEY_CONFLICT');

    const balance = await getInventoryBalance(pool, {
      requestContext: context,
      warehouseId: master.warehouseId,
      locationId: master.locationId,
      baseVariantId: master.baseVariantId,
      lotId: posted.rows[0].lot_id,
    });
    assert.equal(balance.ok, true);
    assert.equal(String(balance.balance.on_hand_quantity), '144.000000000000');
    assert.equal(balance.balance.lot_id, posted.rows[0].lot_id);
    assert.equal(balance.balance.lot_code, 'LOT-001');
    assert.equal(balance.balance.expiry_date, '2027-01-01');

    const drill = await listInventoryMovementDrillDown(pool, {
      requestContext: context,
      warehouseId: master.warehouseId,
      locationId: master.locationId,
      baseVariantId: master.baseVariantId,
      lotId: posted.rows[0].lot_id,
    });
    assert.equal(drill.ok, true);
    assert.equal(drill.lines.length, 1);
    assert.equal(drill.lines[0].lot_code, 'LOT-001');

    const reconcile = await reconcileInventoryBalances(pool, { requestContext: context });
    assert.equal(reconcile.ok, true);
    assert.equal(reconcile.differences.length, 0);
  } finally {
    await closePool();
  }
});

test('Inventory access API enforces auth and returns sanitized errors', async () => {
  const config = loadConfig(testEnv({ INSTALLATION_ID: `api-${randomUUID()}`, PORT: '3052' }));
  const pool = getPool(config);
  const master = await seedInventoryMasterData(pool, config.installationId);
  const context = requestContext(config.installationId, [master.warehouseId], `req-${randomUUID()}`);
  await upsertInventoryTrackingPolicy(pool, {
    requestContext: context,
    payload: {
      baseVariantId: master.baseVariantId,
      lotTrackingMode: 'REQUIRED',
      expiryTrackingMode: 'OPTIONAL',
      locationRequired: true,
    },
  });

  const server = await startServer({
    config,
    authenticateRequest: () => ({
      ok: true,
      principal: {
        actorId: 'test:limited',
        roles: ['bootstrap'],
        permissions: [PERMISSIONS.coreInventoryTrackingPolicyRead],
        sourceApp: 'test-suite',
      },
    }),
  });

  try {
    const unauthorized = await fetch('http://127.0.0.1:3052/api/inventory/tracking-policies');
    const unauthorizedBody = await unauthorized.json();
    assert.equal(unauthorized.status, 200);
    assert.ok(Array.isArray(unauthorizedBody.data));

    const denied = await fetch('http://127.0.0.1:3052/api/inventory/opening-balances/post', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer anything',
        'Content-Type': 'application/json',
        'Idempotency-Key': `inventory-api-${randomUUID()}`,
      },
      body: JSON.stringify({
        sourceKey: 'inventory-api',
        contentChecksum: '0'.repeat(64),
        documentDate: '2026-07-28',
        rows: [],
      }),
    });
    const deniedBody = await denied.json();
    assert.equal(denied.status, 403);
    assert.equal(deniedBody.error.code, 'FORBIDDEN');
  } finally {
    await closeServer(server);
    await closePool();
  }
});
