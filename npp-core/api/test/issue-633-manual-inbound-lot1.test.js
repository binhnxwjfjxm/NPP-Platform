import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createIdempotencyKey } from '@npp/contracts';
import { loadConfig } from '../src/config.js';
import { closePool, getPool } from '../src/db/pool.js';
import { CORE_API_MIGRATIONS, runMigrations } from '../src/migrations/index.js';
import { PERMISSION_CATALOG, PERMISSIONS } from '../src/access/permissions.js';
import { getInventoryBalance } from '../src/services/inventory-balance.js';
import {
  manualInboundInternals,
  postManualInbound,
  reverseManualInbound,
} from '../src/services/manual-inbound.js';

function testEnv() {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3067',
    INSTALLATION_ID: `issue-633-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
  };
}

function requestContext(installationId, warehouseId, requestId) {
  return Object.freeze({
    installationId,
    actorId: 'test:manual-inbound-operator',
    employeeId: null,
    roles: Object.freeze(['bootstrap']),
    permissions: Object.freeze([
      PERMISSIONS.coreInventoryRead,
      PERMISSIONS.coreInventoryManualInboundRead,
      PERMISSIONS.coreInventoryManualInboundPrepare,
      PERMISSIONS.coreInventoryManualInboundPost,
      PERMISSIONS.coreInventoryManualInboundReverse,
    ]),
    scopes: Object.freeze({
      branchIds: Object.freeze([]),
      warehouseIds: Object.freeze([warehouseId]),
      territoryIds: Object.freeze([]),
    }),
    requestId,
    sourceApp: 'npp-core-api',
    receivedAt: '2026-08-18T06:45:00.000Z',
  });
}

async function seedInventoryMasterData(pool, installationId) {
  const actor = 'test:seed';
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const locationId = randomUUID();
  const baseUnitId = randomUUID();
  const cartonUnitId = randomUUID();
  const productId = randomUUID();
  const baseVariantId = randomUUID();
  const sourceVariantId = randomUUID();

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
       ($1,$3,$4,'Cái','COUNT',false,true,$6,$6),
       ($2,$3,$5,'Thùng','PACKAGE',false,true,$6,$6)`,
    [baseUnitId, cartonUnitId, installationId, `EA-${suffix}`, `CT-${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.products (
       id, installation_id, code, name, is_catalog_visible, is_orderable, is_active, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,true,true,true,$5,$5)`,
    [productId, installationId, `P-${suffix}`, `Sản phẩm ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.product_variants (
       id, installation_id, product_id, sku, name, variant_kind, is_inventory_base,
       is_sellable, is_catalog_visible, is_active, unit_id, conversion_to_base,
       is_purchasable, created_by, updated_by
     ) VALUES
       ($1,$3,$4,$5,'SKU cơ sở','BASE',true,true,true,true,$7,1,true,$9,$9),
       ($2,$3,$4,$6,'SKU thùng','CARTON',false,true,true,true,$8,12,true,$9,$9)`,
    [baseVariantId, sourceVariantId, installationId, productId, `BASE-${suffix}`, `CTN-${suffix}`, baseUnitId, cartonUnitId, actor],
  );
  await pool.query(
    `INSERT INTO inventory.product_tracking_policies (
       installation_id, base_variant_id, lot_tracking_mode, expiry_tracking_mode,
       location_required, version, created_at, created_by, updated_at, updated_by
     ) VALUES ($1,$2,'NONE','NONE',false,1,now(),$3,now(),$3)
     ON CONFLICT (installation_id, base_variant_id) DO UPDATE
     SET lot_tracking_mode = EXCLUDED.lot_tracking_mode,
         expiry_tracking_mode = EXCLUDED.expiry_tracking_mode,
         location_required = EXCLUDED.location_required,
         updated_at = EXCLUDED.updated_at,
         updated_by = EXCLUDED.updated_by`,
    [installationId, baseVariantId, actor],
  );

  return { warehouseId, locationId, baseVariantId, sourceVariantId };
}

function payload(master, overrides = {}) {
  return {
    warehouseId: master.warehouseId,
    inboundType: 'MANUAL_RECEIPT',
    documentDate: '2026-08-18',
    referenceNumber: 'HD-THU-CONG-001',
    note: 'Hàng thực tế có chứng từ giấy, chưa đi qua quy trình Mua hàng.',
    metadata: { source: 'issue-633-lot1-test' },
    rows: [{
      sourceVariantId: master.sourceVariantId,
      sourceQuantity: '2.000000',
      locationId: master.locationId,
      unitCost: '12500.000000000000',
      sourceLineReference: 'Dong-1',
      metadata: {},
    }],
    ...overrides,
  };
}

test('Issue #633 Lô 1 registers a separate manual-inbound contract and canonical permissions', () => {
  const migration = CORE_API_MIGRATIONS.find(({ id }) => id === '091_manual_inbound_foundation');
  assert.ok(migration);
  assert.match(migration.sql, /inventory\.manual_inbound_documents/);
  assert.match(migration.sql, /inventory\.manual_inbound_document_lines/);
  assert.doesNotMatch(migration.sql, /is_inventory_managed/);

  assert.equal(PERMISSIONS.coreInventoryManualInboundRead, 'core.inventory-manual-inbound.read');
  assert.equal(PERMISSIONS.coreInventoryManualInboundPrepare, 'core.inventory-manual-inbound.prepare');
  assert.equal(PERMISSIONS.coreInventoryManualInboundPost, 'core.inventory-manual-inbound.post');
  assert.equal(PERMISSIONS.coreInventoryManualInboundReverse, 'core.inventory-manual-inbound.reverse');
  for (const permissionKey of [
    PERMISSIONS.coreInventoryManualInboundRead,
    PERMISSIONS.coreInventoryManualInboundPrepare,
    PERMISSIONS.coreInventoryManualInboundPost,
    PERMISSIONS.coreInventoryManualInboundReverse,
  ]) {
    assert.ok(PERMISSION_CATALOG.some((entry) => entry.permissionKey === permissionKey));
  }

  const otherWithoutNote = manualInboundInternals.normalizeManualInboundPayload({
    warehouseId: randomUUID(),
    inboundType: 'OTHER',
    documentDate: '2026-08-18',
    rows: [{ sourceVariantId: randomUUID(), sourceQuantity: '1', unitCost: '1' }],
  });
  assert.equal(otherWithoutNote.ok, false);
  assert.equal(otherWithoutNote.code, 'MANUAL_INBOUND_NOTE_REQUIRED');
});

test('Issue #633 Lô 1 posts and reverses manual inbound atomically with idempotent audit/outbox lineage', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  try {
    await runMigrations(pool, CORE_API_MIGRATIONS);
    const rerun = await runMigrations(pool, CORE_API_MIGRATIONS);
    assert.deepEqual(rerun.applied, []);

    const master = await seedInventoryMasterData(pool, config.installationId);
    const context = requestContext(config.installationId, master.warehouseId, `req-${randomUUID()}`);
    const postKey = createIdempotencyKey('manual-inbound-post', randomUUID());
    const inboundPayload = payload(master);

    const invalidKey = await postManualInbound({
      adapter: pool,
      requestContext: context,
      idempotencyKey: `manual:inbound:${randomUUID()}`,
      payload: inboundPayload,
    });
    assert.equal(invalidKey.ok, false);
    assert.equal(invalidKey.code, 'INVALID_IDEMPOTENCY_KEY');

    const posted = await postManualInbound({
      adapter: pool,
      requestContext: context,
      idempotencyKey: postKey,
      payload: inboundPayload,
    });
    assert.equal(posted.ok, true, posted.message);
    assert.equal(posted.replayed, false);
    assert.equal(posted.document.status, 'POSTED');
    assert.equal(posted.document.inbound_type, 'MANUAL_RECEIPT');
    assert.equal(posted.document.lines.length, 1);
    assert.equal(posted.movement.movement_type, 'MANUAL_INBOUND');
    assert.equal(posted.movement.source_document_type, 'MANUAL_INBOUND');
    assert.equal(posted.movement.source_document_id, posted.document.id);
    assert.equal(String(posted.document.lines[0].base_quantity), '24.000000000000');
    assert.equal(String(posted.document.lines[0].entered_unit_cost), '12500.000000000000');

    const balanceAfterPost = await getInventoryBalance(pool, {
      requestContext: context,
      warehouseId: master.warehouseId,
      locationId: master.locationId,
      baseVariantId: master.baseVariantId,
      lotId: null,
    });
    assert.equal(balanceAfterPost.ok, true);
    assert.equal(String(balanceAfterPost.balance.on_hand_quantity), '24.000000000000');

    const replayed = await postManualInbound({
      adapter: pool,
      requestContext: { ...context, requestId: `req-replay-${randomUUID()}` },
      idempotencyKey: postKey,
      payload: inboundPayload,
    });
    assert.equal(replayed.ok, true);
    assert.equal(replayed.replayed, true);
    assert.equal(replayed.document.id, posted.document.id);
    assert.equal(replayed.movement.id, posted.movement.id);

    const mismatch = await postManualInbound({
      adapter: pool,
      requestContext: { ...context, requestId: `req-mismatch-${randomUUID()}` },
      idempotencyKey: postKey,
      payload: payload(master, {
        rows: [{ ...inboundPayload.rows[0], sourceQuantity: '3.000000' }],
      }),
    });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.code, 'IDEMPOTENCY_PAYLOAD_MISMATCH');

    const evidenceAfterReplay = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM inventory.manual_inbound_documents WHERE installation_id = $1) AS documents,
         (SELECT count(*)::int FROM inventory.inventory_movements WHERE installation_id = $1 AND movement_type = 'MANUAL_INBOUND') AS movements,
         (SELECT count(*)::int FROM shared.core_audit_records WHERE installation_id = $1 AND action = 'inventory.manual_inbound.post') AS audits,
         (SELECT count(*)::int FROM shared.core_outbox_events WHERE installation_id = $1 AND event_type = 'inventory.manual-inbound.posted') AS events`,
      [config.installationId],
    );
    assert.deepEqual(evidenceAfterReplay.rows[0], { documents: 1, movements: 1, audits: 1, events: 1 });

    await assert.rejects(
      pool.query(
        `UPDATE inventory.manual_inbound_documents SET note = 'không được sửa đè' WHERE installation_id = $1 AND id = $2`,
        [config.installationId, posted.document.id],
      ),
      /manual_inbound_documents_are_append_only/,
    );

    const reversePayload = {
      documentDate: '2026-08-18',
      reasonCode: 'NHAP_SAI',
      reasonNote: 'Đảo chứng từ nhập nhầm để giữ lịch sử sổ kho.',
    };
    const reverseKey = createIdempotencyKey('manual-inbound-reverse', randomUUID());
    const reversed = await reverseManualInbound({
      adapter: pool,
      requestContext: { ...context, requestId: `req-reverse-${randomUUID()}` },
      idempotencyKey: reverseKey,
      id: posted.document.id,
      payload: reversePayload,
    });
    assert.equal(reversed.ok, true, reversed.message);
    assert.equal(reversed.replayed, false);
    assert.equal(reversed.document.status, 'REVERSED');
    assert.equal(reversed.movement.reversal_of_movement_id, posted.movement.id);

    const reverseReplay = await reverseManualInbound({
      adapter: pool,
      requestContext: { ...context, requestId: `req-reverse-replay-${randomUUID()}` },
      idempotencyKey: reverseKey,
      id: posted.document.id,
      payload: reversePayload,
    });
    assert.equal(reverseReplay.ok, true);
    assert.equal(reverseReplay.replayed, true);
    assert.equal(reverseReplay.movement.id, reversed.movement.id);

    const secondReverse = await reverseManualInbound({
      adapter: pool,
      requestContext: { ...context, requestId: `req-reverse-second-${randomUUID()}` },
      idempotencyKey: createIdempotencyKey('manual-inbound-reverse', randomUUID()),
      id: posted.document.id,
      payload: reversePayload,
    });
    assert.equal(secondReverse.ok, false);
    assert.equal(secondReverse.code, 'MOVEMENT_ALREADY_REVERSED');

    const balanceAfterReverse = await getInventoryBalance(pool, {
      requestContext: context,
      warehouseId: master.warehouseId,
      locationId: master.locationId,
      baseVariantId: master.baseVariantId,
      lotId: null,
    });
    assert.equal(balanceAfterReverse.ok, true);
    assert.equal(String(balanceAfterReverse.balance.on_hand_quantity), '0.000000000000');

    const finalEvidence = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM shared.core_audit_records WHERE installation_id = $1 AND resource_type = 'manual_inbound_document') AS audits,
         (SELECT count(*)::int FROM shared.core_outbox_events WHERE installation_id = $1 AND aggregate_type = 'manual_inbound_document') AS events,
         (SELECT count(*)::int FROM inventory.inventory_movements WHERE installation_id = $1 AND reversal_of_movement_id = $2) AS reversals`,
      [config.installationId, posted.movement.id],
    );
    assert.deepEqual(finalEvidence.rows[0], { audits: 2, events: 2, reversals: 1 });
  } finally {
    await closePool();
  }
});
