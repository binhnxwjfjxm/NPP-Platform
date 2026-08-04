import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { closePool, getPool } from '../src/db/pool.js';
import { startServer } from '../src/server.js';

function closeServer(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function fetchJson(responseOrPromise) {
  const response = await responseOrPromise;
  const body = await response.json();
  return { response, body };
}

function deliveryHeaders(config, employeeId, idempotencyKey = null) {
  return {
    Authorization: `Bearer ${config.deliveryFrontendApiToken}`,
    'x-npp-delivery-employee-id': employeeId,
    ...(idempotencyKey ? {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    } : {}),
  };
}

test('PostgreSQL driver attempts preserve ownership, idempotency and inventory custody', async () => {
  const installationId = `delivery-driver-${randomUUID()}`;
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const employeeA = randomUUID();
  const employeeB = randomUUID();
  const driverA = randomUUID();
  const driverB = randomUUID();
  const vehicleId = randomUUID();
  const tripA = randomUUID();
  const tripB = randomUUID();
  const stopId = randomUUID();
  const assignmentId = randomUUID();
  const deliveryOrderId = randomUUID();
  const deliveryOrderLineId = randomUUID();
  const inventoryIssueId = randomUUID();
  const inventoryIssueLineId = randomUUID();
  const dispatchItemId = randomUUID();
  const dispatchId = randomUUID();
  const movementId = randomUUID();
  const fakeCustomerId = randomUUID();
  const fakeCustomerAddressId = randomUUID();
  const fakeSalesOrderId = randomUUID();
  const fakeSalesOrderVersionId = randomUUID();
  const fakeSalesOrderLineId = randomUUID();
  const fakeDemandId = randomUUID();
  const fakeAllocationId = randomUUID();
  const fakeReservationId = randomUUID();
  const fakeVariantId = randomUUID();
  const config = loadConfig({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3068',
    INSTALLATION_ID: installationId,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    DELIVERY_FRONTEND_API_TOKEN: 'delivery-token-0123456789abcdef',
    DELIVERY_FRONTEND_ACTOR_ID: 'service:delivery-test',
    DELIVERY_FRONTEND_WAREHOUSE_IDS: warehouseId,
    CORS_ORIGINS: 'http://127.0.0.1:3005',
  });
  const pool = getPool(config);
  const fixture = await pool.connect();
  let server;
  const actor = 'test:delivery-fixture';
  try {
    await fixture.query('BEGIN');
    await fixture.query(
      `INSERT INTO shared.branches
        (id, installation_id, code, name, is_active, created_by, updated_by)
       VALUES ($1,$2,'BR-DELIVERY','Chi nhánh giao hàng',true,$3,$3)`,
      [branchId, installationId, actor],
    );
    await fixture.query(
      `INSERT INTO shared.warehouses
        (id, installation_id, branch_id, code, name, warehouse_type, is_active, created_by, updated_by)
       VALUES ($1,$2,$3,'WH-DELIVERY','Kho giao hàng','main',true,$4,$4)`,
      [warehouseId, installationId, branchId, actor],
    );
    await fixture.query(
      `INSERT INTO shared.employees
        (id, installation_id, code, full_name, is_active, created_by, updated_by)
       VALUES
        ($1,$3,'TXA','Tài xế A',true,$4,$4),
        ($2,$3,'TXB','Tài xế B',true,$4,$4)`,
      [employeeA, employeeB, installationId, actor],
    );
    await fixture.query(
      `INSERT INTO logistics.vehicles
        (id, installation_id, code, license_plate, vehicle_type, operational_status,
         is_active, created_by, updated_by)
       VALUES ($1,$2,'XE-DELIVERY','51A-00001','Xe tải','AVAILABLE',true,$3,$3)`,
      [vehicleId, installationId, actor],
    );
    await fixture.query(
      `INSERT INTO logistics.driver_profiles
        (id, installation_id, code, employee_id, name, is_active, created_by, updated_by)
       VALUES
        ($1,$3,'DRV-A',$4,'Tài xế A',true,$6,$6),
        ($2,$3,'DRV-B',$5,'Tài xế B',true,$6,$6)`,
      [driverA, driverB, installationId, employeeA, employeeB, actor],
    );

    // The fixture needs exact downstream lineage but not every upstream sales/master row.
    // Replica mode bypasses only FK/write-guard triggers while CHECK/NOT NULL constraints remain active.
    await fixture.query("SET LOCAL session_replication_role = 'replica'");
    await fixture.query(
      `INSERT INTO logistics.delivery_trips (
         id, installation_id, trip_number, warehouse_id, vehicle_id, primary_driver_id,
         planned_start_at, status, revision, create_idempotency_key, create_payload_hash,
         planned_at, planned_by, locked_at, locked_by,
         dispatch_id, dispatch_idempotency_key, dispatch_payload_hash,
         handover_receiver_name, dispatched_at, dispatched_by,
         created_by, updated_by
       ) VALUES
       ($1,$3,'TRIP-A',$4,$5,$6,'2026-08-04T01:00:00Z','dispatched',1,
        'create-trip-a',$8,'2026-08-04T00:30:00Z',$9,'2026-08-04T00:45:00Z',$9,
        $10,'dispatch-trip-a',$11,'Tài xế A','2026-08-04T01:00:00Z',$9,$9,$9),
       ($2,$3,'TRIP-B',$4,$5,$7,'2026-08-04T01:10:00Z','dispatched',1,
        'create-trip-b',$8,'2026-08-04T00:35:00Z',$9,'2026-08-04T00:50:00Z',$9,
        $12,'dispatch-trip-b',$11,'Tài xế B','2026-08-04T01:10:00Z',$9,$9,$9)`,
      [
        tripA,
        tripB,
        installationId,
        warehouseId,
        vehicleId,
        driverA,
        driverB,
        'a'.repeat(64),
        actor,
        dispatchId,
        'b'.repeat(64),
        randomUUID(),
      ],
    );
    await fixture.query(
      `INSERT INTO sales.delivery_orders (
         id, installation_id, delivery_order_number, delivery_order_number_allocation_id,
         sales_order_id, sales_order_version_id, customer_id, customer_address_id,
         warehouse_id, handover_mode, customer_code_snapshot, customer_name_snapshot,
         destination_snapshot, warehouse_code_snapshot, warehouse_name_snapshot,
         requested_delivery_date, collection_policy, status, revision,
         create_idempotency_key, create_payload_hash, confirmed_at, confirmed_by,
         created_by, updated_by
       ) VALUES (
         $1,$2,'DO-DELIVERY-1',$3,$4,$5,$6,$7,$8,'DELIVERY','KH-001','Khách thử nghiệm',
         '{"line1":"12 Nguyễn Trãi"}'::jsonb,'WH-DELIVERY','Kho giao hàng',
         '2026-08-04','PREPAID','ready_to_dispatch',1,
         'create-do-delivery',$9,'2026-08-04T00:20:00Z',$10,$10,$10
       )`,
      [
        deliveryOrderId,
        installationId,
        randomUUID(),
        fakeSalesOrderId,
        fakeSalesOrderVersionId,
        fakeCustomerId,
        fakeCustomerAddressId,
        warehouseId,
        'c'.repeat(64),
        actor,
      ],
    );
    await fixture.query(
      `INSERT INTO sales.delivery_order_lines (
         id, installation_id, delivery_order_id, line_number,
         sales_order_id, sales_order_version_id, sales_order_line_id,
         fulfillment_demand_id, fulfillment_allocation_id, inventory_reservation_id,
         warehouse_id, location_id, base_variant_id, lot_id,
         sku_snapshot, item_name_snapshot, unit_code_snapshot,
         packed_base_quantity_snapshot, delivery_base_quantity, created_by
       ) VALUES (
         $1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,NULL,$11,NULL,
         'SKU-DELIVERY','Mặt hàng giao thử','EA',3.000000000000,3.000000000000,$12
       )`,
      [
        deliveryOrderLineId,
        installationId,
        deliveryOrderId,
        fakeSalesOrderId,
        fakeSalesOrderVersionId,
        fakeSalesOrderLineId,
        fakeDemandId,
        fakeAllocationId,
        fakeReservationId,
        warehouseId,
        fakeVariantId,
        actor,
      ],
    );
    await fixture.query(
      `INSERT INTO sales.delivery_order_inventory_issues (
         id, installation_id, delivery_order_id, issue_source_type, issue_source_id,
         status, inventory_movement_id, idempotency_key, payload_hash,
         posted_at, posted_by, created_by, updated_by
       ) VALUES (
         $1,$2,$3,'LOGISTICS_DISPATCH',$4,'POSTED',$5,
         'issue-delivery-1',$6,'2026-08-04T01:00:00Z',$7,$7,$7
       )`,
      [inventoryIssueId, installationId, deliveryOrderId, dispatchId, movementId, 'd'.repeat(64), actor],
    );
    await fixture.query(
      `INSERT INTO sales.delivery_order_inventory_issue_lines (
         id, installation_id, issue_id, delivery_order_id, delivery_order_line_id,
         fulfillment_demand_id, fulfillment_allocation_id, inventory_reservation_id,
         inventory_movement_line_id, warehouse_id, location_id, base_variant_id, lot_id,
         issued_base_quantity, created_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,NULL,$9,NULL,$10,NULL,3.000000000000,$11
       )`,
      [
        inventoryIssueLineId,
        installationId,
        inventoryIssueId,
        deliveryOrderId,
        deliveryOrderLineId,
        fakeDemandId,
        fakeAllocationId,
        fakeReservationId,
        warehouseId,
        fakeVariantId,
        actor,
      ],
    );
    await fixture.query(
      `INSERT INTO logistics.trip_stops (
         id, installation_id, trip_id, stop_sequence,
         customer_id, customer_address_id, address_snapshot,
         created_by, updated_by
       ) VALUES ($1,$2,$3,1,$4,$5,'{"line1":"12 Nguyễn Trãi"}'::jsonb,$6,$6)`,
      [stopId, installationId, tripA, fakeCustomerId, fakeCustomerAddressId, actor],
    );
    await fixture.query(
      `INSERT INTO logistics.trip_order_assignments (
         id, installation_id, trip_id, trip_stop_id, delivery_order_id,
         assigned_at, assigned_by
       ) VALUES ($1,$2,$3,$4,$5,'2026-08-04T00:40:00Z',$6)`,
      [assignmentId, installationId, tripA, stopId, deliveryOrderId, actor],
    );
    await fixture.query(
      `INSERT INTO logistics.trip_dispatch_items (
         id, installation_id, dispatch_id, trip_id, assignment_id, trip_stop_id,
         delivery_order_id, inventory_issue_id, inventory_movement_id,
         posted_at, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'2026-08-04T01:00:00Z',$10)`,
      [
        dispatchItemId,
        installationId,
        dispatchId,
        tripA,
        assignmentId,
        stopId,
        deliveryOrderId,
        inventoryIssueId,
        movementId,
        actor,
      ],
    );
    await fixture.query("SET LOCAL session_replication_role = 'origin'");
    await fixture.query('COMMIT');

    const movementCountBefore = Number((await pool.query(
      'SELECT count(*) FROM inventory.inventory_movements WHERE installation_id = $1',
      [installationId],
    )).rows[0].count);

    server = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;

    const listA = await fetchJson(fetch(`${baseUrl}/api/logistics/driver/trips`, {
      headers: deliveryHeaders(config, employeeA),
    }));
    assert.equal(listA.response.status, 200, JSON.stringify(listA.body));
    assert.deepEqual(listA.body.data.trips.map((trip) => trip.id), [tripA]);
    assert.equal(listA.body.data.trips[0].attemptCount, 0);
    assert.equal(listA.body.data.driver.employeeId, employeeA);

    const own = await fetchJson(fetch(`${baseUrl}/api/logistics/driver/trips/${tripA}`, {
      headers: deliveryHeaders(config, employeeA),
    }));
    assert.equal(own.response.status, 200, JSON.stringify(own.body));
    assert.equal(own.body.data.trip.stops[0].assignments[0].lines[0].issuedBaseQuantity, '3.000000000000');
    assert.equal(own.body.data.trip.stops[0].assignments[0].attempt, null);

    const other = await fetchJson(fetch(`${baseUrl}/api/logistics/driver/trips/${tripB}`, {
      headers: deliveryHeaders(config, employeeA),
    }));
    assert.equal(other.response.status, 404, JSON.stringify(other.body));
    assert.equal(other.body.error.code, 'DELIVERY_TRIP_NOT_FOUND');

    const generic = await fetchJson(fetch(`${baseUrl}/api/logistics/trips`, {
      headers: deliveryHeaders(config, employeeA),
    }));
    assert.equal(generic.response.status, 403, JSON.stringify(generic.body));
    assert.equal(generic.body.error.code, 'PERMISSION_DENIED');

    const payload = JSON.stringify({
      result: 'delivered_full',
      attemptedAt: '2026-08-04T02:00:00.000Z',
      reasonCode: null,
      note: 'Đã giao đủ',
      rescheduledFor: null,
    });
    const competing = await Promise.all([
      fetchJson(fetch(`${baseUrl}/api/logistics/driver/trips/${tripA}/assignments/${assignmentId}/attempts`, {
        method: 'POST',
        headers: deliveryHeaders(config, employeeA, 'attempt-concurrent-a'),
        body: payload,
      })),
      fetchJson(fetch(`${baseUrl}/api/logistics/driver/trips/${tripA}/assignments/${assignmentId}/attempts`, {
        method: 'POST',
        headers: deliveryHeaders(config, employeeA, 'attempt-concurrent-b'),
        body: payload,
      })),
    ]);
    const succeeded = competing.filter((entry) => entry.response.status === 200);
    const conflicted = competing.filter((entry) => entry.response.status === 409);
    assert.equal(succeeded.length, 1, JSON.stringify(competing.map((entry) => entry.body)));
    assert.equal(conflicted.length, 1, JSON.stringify(competing.map((entry) => entry.body)));
    assert.equal(conflicted[0].body.error.code, 'DELIVERY_ATTEMPT_ALREADY_RECORDED');
    assert.equal(succeeded[0].body.data.attempt.result, 'delivered_full');
    assert.equal(succeeded[0].body.data.attempt.lines[0].deliveredBaseQuantity, '3.000000000000');

    const winnerKey = competing[0].response.status === 200 ? 'attempt-concurrent-a' : 'attempt-concurrent-b';
    const replay = await fetchJson(fetch(
      `${baseUrl}/api/logistics/driver/trips/${tripA}/assignments/${assignmentId}/attempts`,
      {
        method: 'POST',
        headers: deliveryHeaders(config, employeeA, winnerKey),
        body: payload,
      },
    ));
    assert.equal(replay.response.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.data.replayed, true);
    assert.equal(replay.body.data.attempt.id, succeeded[0].body.data.attempt.id);

    const crossDriver = await fetchJson(fetch(
      `${baseUrl}/api/logistics/driver/trips/${tripA}/assignments/${assignmentId}/attempts`,
      {
        method: 'POST',
        headers: deliveryHeaders(config, employeeB, 'attempt-cross-driver'),
        body: payload,
      },
    ));
    assert.equal(crossDriver.response.status, 404, JSON.stringify(crossDriver.body));
    assert.equal(crossDriver.body.error.code, 'DELIVERY_ASSIGNMENT_NOT_FOUND');

    const facts = await pool.query(
      `SELECT
         (SELECT count(*) FROM logistics.delivery_attempts WHERE installation_id = $1) AS attempts,
         (SELECT count(*) FROM logistics.delivery_attempt_lines WHERE installation_id = $1) AS lines,
         (SELECT count(*) FROM logistics.trip_events
           WHERE installation_id = $1 AND event_type = 'DELIVERY_ATTEMPT_RECORDED') AS trip_events,
         (SELECT count(*) FROM shared.core_audit_records
           WHERE installation_id = $1 AND action = 'logistics.delivery_attempt.record') AS audits,
         (SELECT count(*) FROM shared.core_outbox_events
           WHERE installation_id = $1 AND event_type = 'core.delivery_attempt.recorded') AS outbox,
         (SELECT count(*) FROM inventory.inventory_movements WHERE installation_id = $1) AS movements`,
      [installationId],
    );
    assert.equal(Number(facts.rows[0].attempts), 1);
    assert.equal(Number(facts.rows[0].lines), 1);
    assert.equal(Number(facts.rows[0].trip_events), 1);
    assert.equal(Number(facts.rows[0].audits), 1);
    assert.equal(Number(facts.rows[0].outbox), 1);
    assert.equal(Number(facts.rows[0].movements), movementCountBefore);

    await assert.rejects(
      pool.query(
        `UPDATE logistics.delivery_attempts
            SET note = 'tampered'
          WHERE installation_id = $1 AND assignment_id = $2`,
        [installationId, assignmentId],
      ),
      /delivery_attempts_are_immutable/,
    );
  } finally {
    if (server) await closeServer(server);
    await fixture.query("SET session_replication_role = 'origin'").catch(() => {});
    await fixture.query('ROLLBACK').catch(() => {});
    fixture.release();
    await closePool();
  }
});
