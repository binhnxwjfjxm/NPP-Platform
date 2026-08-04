import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { closePool, getPool } from '../src/db/pool.js';
import { startServer } from '../src/server.js';
import { PERMISSIONS } from '../src/request-context.js';
import { upsertInventoryTrackingPolicy } from '../src/services/inventory-lots.js';
import { postOpeningBalanceImport } from '../src/services/opening-balance.js';

function testEnv() {
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3065',
    INSTALLATION_ID: `delivery-inventory-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3005',
  };
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

function inventoryContext(installationId, warehouseId) {
  return Object.freeze({
    installationId,
    actorId: 'test:inventory-seed',
    employeeId: null,
    sourceApp: 'npp-core-api',
    requestId: `seed-${randomUUID()}`,
    receivedAt: '2026-08-04T07:00:00.000Z',
    roles: Object.freeze(['warehouse-operator']),
    permissions: Object.freeze([
      PERMISSIONS.coreInventoryRead,
      PERMISSIONS.coreInventoryPost,
      PERMISSIONS.coreInventoryTrackingPolicyRead,
      PERMISSIONS.coreInventoryTrackingPolicyManage,
      PERMISSIONS.coreInventoryLotRead,
      PERMISSIONS.coreInventoryLotManage,
      PERMISSIONS.coreInventoryOpeningBalanceImport,
    ]),
    scopes: Object.freeze({
      branchIds: Object.freeze([]),
      warehouseIds: Object.freeze([warehouseId]),
      territoryIds: Object.freeze([]),
    }),
  });
}

function authHeaders(config, key = null, withJson = true) {
  return {
    Authorization: `Bearer ${config.backendApiToken}`,
    ...(withJson ? { 'Content-Type': 'application/json' } : {}),
    ...(key ? { 'Idempotency-Key': key } : {}),
  };
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function fetchJson(response) {
  const body = await response.json();
  return { response, body };
}

async function seedMasterData(pool, installationId) {
  const actor = 'test:fixture';
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const locationId = randomUUID();
  const customerId = randomUUID();
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
    `INSERT INTO shared.warehouse_locations
      (id, installation_id, warehouse_id, code, name, location_type, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,'storage',true,$6,$6)`,
    [locationId, installationId, warehouseId, `A01-${suffix}`, `Kệ ${suffix}`, actor],
  );
  await pool.query(
    `INSERT INTO shared.customers
      (id, installation_id, code, name, payment_terms_days, credit_limit,
       is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,15,10000000,true,$5,$5)`,
    [customerId, installationId, `CUS-${suffix}`, `Khách ${suffix}`, actor],
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
  return { warehouseId, locationId, customerId, unitId, variantId, channelId };
}

async function seedInventory(pool, config, master) {
  const context = inventoryContext(config.installationId, master.warehouseId);
  const policy = await upsertInventoryTrackingPolicy(pool, {
    requestContext: context,
    payload: {
      baseVariantId: master.variantId,
      lotTrackingMode: 'REQUIRED',
      expiryTrackingMode: 'REQUIRED',
      locationRequired: true,
    },
  });
  assert.equal(policy.ok, true, JSON.stringify(policy));
  const sourceKey = `pickup-${randomUUID()}`;
  const unsignedPayload = {
    sourceKey,
    sourceFilename: `${sourceKey}.xlsx`,
    documentDate: '2026-08-04',
    metadata: { source: 'phase-6d4-integration' },
    rows: [{
      warehouseId: master.warehouseId,
      locationId: master.locationId,
      sourceVariantId: master.variantId,
      sourceQuantity: '5',
      lotCode: `LOT-${randomUUID().slice(0, 8)}`,
      manufacturedDate: '2026-01-01',
      expiryDate: '2026-12-01',
      sourceLineReference: `${sourceKey}!2`,
      metadata: { sourceKey },
    }],
  };
  const posted = await postOpeningBalanceImport({
    adapter: pool,
    requestContext: context,
    idempotencyKey: `opening-${randomUUID()}`,
    payload: { ...unsignedPayload, contentChecksum: sha256Hex(unsignedPayload) },
  });
  assert.equal(posted.ok, true, JSON.stringify(posted));
  return posted.rows[0];
}

function pickupOrderPayload(master) {
  return {
    sourceType: 'MANUAL',
    customerId: master.customerId,
    customerAddressId: null,
    warehouseId: master.warehouseId,
    salesChannelId: master.channelId,
    deliveryMode: 'PICKUP',
    collectionPolicy: 'PREPAID',
    currency: 'VND',
    requestedDeliveryDate: '2026-08-05',
    note: 'Đơn nhận tại quầy kiểm thử 6D.4',
    lines: [{
      variantId: master.variantId,
      quantity: '3',
      discountMode: 'TOTAL_AMOUNT',
      discountValue: '0',
      taxMode: 'EXCLUSIVE',
      taxRate: '0',
    }],
  };
}

async function createPackedPickupOrder(baseUrl, config, master) {
  const created = await fetchJson(await fetch(`${baseUrl}/api/sales-orders`, {
    method: 'POST',
    headers: authHeaders(config, `sales-create-${randomUUID()}`),
    body: JSON.stringify(pickupOrderPayload(master)),
  }));
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const confirmed = await fetchJson(await fetch(`${baseUrl}/api/sales-orders/${created.body.data.id}/confirm`, {
    method: 'POST',
    headers: authHeaders(config, `sales-confirm-${randomUUID()}`),
    body: JSON.stringify({}),
  }));
  assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.body));

  const work = await fetchJson(await fetch(`${baseUrl}/api/inventory/fulfillment-work`, {
    headers: authHeaders(config, null, false),
  }));
  const demand = work.body.data.find((item) => item.salesOrderId === created.body.data.id);
  assert.ok(demand, JSON.stringify(work.body));

  const allocated = await fetchJson(await fetch(
    `${baseUrl}/api/inventory/fulfillment-demands/${demand.fulfillmentDemandId}/allocate`,
    {
      method: 'POST',
      headers: authHeaders(config, `allocate-${randomUUID()}`),
      body: JSON.stringify({ mode: 'AUTO' }),
    },
  ));
  assert.equal(allocated.response.status, 201, JSON.stringify(allocated.body));
  const allocation = allocated.body.data.allocation.allocations[0];
  assert.equal(allocation.allocatedBaseQuantity, '3.000000000000');

  const picked = await fetchJson(await fetch(
    `${baseUrl}/api/inventory/fulfillment-allocations/${allocation.id}/pick`,
    {
      method: 'POST',
      headers: authHeaders(config, `pick-${randomUUID()}`),
      body: JSON.stringify({ quantity: '3' }),
    },
  ));
  assert.equal(picked.response.status, 201, JSON.stringify(picked.body));
  const packed = await fetchJson(await fetch(
    `${baseUrl}/api/inventory/fulfillment-allocations/${allocation.id}/pack`,
    {
      method: 'POST',
      headers: authHeaders(config, `pack-${randomUUID()}`),
      body: JSON.stringify({ quantity: '3' }),
    },
  ));
  assert.equal(packed.response.status, 201, JSON.stringify(packed.body));
  return { salesOrderId: created.body.data.id, allocationId: allocation.id };
}

async function createConfirmedDeliveryOrder(baseUrl, config, salesOrderId) {
  const eligibility = await fetchJson(await fetch(
    `${baseUrl}/api/delivery-orders/eligibility?salesOrderId=${salesOrderId}`,
    { headers: authHeaders(config, null, false) },
  ));
  assert.equal(eligibility.response.status, 200, JSON.stringify(eligibility.body));
  assert.equal(eligibility.body.data.length, 1);
  assert.equal(eligibility.body.data[0].handoverMode, 'PICKUP');

  const created = await fetchJson(await fetch(`${baseUrl}/api/delivery-orders`, {
    method: 'POST',
    headers: authHeaders(config, `delivery-create-${randomUUID()}`),
    body: JSON.stringify({
      lines: [{
        fulfillmentAllocationId: eligibility.body.data[0].fulfillmentAllocationId,
        quantity: '3.000000000000',
      }],
    }),
  }));
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const deliveryOrderId = created.body.data.deliveryOrder.id;
  const confirmed = await fetchJson(await fetch(`${baseUrl}/api/delivery-orders/${deliveryOrderId}/confirm`, {
    method: 'POST',
    headers: authHeaders(config, `delivery-confirm-${randomUUID()}`),
    body: JSON.stringify({}),
  }));
  assert.equal(confirmed.response.status, 201, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.data.deliveryOrder.status, 'ready_to_dispatch');
  return deliveryOrderId;
}

async function inventoryEvidence(pool, installationId, warehouseId, locationId, variantId, lotId) {
  const result = await pool.query(
    `SELECT balance.on_hand_quantity::text,
            balance.reserved_quantity::text,
            reservation.state AS reservation_state,
            reservation.consumed_quantity::text,
            demand.issued_base_quantity::text,
            orders.fulfillment_status,
            delivery_order.status AS delivery_order_status
       FROM inventory.inventory_balances balance
       JOIN inventory.inventory_reservations reservation
         ON reservation.installation_id = balance.installation_id
        AND reservation.warehouse_id = balance.warehouse_id
        AND reservation.location_id IS NOT DISTINCT FROM balance.location_id
        AND reservation.base_variant_id = balance.base_variant_id
        AND reservation.lot_id IS NOT DISTINCT FROM balance.lot_id
        AND reservation.source_document_type = 'SALES_FULFILLMENT_ALLOCATION'
       JOIN sales.sales_order_fulfillment_allocations allocation
         ON allocation.installation_id = reservation.installation_id
        AND allocation.inventory_reservation_id = reservation.id
       JOIN sales.sales_order_fulfillment_demands demand
         ON demand.installation_id = allocation.installation_id
        AND demand.id = allocation.fulfillment_demand_id
       JOIN sales.sales_orders orders
         ON orders.installation_id = demand.installation_id
        AND orders.id = demand.sales_order_id
       JOIN sales.delivery_order_lines delivery_line
         ON delivery_line.installation_id = allocation.installation_id
        AND delivery_line.fulfillment_allocation_id = allocation.id
       JOIN sales.delivery_orders delivery_order
         ON delivery_order.installation_id = delivery_line.installation_id
        AND delivery_order.id = delivery_line.delivery_order_id
      WHERE balance.installation_id = $1
        AND balance.warehouse_id = $2
        AND balance.location_id = $3
        AND balance.base_variant_id = $4
        AND balance.lot_id = $5`,
    [installationId, warehouseId, locationId, variantId, lotId],
  );
  assert.equal(result.rows.length, 1);
  return result.rows[0];
}

test('Phase 6D.4 pickup issue, reversal and customer return preserve exact ledger lineage', async () => {
  const config = loadConfig(testEnv());
  const pool = getPool(config);
  let server;
  try {
    const master = await seedMasterData(pool, config.installationId);
    const opening = await seedInventory(pool, config, master);
    server = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;
    const packed = await createPackedPickupOrder(baseUrl, config, master);
    const deliveryOrderId = await createConfirmedDeliveryOrder(baseUrl, config, packed.salesOrderId);

    const concurrentIssue = await Promise.all([
      fetchJson(await fetch(`${baseUrl}/api/delivery-orders/${deliveryOrderId}/pickup-handover`, {
        method: 'POST',
        headers: authHeaders(config, `pickup-a-${randomUUID()}`),
        body: JSON.stringify({
          receiverName: 'Người nhận A',
          receiverNote: 'Bàn giao tại quầy',
          handedOverAt: '2026-08-04T08:00:00.000Z',
        }),
      })),
      fetchJson(await fetch(`${baseUrl}/api/delivery-orders/${deliveryOrderId}/pickup-handover`, {
        method: 'POST',
        headers: authHeaders(config, `pickup-b-${randomUUID()}`),
        body: JSON.stringify({
          receiverName: 'Người nhận B',
          receiverNote: 'Request đồng thời',
          handedOverAt: '2026-08-04T08:00:00.000Z',
        }),
      })),
    ]);
    assert.deepEqual(concurrentIssue.map((entry) => entry.response.status).sort(), [201, 409]);
    const issued = concurrentIssue.find((entry) => entry.response.status === 201);
    assert.equal(issued.body.data.issue.status, 'POSTED');
    assert.equal(issued.body.data.issue.issueSourceType, 'PICKUP_HANDOVER');
    assert.equal(issued.body.data.issue.lines[0].issuedBaseQuantity, '3.000000000000');

    const afterIssue = await inventoryEvidence(
      pool,
      config.installationId,
      master.warehouseId,
      master.locationId,
      master.variantId,
      opening.lot_id,
    );
    assert.deepEqual(afterIssue, {
      on_hand_quantity: '2.000000000000',
      reserved_quantity: '0.000000000000',
      reservation_state: 'CONSUMED',
      consumed_quantity: '3.000000000000',
      issued_base_quantity: '3.000000000000',
      fulfillment_status: 'issued',
      delivery_order_status: 'handed_over',
    });

    const movementEvidence = await pool.query(
      `SELECT movement.movement_type,
              movement.source_document_type,
              movement.source_document_id,
              line.base_quantity_delta::text,
              line.location_id,
              line.lot_id
         FROM inventory.inventory_movements movement
         JOIN inventory.inventory_movement_lines line
           ON line.installation_id = movement.installation_id
          AND line.movement_id = movement.id
        WHERE movement.installation_id = $1
          AND movement.id = $2`,
      [config.installationId, issued.body.data.issue.inventoryMovementId],
    );
    assert.deepEqual(movementEvidence.rows[0], {
      movement_type: 'SALES_DELIVERY_ISSUE',
      source_document_type: 'DELIVERY_ORDER',
      source_document_id: deliveryOrderId,
      base_quantity_delta: '-3.000000000000',
      location_id: master.locationId,
      lot_id: opening.lot_id,
    });

    const reversed = await fetchJson(await fetch(
      `${baseUrl}/api/delivery-orders/${deliveryOrderId}/reverse-inventory-issue`,
      {
        method: 'POST',
        headers: authHeaders(config, `reverse-${randomUUID()}`),
        body: JSON.stringify({
          documentDate: '2026-08-04',
          reasonCode: 'OPERATOR_CORRECTION',
          reasonNote: 'Bàn giao nhầm người nhận trong kiểm thử',
        }),
      },
    ));
    assert.equal(reversed.response.status, 201, JSON.stringify(reversed.body));
    assert.equal(reversed.body.data.issue.status, 'REVERSED');

    const afterReversal = await inventoryEvidence(
      pool,
      config.installationId,
      master.warehouseId,
      master.locationId,
      master.variantId,
      opening.lot_id,
    );
    assert.deepEqual(afterReversal, {
      on_hand_quantity: '5.000000000000',
      reserved_quantity: '3.000000000000',
      reservation_state: 'ACTIVE',
      consumed_quantity: '0.000000000000',
      issued_base_quantity: '0.000000000000',
      fulfillment_status: 'packed',
      delivery_order_status: 'ready_to_dispatch',
    });

    const reissued = await fetchJson(await fetch(`${baseUrl}/api/delivery-orders/${deliveryOrderId}/pickup-handover`, {
      method: 'POST',
      headers: authHeaders(config, `pickup-reissue-${randomUUID()}`),
      body: JSON.stringify({
        receiverName: 'Người nhận đúng',
        receiverNote: 'Bàn giao lại sau reversal',
        handedOverAt: '2026-08-04T09:00:00.000Z',
      }),
    }));
    assert.equal(reissued.response.status, 201, JSON.stringify(reissued.body));

    const returnEligibility = await fetchJson(await fetch(
      `${baseUrl}/api/delivery-orders/customer-returns/eligibility?deliveryOrderId=${deliveryOrderId}`,
      { headers: authHeaders(config, null, false) },
    ));
    assert.equal(returnEligibility.response.status, 200, JSON.stringify(returnEligibility.body));
    assert.equal(returnEligibility.body.data.length, 1);
    assert.equal(returnEligibility.body.data[0].availableReturnBaseQuantity, '3.000000000000');
    const issueLineId = returnEligibility.body.data[0].issueLineId;

    const draft = await fetchJson(await fetch(`${baseUrl}/api/delivery-orders/customer-returns`, {
      method: 'POST',
      headers: authHeaders(config, `return-create-${randomUUID()}`),
      body: JSON.stringify({
        note: 'Khách trả một phần',
        lines: [{
          issueLineId,
          quantity: '2.000000000000',
          reasonCode: 'QUALITY_COMPLAINT',
          reasonNote: 'Khách phản ánh chất lượng bao bì',
        }],
      }),
    }));
    assert.equal(draft.response.status, 201, JSON.stringify(draft.body));
    assert.equal(draft.body.data.customerReturn.status, 'draft');
    const customerReturnId = draft.body.data.customerReturn.id;
    const customerReturnLineId = draft.body.data.customerReturn.lines[0].id;

    const beforeReceive = await inventoryEvidence(
      pool,
      config.installationId,
      master.warehouseId,
      master.locationId,
      master.variantId,
      opening.lot_id,
    );
    assert.equal(beforeReceive.on_hand_quantity, '2.000000000000');

    const received = await fetchJson(await fetch(
      `${baseUrl}/api/delivery-orders/customer-returns/${customerReturnId}/receive`,
      {
        method: 'POST',
        headers: authHeaders(config, `return-receive-${randomUUID()}`),
        body: JSON.stringify({
          documentDate: '2026-08-04',
          expectedRevision: '1',
          lines: [{ customerReturnLineId, acceptedQuantity: '1.000000000000' }],
        }),
      },
    ));
    assert.equal(received.response.status, 201, JSON.stringify(received.body));
    assert.equal(received.body.data.customerReturn.status, 'received');
    assert.equal(received.body.data.customerReturn.lines[0].acceptedBaseQuantity, '1.000000000000');

    const afterReceive = await inventoryEvidence(
      pool,
      config.installationId,
      master.warehouseId,
      master.locationId,
      master.variantId,
      opening.lot_id,
    );
    assert.equal(afterReceive.on_hand_quantity, '3.000000000000');
    assert.equal(afterReceive.reserved_quantity, '0.000000000000');

    const nextEligibility = await fetchJson(await fetch(
      `${baseUrl}/api/delivery-orders/customer-returns/eligibility?deliveryOrderId=${deliveryOrderId}`,
      { headers: authHeaders(config, null, false) },
    ));
    assert.equal(nextEligibility.body.data[0].availableReturnBaseQuantity, '2.000000000000');

    const competingReturns = await Promise.all([
      fetchJson(await fetch(`${baseUrl}/api/delivery-orders/customer-returns`, {
        method: 'POST',
        headers: authHeaders(config, `return-a-${randomUUID()}`),
        body: JSON.stringify({
          lines: [{ issueLineId, quantity: '2.000000000000', reasonCode: 'OTHER', reasonNote: 'Nhánh A' }],
        }),
      })),
      fetchJson(await fetch(`${baseUrl}/api/delivery-orders/customer-returns`, {
        method: 'POST',
        headers: authHeaders(config, `return-b-${randomUUID()}`),
        body: JSON.stringify({
          lines: [{ issueLineId, quantity: '2.000000000000', reasonCode: 'OTHER', reasonNote: 'Nhánh B' }],
        }),
      })),
    ]);
    assert.deepEqual(competingReturns.map((entry) => entry.response.status).sort(), [201, 409]);
    const winningDraft = competingReturns.find((entry) => entry.response.status === 201).body.data.customerReturn;

    const cancelled = await fetchJson(await fetch(
      `${baseUrl}/api/delivery-orders/customer-returns/${winningDraft.id}/cancel`,
      {
        method: 'POST',
        headers: authHeaders(config, `return-cancel-${randomUUID()}`),
        body: JSON.stringify({ reason: 'Khách rút yêu cầu trả phần còn lại' }),
      },
    ));
    assert.equal(cancelled.response.status, 201, JSON.stringify(cancelled.body));
    assert.equal(cancelled.body.data.customerReturn.status, 'cancelled');

    const auditEvidence = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM shared.core_audit_records
           WHERE installation_id = $1
             AND resource_type IN ('delivery_order_inventory_issue', 'customer_return')) AS audits,
         (SELECT count(*)::int FROM shared.core_outbox_events
           WHERE installation_id = $1
             AND aggregate_type IN ('sales.delivery_order', 'sales.customer_return')) AS events,
         (SELECT count(*)::int FROM inventory.inventory_movements
           WHERE installation_id = $1
             AND movement_type IN ('SALES_DELIVERY_ISSUE', 'SALES_CUSTOMER_RETURN', 'REVERSAL')) AS movements`,
      [config.installationId],
    );
    assert.ok(auditEvidence.rows[0].audits >= 6);
    assert.ok(auditEvidence.rows[0].events >= 6);
    assert.equal(auditEvidence.rows[0].movements, 4);
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});