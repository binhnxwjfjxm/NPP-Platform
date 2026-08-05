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

async function deleteInstallationFixtures(pool, installationId) {
  const cleanup = await pool.connect();
  try {
    await cleanup.query('BEGIN');
    await cleanup.query("SET LOCAL session_replication_role = 'replica'");
    for (const table of [
      'logistics.delivery_attempt_proofs',
      'logistics.trip_events',
      'shared.core_audit_records',
      'shared.core_outbox_events',
      'logistics.delivery_attempts',
      'logistics.trip_order_assignments',
      'logistics.trip_stops',
      'logistics.delivery_trips',
      'sales.delivery_orders',
      'logistics.driver_profiles',
      'logistics.vehicles',
      'shared.employees',
      'shared.warehouses',
      'shared.branches',
    ]) {
      await cleanup.query(`DELETE FROM ${table} WHERE installation_id = $1`, [installationId]);
    }
    await cleanup.query('COMMIT');
  } catch (error) {
    await cleanup.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    cleanup.release();
  }
}

test('PostgreSQL POD is optional, driver-scoped, immutable and idempotent', async () => {
  const installationId = `delivery-pod-${randomUUID()}`;
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const employeeA = randomUUID();
  const employeeB = randomUUID();
  const driverA = randomUUID();
  const driverB = randomUUID();
  const vehicleId = randomUUID();
  const tripId = randomUUID();
  const stopId = randomUUID();
  const assignmentId = randomUUID();
  const deliveryOrderId = randomUUID();
  const attemptId = randomUUID();
  const actor = 'test:pod-fixture';
  const config = loadConfig({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3072',
    INSTALLATION_ID: installationId,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    DELIVERY_FRONTEND_API_TOKEN: 'delivery-token-0123456789abcdef',
    DELIVERY_FRONTEND_ACTOR_ID: 'service:delivery-pod-test',
    DELIVERY_FRONTEND_WAREHOUSE_IDS: warehouseId,
    CORS_ORIGINS: 'http://127.0.0.1:3005',
    R2_ENABLED: 'false',
  });
  const pool = getPool(config);
  const fixture = await pool.connect();
  let server;
  try {
    await fixture.query('BEGIN');
    await fixture.query(
      `INSERT INTO shared.branches
        (id, installation_id, code, name, is_active, created_by, updated_by)
       VALUES ($1,$2,'BR-POD','Chi nhánh POD',true,$3,$3)`,
      [branchId, installationId, actor],
    );
    await fixture.query(
      `INSERT INTO shared.warehouses
        (id, installation_id, branch_id, code, name, warehouse_type, is_active, created_by, updated_by)
       VALUES ($1,$2,$3,'WH-POD','Kho POD','main',true,$4,$4)`,
      [warehouseId, installationId, branchId, actor],
    );
    await fixture.query(
      `INSERT INTO shared.employees
        (id, installation_id, code, full_name, is_active, created_by, updated_by)
       VALUES
        ($1,$3,'PODA','Tài xế POD A',true,$4,$4),
        ($2,$3,'PODB','Tài xế POD B',true,$4,$4)`,
      [employeeA, employeeB, installationId, actor],
    );
    await fixture.query(
      `INSERT INTO logistics.vehicles
        (id, installation_id, code, license_plate, vehicle_type, operational_status,
         is_active, created_by, updated_by)
       VALUES ($1,$2,'XE-POD','51A-00052','Xe tải','AVAILABLE',true,$3,$3)`,
      [vehicleId, installationId, actor],
    );
    await fixture.query(
      `INSERT INTO logistics.driver_profiles
        (id, installation_id, code, employee_id, name, is_active, created_by, updated_by)
       VALUES
        ($1,$3,'DRV-POD-A',$4,'Tài xế POD A',true,$6,$6),
        ($2,$3,'DRV-POD-B',$5,'Tài xế POD B',true,$6,$6)`,
      [driverA, driverB, installationId, employeeA, employeeB, actor],
    );

    await fixture.query("SET LOCAL session_replication_role = 'replica'");
    await fixture.query(
      `INSERT INTO logistics.delivery_trips (
         id, installation_id, trip_number, warehouse_id, vehicle_id, primary_driver_id,
         planned_start_at, status, revision, create_idempotency_key, create_payload_hash,
         planned_at, planned_by, locked_at, locked_by,
         dispatch_id, dispatch_idempotency_key, dispatch_payload_hash,
         handover_receiver_name, dispatched_at, dispatched_by,
         created_by, updated_by
       ) VALUES (
         $1,$2,'TRIP-POD',$3,$4,$5,'2026-08-05T01:00:00Z','dispatched',1,
         'create-trip-pod',$6,'2026-08-05T00:30:00Z',$7,'2026-08-05T00:45:00Z',$7,
         $8,'dispatch-trip-pod',$9,'Tài xế POD A','2026-08-05T01:00:00Z',$7,$7,$7
       )`,
      [tripId, installationId, warehouseId, vehicleId, driverA, 'a'.repeat(64), actor, randomUUID(), 'b'.repeat(64)],
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
         $1,$2,'DO-POD-1',$3,$4,$5,$6,$7,$8,'DELIVERY','KH-POD','Khách POD',
         '{"line1":"12 Nguyễn Trãi"}'::jsonb,'WH-POD','Kho POD',
         '2026-08-05','PREPAID','ready_to_dispatch',1,
         'create-do-pod',$9,'2026-08-05T00:20:00Z',$10,$10,$10
       )`,
      [
        deliveryOrderId,
        installationId,
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID(),
        warehouseId,
        'c'.repeat(64),
        actor,
      ],
    );
    await fixture.query(
      `INSERT INTO logistics.trip_stops (
         id, installation_id, trip_id, stop_sequence,
         customer_id, customer_address_id, address_snapshot,
         created_by, updated_by
       ) VALUES ($1,$2,$3,1,$4,$5,'{"line1":"12 Nguyễn Trãi"}'::jsonb,$6,$6)`,
      [stopId, installationId, tripId, randomUUID(), randomUUID(), actor],
    );
    await fixture.query(
      `INSERT INTO logistics.trip_order_assignments (
         id, installation_id, trip_id, trip_stop_id, delivery_order_id,
         assigned_at, assigned_by
       ) VALUES ($1,$2,$3,$4,$5,'2026-08-05T00:40:00Z',$6)`,
      [assignmentId, installationId, tripId, stopId, deliveryOrderId, actor],
    );
    await fixture.query(
      `INSERT INTO logistics.delivery_attempts (
         id, installation_id, trip_id, trip_stop_id, assignment_id,
         delivery_order_id, dispatch_item_id, inventory_issue_id,
         driver_profile_id, result, attempted_at, reason_code, note,
         rescheduled_for, idempotency_key, payload_hash,
         actor_id, request_id, source_app, created_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,'delivered_full','2026-08-05T02:00:00Z',NULL,
         'Đã giao đủ',NULL,'attempt-pod-fixture',$10,$11,'req-pod-fixture','delivery-web',$11
       )`,
      [
        attemptId,
        installationId,
        tripId,
        stopId,
        assignmentId,
        deliveryOrderId,
        randomUUID(),
        randomUUID(),
        driverA,
        'd'.repeat(64),
        actor,
      ],
    );
    await fixture.query("SET LOCAL session_replication_role = 'origin'");
    await fixture.query('COMMIT');

    const before = await pool.query(
      'SELECT count(*) FROM logistics.delivery_attempt_proofs WHERE installation_id = $1',
      [installationId],
    );
    assert.equal(Number(before.rows[0].count), 0, 'delivery attempt is valid without any POD');

    server = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;
    const endpoint = `${baseUrl}/api/logistics/driver/trips/${tripId}`
      + `/assignments/${assignmentId}/attempts/${attemptId}/pod`;
    const payload = JSON.stringify({
      podType: 'manual_confirm',
      capturedAt: new Date().toISOString(),
      receiverName: 'Chị Lan',
      note: 'Khách đã nhận hàng tại kho.',
    });

    const missingKey = await fetchJson(fetch(endpoint, {
      method: 'POST',
      headers: deliveryHeaders(config, employeeA),
      body: payload,
    }));
    assert.equal(missingKey.response.status, 400, JSON.stringify(missingKey.body));
    assert.equal(missingKey.body.error.code, 'MISSING_IDEMPOTENCY_KEY');

    const competing = await Promise.all([
      fetchJson(fetch(endpoint, {
        method: 'POST',
        headers: deliveryHeaders(config, employeeA, 'pod-same-request'),
        body: payload,
      })),
      fetchJson(fetch(endpoint, {
        method: 'POST',
        headers: deliveryHeaders(config, employeeA, 'pod-same-request'),
        body: payload,
      })),
    ]);
    assert.deepEqual(competing.map((entry) => entry.response.status), [200, 200]);
    assert.equal(competing.filter((entry) => entry.body.data.replayed === false).length, 1);
    assert.equal(competing.filter((entry) => entry.body.data.replayed === true).length, 1);
    assert.equal(competing[0].body.data.proof.id, competing[1].body.data.proof.id);
    assert.equal(competing[0].body.data.proof.file, null);

    const mismatch = await fetchJson(fetch(endpoint, {
      method: 'POST',
      headers: deliveryHeaders(config, employeeA, 'pod-same-request'),
      body: JSON.stringify({
        podType: 'manual_confirm',
        capturedAt: JSON.parse(payload).capturedAt,
        receiverName: 'Người khác',
        note: 'Payload khác.',
      }),
    }));
    assert.equal(mismatch.response.status, 409, JSON.stringify(mismatch.body));
    assert.equal(mismatch.body.error.code, 'IDEMPOTENCY_PAYLOAD_MISMATCH');

    const crossDriver = await fetchJson(fetch(endpoint, {
      method: 'POST',
      headers: deliveryHeaders(config, employeeB, 'pod-cross-driver'),
      body: payload,
    }));
    assert.equal(crossDriver.response.status, 404, JSON.stringify(crossDriver.body));
    assert.equal(crossDriver.body.error.code, 'DELIVERY_ATTEMPT_NOT_FOUND');

    const unavailablePhoto = await fetchJson(fetch(endpoint, {
      method: 'POST',
      headers: deliveryHeaders(config, employeeA, 'pod-photo-storage-disabled'),
      body: JSON.stringify({
        podType: 'photo',
        capturedAt: new Date().toISOString(),
        fileName: 'proof.jpg',
        contentType: 'image/jpeg',
        contentBase64: Buffer.from('photo').toString('base64'),
      }),
    }));
    assert.equal(unavailablePhoto.response.status, 503, JSON.stringify(unavailablePhoto.body));
    assert.equal(unavailablePhoto.body.error.code, 'POD_STORAGE_UNAVAILABLE');

    const listed = await fetchJson(fetch(endpoint, {
      headers: deliveryHeaders(config, employeeA),
    }));
    assert.equal(listed.response.status, 200, JSON.stringify(listed.body));
    assert.equal(listed.body.data.proofs.length, 1);
    assert.equal(listed.body.data.proofs[0].receiverName, 'Chị Lan');

    const facts = await pool.query(
      `SELECT
         (SELECT count(*) FROM logistics.delivery_attempt_proofs
           WHERE installation_id = $1) AS proofs,
         (SELECT count(*) FROM logistics.trip_events
           WHERE installation_id = $1 AND event_type = 'POD_ATTACHED') AS trip_events,
         (SELECT count(*) FROM shared.core_audit_records
           WHERE installation_id = $1 AND action = 'logistics.delivery_attempt.pod_attach') AS audits,
         (SELECT count(*) FROM shared.core_outbox_events
           WHERE installation_id = $1 AND event_type = 'core.delivery_attempt.pod_attached') AS outbox`,
      [installationId],
    );
    assert.equal(Number(facts.rows[0].proofs), 1);
    assert.equal(Number(facts.rows[0].trip_events), 1);
    assert.equal(Number(facts.rows[0].audits), 1);
    assert.equal(Number(facts.rows[0].outbox), 1);

    await assert.rejects(
      pool.query(
        `UPDATE logistics.delivery_attempt_proofs
            SET note = 'tampered'
          WHERE installation_id = $1 AND delivery_attempt_id = $2`,
        [installationId, attemptId],
      ),
      /delivery_attempt_proofs_are_immutable/,
    );
  } finally {
    if (server) await closeServer(server);
    await fixture.query("SET session_replication_role = 'origin'").catch(() => {});
    await fixture.query('ROLLBACK').catch(() => {});
    fixture.release();
    await deleteInstallationFixtures(pool, installationId).catch(() => {});
    await closePool();
  }
});
