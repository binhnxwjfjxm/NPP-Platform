import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { loadConfig } from '../src/config.js';
import { getPool, closePool } from '../src/db/pool.js';
import {
  confirmSalesOrder,
  createSalesOrder,
  quickEditManualSalesOrder,
} from '../src/services/sales-order.js';
import * as fulfillmentRepository from '../src/db/repositories/sales-fulfillment-operations.js';
import {
  executePackFulfillmentAllocation,
  executePickFulfillmentAllocation,
} from '../src/services/sales-fulfillment-operations.js';
import { handleSalesOrderRoutes } from '../src/routes/sales-orders.js';
import {
  executeConfirmDeliveryOrder,
  executeCreateDeliveryOrder,
} from '../src/services/sales-delivery-orders.js';
import {
  assignDeliveryOrder,
  createDeliveryRoute,
  createDeliveryTrip,
  createDriverProfile,
  createVehicle,
  lockDeliveryTrip,
  planDeliveryTrip,
} from '../src/services/logistics-trip-planning.js';
import { dispatchDeliveryTrip } from '../src/services/logistics-trip-dispatch.js';

function configForTest() {
  return loadConfig({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3097',
    INSTALLATION_ID: `manual-edit-allocation-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:manual-edit-allocation-bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
  });
}

function context(installationId, warehouseId, requestId) {
  return Object.freeze({
    installationId,
    actorId: 'test:manual-edit-allocation',
    employeeId: null,
    sourceApp: 'npp-core-api',
    requestId,
    receivedAt: '2026-08-19T04:00:00.000Z',
    roles: Object.freeze(['sales-operator']),
    permissions: Object.freeze([
      'core.fulfillment.pick',
      'core.fulfillment.pack',
      'core.delivery-order.create',
      'core.delivery-order.confirm',
      'core.delivery-trip.dispatch',
      'core.delivery-order.issue-inventory',
    ]),
    scopes: Object.freeze({
      branchIds: Object.freeze([]),
      warehouseIds: Object.freeze([warehouseId]),
      territoryIds: Object.freeze([]),
    }),
  });
}

async function seed(client, installationId) {
  const actor = 'test:manual-edit-allocation-fixture';
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

  await client.query(
    `INSERT INTO shared.branches
      (id, installation_id, code, name, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,true,$5,$5)`,
    [branchId, installationId, `BR-${suffix}`, `Chi nhánh ${suffix}`, actor],
  );
  await client.query(
    `INSERT INTO shared.warehouses
      (id, installation_id, branch_id, code, name, warehouse_type, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,'main',true,$6,$6)`,
    [warehouseId, installationId, branchId, `WH-${suffix}`, `Kho ${suffix}`, actor],
  );
  await client.query(
    `INSERT INTO shared.customers
      (id, installation_id, code, name, payment_terms_days, credit_limit,
       is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,15,10000000,true,$5,$5)`,
    [customerId, installationId, `CUS-${suffix}`, `Khách ${suffix}`, actor],
  );
  await client.query(
    `INSERT INTO shared.customer_addresses
      (id, installation_id, customer_id, label, recipient_name, address_line1,
       province, country_code, is_default, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,'Cửa hàng','Người nhận','123 Đường kiểm thử',
       'TP HCM','VN',true,true,$4,$4)`,
    [addressId, installationId, customerId, actor],
  );
  await client.query(
    `INSERT INTO shared.units_of_measure
      (id, installation_id, code, name, unit_kind, allows_fractional, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,'COUNT',false,true,$5,$5)`,
    [unitId, installationId, `EA${suffix.slice(0, 4)}`, `Đơn vị ${suffix}`, actor],
  );
  await client.query(
    `INSERT INTO shared.products
      (id, installation_id, code, name, is_orderable, is_active, created_by, updated_by)
     VALUES
      ($1,$2,$3,$4,true,true,$5,$5),
      ($6,$2,$7,$8,true,true,$5,$5)`,
    [
      firstProductId, installationId, `P1-${suffix}`, `Sản phẩm 1 ${suffix}`, actor,
      secondProductId, `P2-${suffix}`, `Sản phẩm 2 ${suffix}`,
    ],
  );
  await client.query(
    `INSERT INTO shared.product_variants
      (id, installation_id, product_id, sku, name, variant_kind,
       is_inventory_base, is_sellable, is_catalog_visible, is_active,
       unit_id, conversion_to_base, is_purchasable, created_by, updated_by)
     VALUES
      ($1,$3,$4,$5,$6,'BASE',true,true,true,true,$10,1,true,$11,$11),
      ($2,$3,$7,$8,$9,'BASE',true,true,true,true,$10,1,true,$11,$11)`,
    [
      firstVariantId, secondVariantId, installationId,
      firstProductId, `SKU1-${suffix}`, `SKU 1 ${suffix}`,
      secondProductId, `SKU2-${suffix}`, `SKU 2 ${suffix}`,
      unitId, actor,
    ],
  );
  await client.query(
    `INSERT INTO shared.sales_channels
      (id, installation_id, code, name, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,true,$5,$5)`,
    [channelId, installationId, `CH-${suffix}`, `Kênh ${suffix}`, actor],
  );
  await client.query(
    `INSERT INTO shared.price_lists
      (id, installation_id, code, name, list_type, currency_code, priority,
       stacking_mode, stop_processing, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,'BASE','VND',100,'EXCLUSIVE',true,true,$5,$5)`,
    [priceListId, installationId, `BASE-${suffix}`, `Giá ${suffix}`, actor],
  );
  await client.query(
    `INSERT INTO shared.price_list_items
      (id, installation_id, price_list_id, variant_id, adjustment_type,
       amount_minor, min_quantity, source_kind, is_active, created_by, updated_by)
     VALUES
      ($1,$3,$4,$5,'FIXED_PRICE',10000,0,'ADMIN',true,$7,$7),
      ($2,$3,$4,$6,'FIXED_PRICE',20000,0,'ADMIN',true,$7,$7)`,
    [randomUUID(), randomUUID(), installationId, priceListId, firstVariantId, secondVariantId, actor],
  );
  await client.query(
    `INSERT INTO shared.sales_order_settings
      (installation_id, allow_backorder, created_by, updated_by)
     VALUES ($1,true,$2,$2)
     ON CONFLICT (installation_id) DO UPDATE
       SET allow_backorder=true, updated_at=now(), updated_by=EXCLUDED.updated_by`,
    [installationId, actor],
  );

  await client.query("SELECT set_config('npp.inventory_balance_write_context', 'rebuild', true)");
  await client.query(
    `INSERT INTO inventory.inventory_balances (
       installation_id, warehouse_id, location_id, base_variant_id, lot_id,
       on_hand_quantity, reserved_quantity, updated_at
     ) VALUES
       ($1,$2,NULL,$3,NULL,20,0,now()),
       ($1,$2,NULL,$4,NULL,20,0,now())`,
    [installationId, warehouseId, firstVariantId, secondVariantId],
  );

  return {
    warehouseId,
    customerId,
    addressId,
    channelId,
    firstVariantId,
    secondVariantId,
  };
}

function orderPayload(fixture, lines, deliveryExecutionMode = 'MANUAL') {
  return {
    sourceType: 'MANUAL',
    customerId: fixture.customerId,
    customerAddressId: fixture.addressId,
    warehouseId: fixture.warehouseId,
    salesChannelId: fixture.channelId,
    deliveryMode: 'DELIVERY',
    deliveryExecutionMode,
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

function responseCapture() {
  return {
    statusCode: null,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      for (const [name, value] of Object.entries(headers)) this.headers[String(name).toLowerCase()] = value;
    },
    end(body = '') {
      this.body = String(body);
    },
  };
}

async function invokeCancelRoute(pool, requestContext, orderId, reason, key) {
  const req = Readable.from([JSON.stringify({ reason })]);
  req.url = `/api/sales-orders/${orderId}/cancel`;
  req.method = 'POST';
  req.headers = { 'idempotency-key': key };
  const res = responseCapture();
  await handleSalesOrderRoutes(req, res, {
    config: {},
    requestId: requestContext.requestId,
    receivedAt: requestContext.receivedAt,
    PERMISSIONS: { coreSalesOrderCancel: 'core.sales-order.cancel' },
    authenticate: () => ({ ok: true, principal: { id: requestContext.actorId } }),
    authorize: () => ({ ok: true }),
    createContext: () => requestContext,
    getPool: () => pool,
    idempotencyStore: {},
    executeRequestWithIdempotency: async ({ onProcess }) => ({
      response: await onProcess(),
      replayed: false,
    }),
  });
  return Object.freeze({ statusCode: res.statusCode, body: JSON.parse(res.body) });
}

async function activeDemand(client, installationId, salesOrderId, baseVariantId) {
  const result = await client.query(
    `SELECT *
       FROM sales.sales_order_fulfillment_demands
      WHERE installation_id = $1
        AND sales_order_id = $2::uuid
        AND base_variant_id = $3::uuid
        AND state = 'ACTIVE'
      FOR UPDATE`,
    [installationId, salesOrderId, baseVariantId],
  );
  return result.rows[0] ?? null;
}

async function seedExactAllocation(client, installationId, requestContext, demand) {
  const allocationId = randomUUID();
  const reservationId = randomUUID();
  const key = `manual-edit-allocation.${randomUUID()}`;
  const childKey = `manual-edit-allocation-child.${randomUUID()}`;
  const hash = 'a'.repeat(64);
  const quantity = '1.000000000000';
  const occurredAt = requestContext.receivedAt;

  await fulfillmentRepository.setFulfillmentAllocationWriteContexts(client);
  const progressed = await fulfillmentRepository.incrementDemandAllocatedQuantity(client, {
    installationId,
    demandId: demand.id,
    quantity,
    actorId: requestContext.actorId,
  });
  assert.ok(progressed);

  const reservation = await fulfillmentRepository.insertInventoryReservation(client, {
    id: reservationId,
    installationId,
    warehouseId: demand.warehouse_id,
    locationId: null,
    baseVariantId: demand.base_variant_id,
    lotId: null,
    quantity,
    allocationId,
    occurredAt,
    idempotencyKey: childKey,
    payloadHash: hash,
    metadata: { salesOrderId: demand.sales_order_id, fixture: true },
  });
  assert.ok(reservation);
  await fulfillmentRepository.insertInventoryReservationEvent(client, {
    installationId,
    reservationId,
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
    payloadHash: hash,
    occurredAt,
    metadata: { fixture: true, allocationId },
  });
  const allocation = await fulfillmentRepository.insertAllocation(client, {
    id: allocationId,
    installationId,
    demandId: demand.id,
    salesOrderId: demand.sales_order_id,
    salesOrderVersionId: demand.sales_order_version_id,
    salesOrderLineId: demand.sales_order_line_id,
    warehouseId: demand.warehouse_id,
    locationId: null,
    baseVariantId: demand.base_variant_id,
    lotId: null,
    inventoryReservationId: reservationId,
    allocationSequence: 1,
    allocationPolicy: 'FIFO',
    policyRank: 1,
    manualOverrideReason: null,
    quantity,
    operationIdempotencyKey: key,
    idempotencyKey: childKey,
    payloadHash: hash,
    actorId: requestContext.actorId,
  });
  assert.ok(allocation);
  await fulfillmentRepository.insertAllocationEvent(client, {
    installationId,
    allocationId,
    eventType: 'ALLOCATED',
    quantity,
    actorId: requestContext.actorId,
    requestId: requestContext.requestId,
    sourceApp: requestContext.sourceApp,
    idempotencyKey: childKey,
    payloadHash: hash,
    reason: null,
    metadata: { fixture: true },
    occurredAt,
  });
  return { allocationId, reservationId };
}

async function prepareExecutionOrder(pool, installationId, fixture, label, executionMode = 'TRIP') {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const requestContext = context(installationId, fixture.warehouseId, `req-${label}-${randomUUID()}`);
    const created = await createSalesOrder(client, {
      requestContext,
      payload: orderPayload(
        fixture,
        [{ variantId: fixture.firstVariantId, quantity: '1' }],
        executionMode,
      ),
    });
    assert.equal(created.ok, true, JSON.stringify(created));
    const confirmed = await confirmSalesOrder(client, {
      requestContext,
      id: created.salesOrder.id,
      versionNumber: 1,
      idempotencyKey: `confirm.${randomUUID()}`,
    });
    assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
    const demand = await activeDemand(
      client,
      installationId,
      created.salesOrder.id,
      fixture.firstVariantId,
    );
    const exact = await seedExactAllocation(client, installationId, requestContext, demand);
    await client.query('COMMIT');
    return Object.freeze({
      requestContext,
      orderId: created.salesOrder.id,
      allocationId: exact.allocationId,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function progressAllocation(pool, prepared, state) {
  if (state === 'picked' || state === 'packed') {
    const picked = await executePickFulfillmentAllocation({
      adapter: pool,
      requestContext: prepared.requestContext,
      allocationId: prepared.allocationId,
      idempotencyKey: `pick.${randomUUID()}`,
      payload: { quantity: '1' },
    });
    assert.equal(picked.ok, true, JSON.stringify(picked));
  }
  if (state === 'packed') {
    const packed = await executePackFulfillmentAllocation({
      adapter: pool,
      requestContext: prepared.requestContext,
      allocationId: prepared.allocationId,
      idempotencyKey: `pack.${randomUUID()}`,
      payload: { quantity: '1' },
    });
    assert.equal(packed.ok, true, JSON.stringify(packed));
  }
}

async function prepareTrip(pool, fixture, prepared, label, dispatched) {
  await progressAllocation(pool, prepared, 'packed');
  const driverEmployeeId = randomUUID();
  await pool.query(
    `INSERT INTO shared.employees
      (id, installation_id, code, full_name, job_title, phone, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,'Tài xế','0900000000',true,$5,$5)`,
    [
      driverEmployeeId,
      prepared.requestContext.installationId,
      `TX-${label}`,
      `Tài xế ${label}`,
      prepared.requestContext.actorId,
    ],
  );
  const delivery = await executeCreateDeliveryOrder({
    adapter: pool,
    requestContext: prepared.requestContext,
    idempotencyKey: `delivery-create.${randomUUID()}`,
    payload: {
      lines: [{ fulfillmentAllocationId: prepared.allocationId, quantity: '1' }],
    },
  });
  assert.equal(delivery.ok, true, JSON.stringify(delivery));
  const deliveryOrderId = delivery.deliveryOrder.id;
  const confirmed = await executeConfirmDeliveryOrder({
    adapter: pool,
    requestContext: prepared.requestContext,
    deliveryOrderId,
    idempotencyKey: `delivery-confirm.${randomUUID()}`,
    payload: {},
  });
  assert.equal(confirmed.ok, true, JSON.stringify(confirmed));

  const route = await createDeliveryRoute({
    adapter: pool,
    requestContext: prepared.requestContext,
    payload: {
      code: `TUYEN-${label}`,
      name: `Tuyến ${label}`,
      defaultWarehouseId: fixture.warehouseId,
    },
  });
  assert.equal(route.ok, true, JSON.stringify(route));
  const vehicle = await createVehicle({
    adapter: pool,
    requestContext: prepared.requestContext,
    payload: {
      code: `XE-${label}`,
      licensePlate: `51C-${randomUUID().slice(0, 5)}`,
      vehicleType: 'Xe tải',
    },
  });
  assert.equal(vehicle.ok, true, JSON.stringify(vehicle));
  const driver = await createDriverProfile({
    adapter: pool,
    requestContext: prepared.requestContext,
    payload: {
      code: `TX-${label}`,
      name: `Tài xế ${label}`,
      employeeId: driverEmployeeId,
      licenseReference: `B2-${label}`,
    },
  });
  assert.equal(driver.ok, true, JSON.stringify(driver));
  const trip = await createDeliveryTrip({
    adapter: pool,
    requestContext: prepared.requestContext,
    idempotencyKey: `trip-create.${randomUUID()}`,
    payload: {
      warehouseId: fixture.warehouseId,
      deliveryRouteId: route.delivery_route.id,
      vehicleId: vehicle.vehicle.id,
      primaryDriverId: driver.driver_profile.id,
      plannedStartAt: '2026-08-20T01:00:00.000Z',
      note: `Chuyến ${label}`,
    },
  });
  assert.equal(trip.ok, true, JSON.stringify(trip));
  const tripId = trip.trip.id;
  const assigned = await assignDeliveryOrder({
    adapter: pool,
    requestContext: prepared.requestContext,
    tripId,
    idempotencyKey: `trip-assign.${randomUUID()}`,
    payload: { deliveryOrderId },
  });
  assert.equal(assigned.ok, true, JSON.stringify(assigned));
  const planned = await planDeliveryTrip({
    adapter: pool,
    requestContext: prepared.requestContext,
    tripId,
    idempotencyKey: `trip-plan.${randomUUID()}`,
    payload: {},
  });
  assert.equal(planned.ok, true, JSON.stringify(planned));
  const locked = await lockDeliveryTrip({
    adapter: pool,
    requestContext: prepared.requestContext,
    tripId,
    idempotencyKey: `trip-lock.${randomUUID()}`,
    payload: {},
  });
  assert.equal(locked.ok, true, JSON.stringify(locked));
  if (dispatched) {
    const dispatch = await dispatchDeliveryTrip({
      adapter: pool,
      requestContext: prepared.requestContext,
      tripId,
      idempotencyKey: `trip-dispatch.${randomUUID()}`,
      payload: {
        dispatchedAt: '2026-08-19T10:05:00.000Z',
        handoverReceiverName: 'Tài xế kiểm thử',
        handoverNote: 'Bàn giao đủ hàng',
      },
    });
    assert.equal(dispatch.ok, true, JSON.stringify(dispatch));
  }
  return Object.freeze({ deliveryOrderId, tripId });
}

test('Giao thủ công giải phóng phân bổ chưa xử lý rồi cho bớt SKU mà không 409', async () => {
  const config = configForTest();
  const pool = getPool(config);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const fixture = await seed(client, config.installationId);
    const requestContext = context(config.installationId, fixture.warehouseId, `req-${randomUUID()}`);
    const sourceId = `CUSTOMER_PORTAL:${randomUUID()}`;

    const created = await createSalesOrder(client, {
      requestContext,
      payload: {
        ...orderPayload(fixture, [
          { variantId: fixture.firstVariantId, quantity: '2' },
          { variantId: fixture.secondVariantId, quantity: '3' },
        ]),
        sourceType: 'API',
        sourceId,
      },
    });
    assert.equal(created.ok, true, JSON.stringify(created));
    const confirmed = await confirmSalesOrder(client, {
      requestContext,
      id: created.salesOrder.id,
      versionNumber: 1,
      idempotencyKey: `confirm.${randomUUID()}`,
    });
    assert.equal(confirmed.ok, true, JSON.stringify(confirmed));

    const firstDemand = await activeDemand(
      client,
      config.installationId,
      created.salesOrder.id,
      fixture.firstVariantId,
    );
    assert.ok(firstDemand);
    const exact = await seedExactAllocation(client, config.installationId, requestContext, firstDemand);

    const allocationBefore = await client.query(
      `SELECT state, allocated_base_quantity::text, picked_base_quantity::text, packed_base_quantity::text
         FROM sales.sales_order_fulfillment_allocations
        WHERE installation_id = $1 AND id = $2`,
      [config.installationId, exact.allocationId],
    );
    assert.equal(allocationBefore.rows[0].state, 'ACTIVE');
    assert.equal(Number(allocationBefore.rows[0].picked_base_quantity), 0);
    assert.equal(Number(allocationBefore.rows[0].packed_base_quantity), 0);

    const edited = await quickEditManualSalesOrder(client, {
      requestContext: { ...requestContext, requestId: `req-${randomUUID()}` },
      id: created.salesOrder.id,
      payload: orderPayload(fixture, [
        { variantId: fixture.secondVariantId, quantity: '3' },
      ]),
      idempotencyKey: `manual-edit.${randomUUID()}`,
    });
    assert.equal(edited.ok, true, JSON.stringify(edited));
    const current = edited.salesOrder.versions.find(
      (version) => String(version.versionNumber) === String(edited.salesOrder.currentVersionNumber),
    );
    assert.equal(current.sourceType, 'API');
    assert.equal(current.sourceId, sourceId);
    assert.deepEqual(current.lines.map((line) => line.variantId), [fixture.secondVariantId]);

    const released = await client.query(
      `SELECT allocation.state AS allocation_state,
              reservation.state AS reservation_state,
              EXISTS (
                SELECT 1
                  FROM sales.sales_order_fulfillment_allocation_events event
                 WHERE event.installation_id = allocation.installation_id
                   AND event.allocation_id = allocation.id
                   AND event.event_type = 'RELEASED'
              ) AS release_event,
              EXISTS (
                SELECT 1
                  FROM inventory.inventory_reservation_events event
                 WHERE event.installation_id = reservation.installation_id
                   AND event.reservation_id = reservation.id
                   AND event.transition = 'RELEASE_TO_RELEASED'
              ) AS reservation_release_event
         FROM sales.sales_order_fulfillment_allocations allocation
         JOIN inventory.inventory_reservations reservation
           ON reservation.installation_id = allocation.installation_id
          AND reservation.id = allocation.inventory_reservation_id
        WHERE allocation.installation_id = $1
          AND allocation.id = $2`,
      [config.installationId, exact.allocationId],
    );
    assert.deepEqual(released.rows[0], {
      allocation_state: 'RELEASED',
      reservation_state: 'RELEASED',
      release_event: true,
      reservation_release_event: true,
    });

    const oldDemand = await client.query(
      `SELECT state, allocated_base_quantity::text
         FROM sales.sales_order_fulfillment_demands
        WHERE installation_id = $1 AND id = $2`,
      [config.installationId, firstDemand.id],
    );
    assert.equal(oldDemand.rows[0].state, 'SUPERSEDED');
    assert.equal(Number(oldDemand.rows[0].allocated_base_quantity), 0);

    const active = await client.query(
      `SELECT base_variant_id, state
         FROM sales.sales_order_fulfillment_demands
        WHERE installation_id = $1
          AND sales_order_id = $2::uuid
          AND state = 'ACTIVE'
        ORDER BY line_number`,
      [config.installationId, created.salesOrder.id],
    );
    assert.deepEqual(active.rows, [{ base_variant_id: fixture.secondVariantId, state: 'ACTIVE' }]);

    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await closePool();
  }
});

test('route Hủy hoàn tác đủ giữ hàng, soạn hàng, đóng gói và chuyến chưa giao khách', async () => {
  const config = configForTest();
  const pool = getPool(config);
  try {
    const seedClient = await pool.connect();
    let fixture;
    try {
      await seedClient.query('BEGIN');
      fixture = await seed(seedClient, config.installationId);
      await seedClient.query('COMMIT');
    } catch (error) {
      await seedClient.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      seedClient.release();
    }

    for (const state of ['held', 'picked', 'packed']) {
      const prepared = await prepareExecutionOrder(
        pool,
        config.installationId,
        fixture,
        state,
      );
      await progressAllocation(pool, prepared, state);
      const cancelled = await invokeCancelRoute(
        pool,
        prepared.requestContext,
        prepared.orderId,
        `Hủy ca ${state}`,
        `cancel-${state}.${randomUUID()}`,
      );
      assert.equal(cancelled.statusCode, 200, JSON.stringify(cancelled.body));
      assert.equal(cancelled.body.data.status, 'cancelled');
      const stateResult = await pool.query(
        `SELECT orders.status,
                demand.state AS demand_state,
                allocation.state AS allocation_state,
                reservation.state AS reservation_state,
                allocation.picked_base_quantity::text AS picked,
                allocation.packed_base_quantity::text AS packed
           FROM sales.sales_orders orders
           JOIN sales.sales_order_fulfillment_demands demand
             ON demand.installation_id = orders.installation_id
            AND demand.sales_order_id = orders.id
           JOIN sales.sales_order_fulfillment_allocations allocation
             ON allocation.installation_id = demand.installation_id
            AND allocation.fulfillment_demand_id = demand.id
           JOIN inventory.inventory_reservations reservation
             ON reservation.installation_id = allocation.installation_id
            AND reservation.id = allocation.inventory_reservation_id
          WHERE orders.installation_id = $1 AND orders.id = $2::uuid`,
        [config.installationId, prepared.orderId],
      );
      assert.deepEqual(stateResult.rows[0], {
        status: 'cancelled',
        demand_state: 'CANCELLED',
        allocation_state: 'RELEASED',
        reservation_state: 'RELEASED',
        picked: '0.000000000000',
        packed: '0.000000000000',
      });
    }

    for (const dispatched of [false, true]) {
      const label = dispatched ? 'DA-XUAT-PHAT' : 'DA-KHOA';
      const prepared = await prepareExecutionOrder(
        pool,
        config.installationId,
        fixture,
        label,
      );
      const trip = await prepareTrip(pool, fixture, prepared, label, dispatched);
      const cancelled = await invokeCancelRoute(
        pool,
        prepared.requestContext,
        prepared.orderId,
        `Hủy ca ${label}`,
        `cancel-${label}.${randomUUID()}`,
      );
      assert.equal(cancelled.statusCode, 200, JSON.stringify(cancelled.body));
      const tripState = await pool.query(
        `SELECT orders.status,
                delivery_order.status AS delivery_order_status,
                delivery_trip.status AS trip_status,
                assignment.unassigned_at IS NOT NULL AS unassigned,
                stop.id IS NOT NULL AS stop_history_retained,
                issue.status AS issue_status
           FROM sales.sales_orders orders
           JOIN sales.delivery_orders delivery_order
             ON delivery_order.installation_id = orders.installation_id
            AND delivery_order.sales_order_id = orders.id
           JOIN logistics.trip_order_assignments assignment
             ON assignment.installation_id = delivery_order.installation_id
            AND assignment.delivery_order_id = delivery_order.id
           JOIN logistics.delivery_trips delivery_trip
             ON delivery_trip.installation_id = assignment.installation_id
            AND delivery_trip.id = assignment.trip_id
           JOIN logistics.trip_stops stop
             ON stop.installation_id = assignment.installation_id
            AND stop.id = assignment.trip_stop_id
           LEFT JOIN logistics.trip_dispatch_items dispatch_item
             ON dispatch_item.installation_id = assignment.installation_id
            AND dispatch_item.assignment_id = assignment.id
           LEFT JOIN sales.delivery_order_inventory_issues issue
             ON issue.installation_id = dispatch_item.installation_id
            AND issue.id = dispatch_item.inventory_issue_id
          WHERE orders.installation_id = $1
            AND orders.id = $2::uuid
            AND delivery_trip.id = $3::uuid`,
        [config.installationId, prepared.orderId, trip.tripId],
      );
      assert.deepEqual(tripState.rows[0], {
        status: 'cancelled',
        delivery_order_status: 'cancelled',
        trip_status: dispatched ? 'recovered' : 'draft',
        unassigned: true,
        stop_history_retained: true,
        issue_status: dispatched ? 'REVERSED' : null,
      });
    }
  } finally {
    await closePool();
  }
});
