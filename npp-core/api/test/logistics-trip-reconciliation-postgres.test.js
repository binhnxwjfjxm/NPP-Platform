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

function headers(config, idempotencyKey = null) {
  return {
    Authorization: `Bearer ${config.backendApiToken}`,
    ...(idempotencyKey ? {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    } : {}),
  };
}

test('PostgreSQL reconciliation receives exact stock once and closes only at zero custody', async () => {
  const installationId = `trip-reconciliation-${randomUUID()}`;
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const locationId = randomUUID();
  const unitId = randomUUID();
  const productId = randomUUID();
  const variantId = randomUUID();
  const employeeId = randomUUID();
  const driverId = randomUUID();
  const vehicleId = randomUUID();
  const tripId = randomUUID();
  const stopId = randomUUID();
  const assignmentId = randomUUID();
  const deliveryOrderId = randomUUID();
  const deliveryOrderLineId = randomUUID();
  const inventoryIssueId = randomUUID();
  const inventoryIssueLineId = randomUUID();
  const dispatchItemId = randomUUID();
  const dispatchId = randomUUID();
  const outMovementId = randomUUID();
  const outMovementLineId = randomUUID();
  const attemptId = randomUUID();
  const fakeCustomerId = randomUUID();
  const fakeCustomerAddressId = randomUUID();
  const fakeSalesOrderId = randomUUID();
  const fakeSalesOrderVersionId = randomUUID();
  const fakeSalesOrderLineId = randomUUID();
  const fakeDemandId = randomUUID();
  const fakeAllocationId = randomUUID();
  const fakeReservationId = randomUUID();
  const actor = 'test:trip-reconciliation-fixture';
  const config = loadConfig({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3071',
    INSTALLATION_ID: installationId,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3005',
  });
  const pool = getPool(config);
  const fixture = await pool.connect();
  let server;
  try {
    await fixture.query('BEGIN');
    await fixture.query(
      `INSERT INTO shared.branches
        (id, installation_id, code, name, is_active, created_by, updated_by)
       VALUES ($1,$2,'BR-RECON','Chi nhánh đối soát',true,$3,$3)`,
      [branchId, installationId, actor],
    );
    await fixture.query(
      `INSERT INTO shared.warehouses
        (id, installation_id, branch_id, code, name, warehouse_type, is_active, created_by, updated_by)
       VALUES ($1,$2,$3,'WH-RECON','Kho đối soát','main',true,$4,$4)`,
      [warehouseId, installationId, branchId, actor],
    );
    await fixture.query(
      `INSERT INTO shared.warehouse_locations
        (id, installation_id, warehouse_id, code, name, location_type, is_active, created_by, updated_by)
       VALUES ($1,$2,$3,'A-01','Kệ đối soát','storage',true,$4,$4)`,
      [locationId, installationId, warehouseId, actor],
    );
    await fixture.query(
      `INSERT INTO shared.units_of_measure
        (id, installation_id, code, name, unit_kind, allows_fractional, is_active, created_by, updated_by)
       VALUES ($1,$2,'EA','Cái','COUNT',false,true,$3,$3)`,
      [unitId, installationId, actor],
    );
    await fixture.query(
      `INSERT INTO shared.products
        (id, installation_id, code, name, is_orderable, is_active, created_by, updated_by)
       VALUES ($1,$2,'PR-RECON','Sản phẩm đối soát',true,true,$3,$3)`,
      [productId, installationId, actor],
    );
    await fixture.query(
      `INSERT INTO shared.product_variants
        (id, installation_id, product_id, sku, name, variant_kind,
         is_inventory_base, is_sellable, is_catalog_visible, is_active,
         unit_id, conversion_to_base, is_purchasable, created_by, updated_by)
       VALUES ($1,$2,$3,'SKU-RECON','SKU đối soát','BASE',true,true,true,true,$4,1,true,$5,$5)`,
      [variantId, installationId, productId, unitId, actor],
    );
    await fixture.query(
      `INSERT INTO shared.employees
        (id, installation_id, code, full_name, is_active, created_by, updated_by)
       VALUES ($1,$2,'TX-RECON','Tài xế đối soát',true,$3,$3)`,
      [employeeId, installationId, actor],
    );
    await fixture.query(
      `INSERT INTO logistics.vehicles
        (id, installation_id, code, license_plate, vehicle_type, operational_status,
         is_active, created_by, updated_by)
       VALUES ($1,$2,'XE-RECON','51A-51515','Xe tải','AVAILABLE',true,$3,$3)`,
      [vehicleId, installationId, actor],
    );
    await fixture.query(
      `INSERT INTO logistics.driver_profiles
        (id, installation_id, code, employee_id, name, is_active, created_by, updated_by)
       VALUES ($1,$2,'DRV-RECON',$3,'Tài xế đối soát',true,$4,$4)`,
      [driverId, installationId, employeeId, actor],
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
         $1,$2,'TRIP-RECON',$3,$4,$5,'2026-08-05T00:30:00Z','dispatched',1,
         'create-trip-recon',$6,'2026-08-05T00:10:00Z',$7,'2026-08-05T00:20:00Z',$7,
         $8,'dispatch-trip-recon',$9,'Tài xế đối soát','2026-08-05T00:30:00Z',$7,$7,$7
       )`,
      [tripId, installationId, warehouseId, vehicleId, driverId, 'a'.repeat(64), actor, dispatchId, 'b'.repeat(64)],
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
         $1,$2,'DO-RECON',$3,$4,$5,$6,$7,$8,'DELIVERY','KH-RECON','Khách đối soát',
         '{"line1":"12 Nguyễn Trãi"}'::jsonb,'WH-RECON','Kho đối soát',
         '2026-08-05','PREPAID','ready_to_dispatch',1,
         'create-do-recon',$9,'2026-08-05T00:00:00Z',$10,$10,$10
       )`,
      [deliveryOrderId, installationId, randomUUID(), fakeSalesOrderId, fakeSalesOrderVersionId,
        fakeCustomerId, fakeCustomerAddressId, warehouseId, 'c'.repeat(64), actor],
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
         $1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,
         'SKU-RECON','SKU đối soát','EA',3.000000000000,3.000000000000,$13
       )`,
      [deliveryOrderLineId, installationId, deliveryOrderId, fakeSalesOrderId, fakeSalesOrderVersionId,
        fakeSalesOrderLineId, fakeDemandId, fakeAllocationId, fakeReservationId,
        warehouseId, locationId, variantId, actor],
    );
    await fixture.query(
      `INSERT INTO inventory.inventory_movements (
         id, installation_id, movement_type, source_domain, source_document_type,
         source_document_id, source_document_number, document_date, posted_at,
         posted_by, request_id, source_app, idempotency_key, payload_hash,
         reason_code, reason_note, metadata
       ) VALUES (
         $1,$2,'SALES_DELIVERY_ISSUE','SALES','DELIVERY_ORDER',$3,'DO-RECON',
         '2026-08-05','2026-08-05T00:30:00Z',$4,'request-out-recon','npp-core-api',
         'movement-out-recon',$5,'LOGISTICS_DISPATCH','Xuất hàng lên chuyến','{}'::jsonb
       )`,
      [outMovementId, installationId, deliveryOrderId, actor, 'd'.repeat(64)],
    );
    await fixture.query(
      `INSERT INTO inventory.inventory_movement_lines (
         id, installation_id, movement_id, line_number, warehouse_id, location_id,
         source_variant_id, source_sku, source_unit_id, source_unit_code,
         source_quantity, conversion_to_base, base_variant_id, base_sku,
         direction, base_quantity_delta, source_line_reference, metadata
       ) VALUES (
         $1,$2,$3,1,$4,$5,$6,'SKU-RECON',$7,'EA',3,1,$6,'SKU-RECON',
         'OUT',-3,$8,'{}'::jsonb
       )`,
      [outMovementLineId, installationId, outMovementId, warehouseId, locationId, variantId, unitId, deliveryOrderLineId],
    );
    await fixture.query(
      `INSERT INTO sales.delivery_order_inventory_issues (
         id, installation_id, delivery_order_id, issue_source_type, issue_source_id,
         status, inventory_movement_id, idempotency_key, payload_hash,
         posted_at, posted_by, created_by, updated_by
       ) VALUES (
         $1,$2,$3,'LOGISTICS_DISPATCH',$4,'POSTED',$5,
         'issue-recon',$6,'2026-08-05T00:30:00Z',$7,$7,$7
       )`,
      [inventoryIssueId, installationId, deliveryOrderId, dispatchId, outMovementId, 'e'.repeat(64), actor],
    );
    await fixture.query(
      `INSERT INTO sales.delivery_order_inventory_issue_lines (
         id, installation_id, issue_id, delivery_order_id, delivery_order_line_id,
         fulfillment_demand_id, fulfillment_allocation_id, inventory_reservation_id,
         inventory_movement_line_id, warehouse_id, location_id, base_variant_id, lot_id,
         issued_base_quantity, created_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,3.000000000000,$13
       )`,
      [inventoryIssueLineId, installationId, inventoryIssueId, deliveryOrderId, deliveryOrderLineId,
        fakeDemandId, fakeAllocationId, fakeReservationId, outMovementLineId,
        warehouseId, locationId, variantId, actor],
    );
    await fixture.query(
      `INSERT INTO logistics.trip_stops (
         id, installation_id, trip_id, stop_sequence,
         customer_id, customer_address_id, address_snapshot,
         created_by, updated_by
       ) VALUES ($1,$2,$3,1,$4,$5,'{"line1":"12 Nguyễn Trãi"}'::jsonb,$6,$6)`,
      [stopId, installationId, tripId, fakeCustomerId, fakeCustomerAddressId, actor],
    );
    await fixture.query(
      `INSERT INTO logistics.trip_order_assignments (
         id, installation_id, trip_id, trip_stop_id, delivery_order_id,
         assigned_at, assigned_by
       ) VALUES ($1,$2,$3,$4,$5,'2026-08-05T00:20:00Z',$6)`,
      [assignmentId, installationId, tripId, stopId, deliveryOrderId, actor],
    );
    await fixture.query(
      `INSERT INTO logistics.trip_dispatch_items (
         id, installation_id, dispatch_id, trip_id, assignment_id, trip_stop_id,
         delivery_order_id, inventory_issue_id, inventory_movement_id,
         posted_at, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'2026-08-05T00:30:00Z',$10)`,
      [dispatchItemId, installationId, dispatchId, tripId, assignmentId, stopId,
        deliveryOrderId, inventoryIssueId, outMovementId, actor],
    );
    await fixture.query(
      `INSERT INTO logistics.delivery_attempts (
         id, installation_id, trip_id, trip_stop_id, assignment_id,
         delivery_order_id, dispatch_item_id, inventory_issue_id, driver_profile_id,
         result, attempted_at, reason_code, note, rescheduled_for,
         idempotency_key, payload_hash, actor_id, request_id, source_app, created_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,'delivered_partial','2026-08-05T01:00:00Z',
         NULL,'Khách nhận một phần',NULL,'attempt-recon',$10,$11,'request-attempt-recon',
         'delivery-frontend',$11
       )`,
      [attemptId, installationId, tripId, stopId, assignmentId, deliveryOrderId,
        dispatchItemId, inventoryIssueId, driverId, 'f'.repeat(64), actor],
    );
    await fixture.query(
      `INSERT INTO logistics.delivery_attempt_lines (
         id, installation_id, attempt_id, delivery_order_line_id,
         inventory_issue_line_id, issued_base_quantity, delivered_base_quantity, created_by
       ) VALUES ($1,$2,$3,$4,$5,3.000000000000,1.000000000000,$6)`,
      [randomUUID(), installationId, attemptId, deliveryOrderLineId, inventoryIssueLineId, actor],
    );
    await fixture.query("SET LOCAL session_replication_role = 'origin'");
    await fixture.query('COMMIT');

    server = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;

    const initial = await fetchJson(fetch(`${baseUrl}/api/logistics/trips/${tripId}/reconciliation`, {
      headers: headers(config),
    }));
    assert.equal(initial.response.status, 200, JSON.stringify(initial.body));
    assert.equal(initial.body.data.lines[0].issuedBaseQuantity, '3.000000000000');
    assert.equal(initial.body.data.lines[0].deliveredBaseQuantity, '1.000000000000');
    assert.equal(initial.body.data.lines[0].returnedBaseQuantity, '0.000000000000');
    assert.equal(initial.body.data.lines[0].outstandingBaseQuantity, '2.000000000000');
    assert.equal(initial.body.data.canClose, false);

    const prematureClose = await fetchJson(fetch(`${baseUrl}/api/logistics/trips/${tripId}/close`, {
      method: 'POST',
      headers: headers(config, 'close-premature'),
      body: JSON.stringify({ closedAt: '2026-08-05T02:00:00Z', note: 'Chưa đủ' }),
    }));
    assert.equal(prematureClose.response.status, 409, JSON.stringify(prematureClose.body));
    assert.equal(prematureClose.body.error.code, 'TRIP_CLOSE_UNRECONCILED_STOCK');

    const returnPayload = JSON.stringify({
      receivedAt: '2000-01-01T00:00:00.000Z',
      note: 'Kho đã đếm và nhận lại',
      lines: [{ inventoryIssueLineId, returnedBaseQuantity: '2.000000000000' }],
    });
    const competing = await Promise.all([
      fetchJson(fetch(`${baseUrl}/api/logistics/trips/${tripId}/return-receipts`, {
        method: 'POST', headers: headers(config, 'return-concurrent-a'), body: returnPayload,
      })),
      fetchJson(fetch(`${baseUrl}/api/logistics/trips/${tripId}/return-receipts`, {
        method: 'POST', headers: headers(config, 'return-concurrent-b'), body: returnPayload,
      })),
    ]);
    const succeeded = competing.filter((entry) => entry.response.status === 200);
    const conflicted = competing.filter((entry) => entry.response.status === 409);
    assert.equal(succeeded.length, 1, JSON.stringify(competing.map((entry) => entry.body)));
    assert.equal(conflicted.length, 1, JSON.stringify(competing.map((entry) => entry.body)));
    assert.equal(conflicted[0].body.error.code, 'RETURN_QUANTITY_EXCEEDS_OUTSTANDING');
    assert.equal(succeeded[0].body.data.replayed, false);

    const winnerKey = competing[0].response.status === 200 ? 'return-concurrent-a' : 'return-concurrent-b';
    const replay = await fetchJson(fetch(`${baseUrl}/api/logistics/trips/${tripId}/return-receipts`, {
      method: 'POST', headers: headers(config, winnerKey), body: returnPayload,
    }));
    assert.equal(replay.response.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.data.replayed, true);
    assert.equal(replay.body.data.receiptId, succeeded[0].body.data.receiptId);

    const afterReturn = await fetchJson(fetch(`${baseUrl}/api/logistics/trips/${tripId}/reconciliation`, {
      headers: headers(config),
    }));
    assert.equal(afterReturn.response.status, 200, JSON.stringify(afterReturn.body));
    assert.equal(afterReturn.body.data.lines[0].returnedBaseQuantity, '2.000000000000');
    assert.equal(afterReturn.body.data.lines[0].outstandingBaseQuantity, '0.000000000000');
    assert.equal(afterReturn.body.data.canClose, true);

    const facts = await pool.query(
      `SELECT
         (SELECT count(*) FROM logistics.trip_return_receipts WHERE installation_id = $1 AND status = 'POSTED') AS receipts,
         (SELECT count(*) FROM logistics.trip_return_receipt_lines WHERE installation_id = $1) AS receipt_lines,
         (SELECT count(*) FROM inventory.inventory_movements WHERE installation_id = $1) AS movements,
         (SELECT count(*) FROM inventory.inventory_movements
           WHERE installation_id = $1 AND movement_type = 'LOGISTICS_TRIP_RETURN' AND source_domain = 'LOGISTICS') AS return_movements,
         (SELECT count(*) FROM logistics.trip_events
           WHERE installation_id = $1 AND event_type = 'RETURN_RECEIPT_POSTED') AS return_events,
         (SELECT count(*) FROM shared.core_audit_records
           WHERE installation_id = $1 AND action = 'logistics.delivery_trip.return_receive') AS return_audits,
         (SELECT count(*) FROM shared.core_outbox_events
           WHERE installation_id = $1 AND event_type = 'core.delivery_trip.return_received') AS return_outbox,
         (SELECT min(created_at) > '2025-01-01'::timestamptz FROM shared.core_outbox_events
           WHERE installation_id = $1 AND event_type = 'core.delivery_trip.return_received') AS server_scheduled`,
      [installationId],
    );
    assert.equal(Number(facts.rows[0].receipts), 1);
    assert.equal(Number(facts.rows[0].receipt_lines), 1);
    assert.equal(Number(facts.rows[0].movements), 2);
    assert.equal(Number(facts.rows[0].return_movements), 1);
    assert.equal(Number(facts.rows[0].return_events), 1);
    assert.equal(Number(facts.rows[0].return_audits), 1);
    assert.equal(Number(facts.rows[0].return_outbox), 1);
    assert.equal(facts.rows[0].server_scheduled, true);

    const returnLine = await pool.query(
      `SELECT line.direction, line.base_quantity_delta::text, line.warehouse_id,
              line.location_id, line.base_variant_id, movement.reversal_of_movement_id
         FROM inventory.inventory_movements movement
         JOIN inventory.inventory_movement_lines line
           ON line.installation_id = movement.installation_id
          AND line.movement_id = movement.id
        WHERE movement.installation_id = $1
          AND movement.movement_type = 'LOGISTICS_TRIP_RETURN'`,
      [installationId],
    );
    assert.equal(returnLine.rows[0].direction, 'IN');
    assert.equal(returnLine.rows[0].base_quantity_delta, '2.000000000000');
    assert.equal(returnLine.rows[0].warehouse_id, warehouseId);
    assert.equal(returnLine.rows[0].location_id, locationId);
    assert.equal(returnLine.rows[0].base_variant_id, variantId);
    assert.equal(returnLine.rows[0].reversal_of_movement_id, null);

    const close = await fetchJson(fetch(`${baseUrl}/api/logistics/trips/${tripId}/close`, {
      method: 'POST',
      headers: headers(config, 'close-reconciled'),
      body: JSON.stringify({ closedAt: '2000-01-01T01:00:00.000Z', note: 'Đã đối soát đủ' }),
    }));
    assert.equal(close.response.status, 200, JSON.stringify(close.body));
    assert.equal(close.body.data.trip.status, 'closed');
    assert.equal(close.body.data.replayed, false);

    const closeReplay = await fetchJson(fetch(`${baseUrl}/api/logistics/trips/${tripId}/close`, {
      method: 'POST',
      headers: headers(config, 'close-reconciled'),
      body: JSON.stringify({ closedAt: '2000-01-01T01:00:00.000Z', note: 'Đã đối soát đủ' }),
    }));
    assert.equal(closeReplay.response.status, 200, JSON.stringify(closeReplay.body));
    assert.equal(closeReplay.body.data.replayed, true);

    const closeFacts = await pool.query(
      `SELECT
         (SELECT count(*) FROM logistics.trip_events
           WHERE installation_id = $1 AND event_type = 'CLOSED') AS close_events,
         (SELECT count(*) FROM shared.core_audit_records
           WHERE installation_id = $1 AND action = 'logistics.delivery_trip.close') AS close_audits,
         (SELECT count(*) FROM shared.core_outbox_events
           WHERE installation_id = $1 AND event_type = 'core.delivery_trip.closed') AS close_outbox,
         (SELECT min(created_at) > '2025-01-01'::timestamptz FROM shared.core_outbox_events
           WHERE installation_id = $1 AND event_type = 'core.delivery_trip.closed') AS server_scheduled`,
      [installationId],
    );
    assert.equal(Number(closeFacts.rows[0].close_events), 1);
    assert.equal(Number(closeFacts.rows[0].close_audits), 1);
    assert.equal(Number(closeFacts.rows[0].close_outbox), 1);
    assert.equal(closeFacts.rows[0].server_scheduled, true);

    await assert.rejects(
      pool.query(
        `UPDATE logistics.trip_return_receipts
            SET note = 'tampered'
          WHERE installation_id = $1`,
        [installationId],
      ),
      /logistics_trip_return_receipt_requires_service_context|logistics_trip_return_receipt_immutable/,
    );
  } finally {
    if (server) await closeServer(server);
    await fixture.query("SET session_replication_role = 'origin'").catch(() => {});
    await fixture.query('ROLLBACK').catch(() => {});
    fixture.release();
    await closePool();
  }
});
