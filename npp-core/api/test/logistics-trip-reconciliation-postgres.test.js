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

function quoted(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

test('PostgreSQL reconciliation receives exact stock once and closes only at zero custody', async () => {
  const ids = Object.freeze({
    warehouse: randomUUID(),
    branch: randomUUID(),
    location: randomUUID(),
    unit: randomUUID(),
    product: randomUUID(),
    variant: randomUUID(),
    vehicle: randomUUID(),
    driver: randomUUID(),
    trip: randomUUID(),
    stop: randomUUID(),
    assignment: randomUUID(),
    deliveryOrder: randomUUID(),
    deliveryOrderLine: randomUUID(),
    inventoryIssue: randomUUID(),
    inventoryIssueLine: randomUUID(),
    dispatch: randomUUID(),
    dispatchItem: randomUUID(),
    outMovement: randomUUID(),
    outMovementLine: randomUUID(),
    attempt: randomUUID(),
  });
  const installationId = `trip-reconciliation-${randomUUID()}`;
  const actor = 'test:trip-reconciliation';
  const now = Date.now();
  const dispatchedAt = new Date(now - 10 * 60_000).toISOString();
  const attemptedAt = new Date(now - 5 * 60_000).toISOString();
  const receivedAt = new Date(now - 60_000).toISOString();
  const closedAt = new Date(now).toISOString();
  const config = loadConfig({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3098',
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
    await fixture.query("SET LOCAL session_replication_role = 'replica'");
    await fixture.query(`
      INSERT INTO shared.warehouses
        (id, installation_id, branch_id, code, name, warehouse_type, is_active, created_by, updated_by)
      VALUES (${quoted(ids.warehouse)}, ${quoted(installationId)}, ${quoted(ids.branch)}, 'WH-RECON', 'Kho đối soát', 'main', true, ${quoted(actor)}, ${quoted(actor)});

      INSERT INTO shared.warehouse_locations
        (id, installation_id, warehouse_id, code, name, location_type, is_active, created_by, updated_by)
      VALUES (${quoted(ids.location)}, ${quoted(installationId)}, ${quoted(ids.warehouse)}, 'A-01', 'Kệ đối soát', 'storage', true, ${quoted(actor)}, ${quoted(actor)});

      INSERT INTO shared.units_of_measure
        (id, installation_id, code, name, unit_kind, allows_fractional, is_active, created_by, updated_by)
      VALUES (${quoted(ids.unit)}, ${quoted(installationId)}, 'EA', 'Cái', 'COUNT', false, true, ${quoted(actor)}, ${quoted(actor)});

      INSERT INTO shared.product_variants
        (id, installation_id, product_id, sku, name, variant_kind, is_inventory_base,
         is_sellable, is_catalog_visible, is_active, unit_id, conversion_to_base,
         is_purchasable, created_by, updated_by)
      VALUES (${quoted(ids.variant)}, ${quoted(installationId)}, ${quoted(ids.product)}, 'SKU-RECON',
        'SKU đối soát', 'BASE', true, true, true, true, ${quoted(ids.unit)}, 1, true,
        ${quoted(actor)}, ${quoted(actor)});

      INSERT INTO logistics.vehicles
        (id, installation_id, code, license_plate, vehicle_type, operational_status,
         is_active, created_by, updated_by)
      VALUES (${quoted(ids.vehicle)}, ${quoted(installationId)}, 'XE-RECON', '51A-51515',
        'Xe tải', 'AVAILABLE', true, ${quoted(actor)}, ${quoted(actor)});

      INSERT INTO logistics.driver_profiles
        (id, installation_id, code, employee_id, name, is_active, created_by, updated_by)
      VALUES (${quoted(ids.driver)}, ${quoted(installationId)}, 'DRV-RECON', NULL,
        'Tài xế đối soát', true, ${quoted(actor)}, ${quoted(actor)});

      INSERT INTO logistics.delivery_trips
        (id, installation_id, trip_number, warehouse_id, vehicle_id, primary_driver_id,
         planned_start_at, status, revision, create_idempotency_key, create_payload_hash,
         planned_at, planned_by, locked_at, locked_by, dispatch_id,
         dispatch_idempotency_key, dispatch_payload_hash, handover_receiver_name,
         dispatched_at, dispatched_by, created_by, updated_by)
      VALUES (${quoted(ids.trip)}, ${quoted(installationId)}, 'TRIP-RECON', ${quoted(ids.warehouse)},
        ${quoted(ids.vehicle)}, ${quoted(ids.driver)}, ${quoted(dispatchedAt)}, 'dispatched', 1,
        'create-trip-recon', ${quoted('a'.repeat(64))}, ${quoted(dispatchedAt)}, ${quoted(actor)},
        ${quoted(dispatchedAt)}, ${quoted(actor)}, ${quoted(ids.dispatch)}, 'dispatch-trip-recon',
        ${quoted('b'.repeat(64))}, 'Tài xế đối soát', ${quoted(dispatchedAt)}, ${quoted(actor)},
        ${quoted(actor)}, ${quoted(actor)});

      INSERT INTO sales.delivery_orders
        (id, installation_id, delivery_order_number, delivery_order_number_allocation_id,
         sales_order_id, sales_order_version_id, customer_id, customer_address_id,
         warehouse_id, handover_mode, customer_code_snapshot, customer_name_snapshot,
         destination_snapshot, warehouse_code_snapshot, warehouse_name_snapshot,
         requested_delivery_date, collection_policy, status, revision,
         create_idempotency_key, create_payload_hash, confirmed_at, confirmed_by,
         created_by, updated_by)
      VALUES (${quoted(ids.deliveryOrder)}, ${quoted(installationId)}, 'DO-RECON', ${quoted(randomUUID())},
        ${quoted(randomUUID())}, ${quoted(randomUUID())}, ${quoted(randomUUID())}, ${quoted(randomUUID())},
        ${quoted(ids.warehouse)}, 'DELIVERY', 'KH-RECON', 'Khách đối soát',
        '{"line1":"12 Nguyễn Trãi"}'::jsonb, 'WH-RECON', 'Kho đối soát', CURRENT_DATE,
        'PREPAID', 'ready_to_dispatch', 1, 'create-do-recon', ${quoted('c'.repeat(64))},
        ${quoted(dispatchedAt)}, ${quoted(actor)}, ${quoted(actor)}, ${quoted(actor)});

      INSERT INTO sales.delivery_order_lines
        (id, installation_id, delivery_order_id, line_number, sales_order_id,
         sales_order_version_id, sales_order_line_id, fulfillment_demand_id,
         fulfillment_allocation_id, inventory_reservation_id, warehouse_id, location_id,
         base_variant_id, lot_id, sku_snapshot, item_name_snapshot, unit_code_snapshot,
         packed_base_quantity_snapshot, delivery_base_quantity, created_by)
      VALUES (${quoted(ids.deliveryOrderLine)}, ${quoted(installationId)}, ${quoted(ids.deliveryOrder)}, 1,
        ${quoted(randomUUID())}, ${quoted(randomUUID())}, ${quoted(randomUUID())}, ${quoted(randomUUID())},
        ${quoted(randomUUID())}, ${quoted(randomUUID())}, ${quoted(ids.warehouse)}, ${quoted(ids.location)},
        ${quoted(ids.variant)}, NULL, 'SKU-RECON', 'SKU đối soát', 'EA', 3, 3, ${quoted(actor)});

      INSERT INTO inventory.inventory_movements
        (id, installation_id, movement_type, source_domain, source_document_type,
         source_document_id, source_document_number, document_date, posted_at, posted_by,
         request_id, source_app, idempotency_key, payload_hash, reason_code, reason_note, metadata)
      VALUES (${quoted(ids.outMovement)}, ${quoted(installationId)}, 'SALES_DELIVERY_ISSUE', 'SALES',
        'DELIVERY_ORDER', ${quoted(ids.deliveryOrder)}, 'DO-RECON', CURRENT_DATE, ${quoted(dispatchedAt)},
        ${quoted(actor)}, 'request-out-recon', 'npp-core-api', 'movement-out-recon',
        ${quoted('d'.repeat(64))}, 'LOGISTICS_DISPATCH', 'Xuất hàng lên chuyến', '{}'::jsonb);

      INSERT INTO inventory.inventory_movement_lines
        (id, installation_id, movement_id, line_number, warehouse_id, location_id,
         source_variant_id, source_sku, source_unit_id, source_unit_code, source_quantity,
         conversion_to_base, base_variant_id, base_sku, direction, base_quantity_delta,
         source_line_reference, metadata)
      VALUES (${quoted(ids.outMovementLine)}, ${quoted(installationId)}, ${quoted(ids.outMovement)}, 1,
        ${quoted(ids.warehouse)}, ${quoted(ids.location)}, ${quoted(ids.variant)}, 'SKU-RECON',
        ${quoted(ids.unit)}, 'EA', 3, 1, ${quoted(ids.variant)}, 'SKU-RECON', 'OUT', -3,
        ${quoted(ids.deliveryOrderLine)}, '{}'::jsonb);

      INSERT INTO sales.delivery_order_inventory_issues
        (id, installation_id, delivery_order_id, issue_source_type, issue_source_id, status,
         inventory_movement_id, idempotency_key, payload_hash, posted_at, posted_by,
         created_by, updated_by)
      VALUES (${quoted(ids.inventoryIssue)}, ${quoted(installationId)}, ${quoted(ids.deliveryOrder)},
        'LOGISTICS_DISPATCH', ${quoted(ids.dispatch)}, 'POSTED', ${quoted(ids.outMovement)},
        'issue-recon', ${quoted('e'.repeat(64))}, ${quoted(dispatchedAt)}, ${quoted(actor)},
        ${quoted(actor)}, ${quoted(actor)});

      INSERT INTO sales.delivery_order_inventory_issue_lines
        (id, installation_id, issue_id, delivery_order_id, delivery_order_line_id,
         fulfillment_demand_id, fulfillment_allocation_id, inventory_reservation_id,
         inventory_movement_line_id, warehouse_id, location_id, base_variant_id, lot_id,
         issued_base_quantity, created_by)
      VALUES (${quoted(ids.inventoryIssueLine)}, ${quoted(installationId)}, ${quoted(ids.inventoryIssue)},
        ${quoted(ids.deliveryOrder)}, ${quoted(ids.deliveryOrderLine)}, ${quoted(randomUUID())},
        ${quoted(randomUUID())}, ${quoted(randomUUID())}, ${quoted(ids.outMovementLine)},
        ${quoted(ids.warehouse)}, ${quoted(ids.location)}, ${quoted(ids.variant)}, NULL, 3, ${quoted(actor)});

      INSERT INTO logistics.trip_stops
        (id, installation_id, trip_id, stop_sequence, customer_id, customer_address_id,
         address_snapshot, created_by, updated_by)
      VALUES (${quoted(ids.stop)}, ${quoted(installationId)}, ${quoted(ids.trip)}, 1,
        ${quoted(randomUUID())}, ${quoted(randomUUID())}, '{"line1":"12 Nguyễn Trãi"}'::jsonb,
        ${quoted(actor)}, ${quoted(actor)});

      INSERT INTO logistics.trip_order_assignments
        (id, installation_id, trip_id, trip_stop_id, delivery_order_id, assigned_at, assigned_by)
      VALUES (${quoted(ids.assignment)}, ${quoted(installationId)}, ${quoted(ids.trip)},
        ${quoted(ids.stop)}, ${quoted(ids.deliveryOrder)}, ${quoted(dispatchedAt)}, ${quoted(actor)});

      INSERT INTO logistics.trip_dispatch_items
        (id, installation_id, dispatch_id, trip_id, assignment_id, trip_stop_id,
         delivery_order_id, inventory_issue_id, inventory_movement_id, posted_at, created_by)
      VALUES (${quoted(ids.dispatchItem)}, ${quoted(installationId)}, ${quoted(ids.dispatch)},
        ${quoted(ids.trip)}, ${quoted(ids.assignment)}, ${quoted(ids.stop)}, ${quoted(ids.deliveryOrder)},
        ${quoted(ids.inventoryIssue)}, ${quoted(ids.outMovement)}, ${quoted(dispatchedAt)}, ${quoted(actor)});

      INSERT INTO logistics.delivery_attempts
        (id, installation_id, trip_id, trip_stop_id, assignment_id, delivery_order_id,
         dispatch_item_id, inventory_issue_id, driver_profile_id, result, attempted_at,
         reason_code, note, rescheduled_for, idempotency_key, payload_hash, actor_id,
         request_id, source_app, created_by)
      VALUES (${quoted(ids.attempt)}, ${quoted(installationId)}, ${quoted(ids.trip)}, ${quoted(ids.stop)},
        ${quoted(ids.assignment)}, ${quoted(ids.deliveryOrder)}, ${quoted(ids.dispatchItem)},
        ${quoted(ids.inventoryIssue)}, ${quoted(ids.driver)}, 'delivered_partial', ${quoted(attemptedAt)},
        NULL, 'Khách nhận một phần', NULL, 'attempt-recon', ${quoted('f'.repeat(64))},
        ${quoted(actor)}, 'request-attempt-recon', 'delivery-frontend', ${quoted(actor)});

      INSERT INTO logistics.delivery_attempt_lines
        (id, installation_id, attempt_id, delivery_order_line_id, inventory_issue_line_id,
         issued_base_quantity, delivered_base_quantity, created_by)
      VALUES (${quoted(randomUUID())}, ${quoted(installationId)}, ${quoted(ids.attempt)},
        ${quoted(ids.deliveryOrderLine)}, ${quoted(ids.inventoryIssueLine)}, 3, 1, ${quoted(actor)});
    `);
    await fixture.query("SET LOCAL session_replication_role = 'origin'");
    await fixture.query('COMMIT');

    server = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;
    const initial = await fetchJson(fetch(`${baseUrl}/api/logistics/trips/${ids.trip}/reconciliation`, {
      headers: headers(config),
    }));
    assert.equal(initial.response.status, 200, JSON.stringify(initial.body));
    assert.equal(initial.body.data.lines[0].outstandingBaseQuantity, '2.000000000000');
    assert.equal(initial.body.data.canClose, false);

    const prematureClose = await fetchJson(fetch(`${baseUrl}/api/logistics/trips/${ids.trip}/close`, {
      method: 'POST',
      headers: headers(config, 'close-premature'),
      body: JSON.stringify({ closedAt, note: 'Chưa đủ' }),
    }));
    assert.equal(prematureClose.response.status, 409, JSON.stringify(prematureClose.body));
    assert.equal(prematureClose.body.error.code, 'TRIP_CLOSE_UNRECONCILED_STOCK');

    const returnPayload = JSON.stringify({
      receivedAt,
      note: 'Kho đã đếm và nhận lại',
      lines: [{ inventoryIssueLineId: ids.inventoryIssueLine, returnedBaseQuantity: '2.000000000000' }],
    });
    const competing = await Promise.all([
      fetchJson(fetch(`${baseUrl}/api/logistics/trips/${ids.trip}/return-receipts`, {
        method: 'POST', headers: headers(config, 'return-concurrent-a'), body: returnPayload,
      })),
      fetchJson(fetch(`${baseUrl}/api/logistics/trips/${ids.trip}/return-receipts`, {
        method: 'POST', headers: headers(config, 'return-concurrent-b'), body: returnPayload,
      })),
    ]);
    const succeeded = competing.filter((entry) => entry.response.status === 200);
    const conflicted = competing.filter((entry) => entry.response.status === 409);
    assert.equal(succeeded.length, 1, JSON.stringify(competing.map((entry) => entry.body)));
    assert.equal(conflicted.length, 1, JSON.stringify(competing.map((entry) => entry.body)));
    assert.equal(conflicted[0].body.error.code, 'RETURN_QUANTITY_EXCEEDS_OUTSTANDING');

    const winnerKey = competing[0].response.status === 200 ? 'return-concurrent-a' : 'return-concurrent-b';
    const replay = await fetchJson(fetch(`${baseUrl}/api/logistics/trips/${ids.trip}/return-receipts`, {
      method: 'POST', headers: headers(config, winnerKey), body: returnPayload,
    }));
    assert.equal(replay.response.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.data.replayed, true);
    assert.equal(replay.body.data.receiptId, succeeded[0].body.data.receiptId);

    const afterReturn = await fetchJson(fetch(`${baseUrl}/api/logistics/trips/${ids.trip}/reconciliation`, {
      headers: headers(config),
    }));
    assert.equal(afterReturn.response.status, 200, JSON.stringify(afterReturn.body));
    assert.equal(afterReturn.body.data.lines[0].returnedBaseQuantity, '2.000000000000');
    assert.equal(afterReturn.body.data.lines[0].outstandingBaseQuantity, '0.000000000000');
    assert.equal(afterReturn.body.data.canClose, true);

    const facts = await pool.query(
      `SELECT
         (SELECT count(*) FROM logistics.trip_return_receipts WHERE installation_id = $1 AND status = 'POSTED') AS receipts,
         (SELECT count(*) FROM inventory.inventory_movements WHERE installation_id = $1 AND movement_type = 'LOGISTICS_TRIP_RETURN') AS return_movements,
         (SELECT count(*) FROM logistics.trip_events WHERE installation_id = $1 AND event_type = 'RETURN_RECEIPT_POSTED') AS return_events,
         (SELECT count(*) FROM shared.core_audit_records WHERE installation_id = $1 AND action = 'logistics.delivery_trip.return_receive') AS return_audits,
         (SELECT count(*) FROM shared.core_outbox_events WHERE installation_id = $1 AND event_type = 'core.delivery_trip.return_received') AS return_outbox,
         (SELECT bool_and(created_at > now() - interval '5 minutes' AND available_at > now() - interval '5 minutes')
            FROM shared.core_outbox_events WHERE installation_id = $1 AND event_type = 'core.delivery_trip.return_received') AS server_scheduled`,
      [installationId],
    );
    assert.equal(Number(facts.rows[0].receipts), 1);
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
           ON line.installation_id = movement.installation_id AND line.movement_id = movement.id
        WHERE movement.installation_id = $1 AND movement.movement_type = 'LOGISTICS_TRIP_RETURN'`,
      [installationId],
    );
    assert.deepEqual(returnLine.rows[0], {
      direction: 'IN',
      base_quantity_delta: '2.000000000000',
      warehouse_id: ids.warehouse,
      location_id: ids.location,
      base_variant_id: ids.variant,
      reversal_of_movement_id: null,
    });

    const close = await fetchJson(fetch(`${baseUrl}/api/logistics/trips/${ids.trip}/close`, {
      method: 'POST',
      headers: headers(config, 'close-reconciled'),
      body: JSON.stringify({ closedAt, note: 'Đã đối soát đủ' }),
    }));
    assert.equal(close.response.status, 200, JSON.stringify(close.body));
    assert.equal(close.body.data.trip.status, 'closed');

    const closeReplay = await fetchJson(fetch(`${baseUrl}/api/logistics/trips/${ids.trip}/close`, {
      method: 'POST',
      headers: headers(config, 'close-reconciled'),
      body: JSON.stringify({ closedAt, note: 'Đã đối soát đủ' }),
    }));
    assert.equal(closeReplay.response.status, 200, JSON.stringify(closeReplay.body));
    assert.equal(closeReplay.body.data.replayed, true);

    const closeFacts = await pool.query(
      `SELECT
         (SELECT count(*) FROM logistics.trip_events WHERE installation_id = $1 AND event_type = 'CLOSED') AS close_events,
         (SELECT count(*) FROM shared.core_audit_records WHERE installation_id = $1 AND action = 'logistics.delivery_trip.close') AS close_audits,
         (SELECT count(*) FROM shared.core_outbox_events WHERE installation_id = $1 AND event_type = 'core.delivery_trip.closed') AS close_outbox`,
      [installationId],
    );
    assert.equal(Number(closeFacts.rows[0].close_events), 1);
    assert.equal(Number(closeFacts.rows[0].close_audits), 1);
    assert.equal(Number(closeFacts.rows[0].close_outbox), 1);

    await assert.rejects(
      pool.query(
        `UPDATE logistics.trip_return_receipts SET note = 'tampered' WHERE installation_id = $1`,
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
