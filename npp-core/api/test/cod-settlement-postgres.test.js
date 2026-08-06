import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { closePool, getPool } from '../src/db/pool.js';

function q(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

test('PostgreSQL COD custody and reconciliation projections are append-only', async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    INSTALLATION_ID: `cod-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3005',
  });
  const pool = getPool(config);
  const client = await pool.connect();
  const ids = Object.freeze({
    warehouse: randomUUID(), trip: randomUUID(), stop: randomUUID(), assignment: randomUUID(),
    attempt: randomUUID(), deliveryOrder: randomUUID(), customer: randomUUID(), receivable: randomUUID(),
    payment: randomUUID(), driver: randomUUID(), collection: randomUUID(), handover: randomUUID(),
    line: randomUUID(), acceptance: randomUUID(), handoverReversal: randomUUID(), acceptanceReversal: randomUUID(),
  });
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL session_replication_role = 'replica'");
    await client.query(`
      INSERT INTO accounting.cod_collections (
        id, installation_id, warehouse_id, trip_id, trip_stop_id, assignment_id,
        delivery_attempt_id, delivery_order_id, customer_id, source_receivable_document_id,
        payment_document_id, collection_method, collection_status, currency_code,
        expected_amount, received_amount, collected_at, driver_profile_id,
        idempotency_key, payload_hash, actor_id, request_id, source_app, created_by
      ) VALUES (
        ${q(ids.collection)}, ${q(config.installationId)}, ${q(ids.warehouse)}, ${q(ids.trip)}, ${q(ids.stop)}, ${q(ids.assignment)},
        ${q(ids.attempt)}, ${q(ids.deliveryOrder)}, ${q(ids.customer)}, ${q(ids.receivable)},
        ${q(ids.payment)}, 'CASH', 'collected_full', 'VND', 100, 100, now(), ${q(ids.driver)},
        'cod-test-collection', repeat('a',64), 'test:actor', 'test:request', 'test', 'test:actor'
      );
      INSERT INTO accounting.cod_cash_handovers (
        id, installation_id, warehouse_id, trip_id, driver_profile_id,
        expected_total, handed_over_total, unattributed_excess_amount, difference_amount, reason,
        handed_over_at, idempotency_key, payload_hash, actor_id, request_id, source_app, created_by
      ) VALUES (
        ${q(ids.handover)}, ${q(config.installationId)}, ${q(ids.warehouse)}, ${q(ids.trip)}, ${q(ids.driver)},
        100, 60, 0, -40, 'Thiếu 40 khi bàn giao', now(), 'cod-test-handover', repeat('b',64),
        'test:actor', 'test:request', 'test', 'test:actor'
      );
      INSERT INTO accounting.cod_cash_handover_lines (
        id, installation_id, handover_id, collection_id, expected_amount, handed_over_amount, created_by
      ) VALUES (${q(ids.line)}, ${q(config.installationId)}, ${q(ids.handover)}, ${q(ids.collection)}, 100, 60, 'test:actor');
      INSERT INTO accounting.cod_cash_acceptances (
        id, installation_id, handover_id, accepted_amount, difference_amount,
        reconciliation_status, reason, accepted_at, idempotency_key, payload_hash,
        actor_id, request_id, source_app, created_by
      ) VALUES (
        ${q(ids.acceptance)}, ${q(config.installationId)}, ${q(ids.handover)}, 55, -5,
        'discrepancy', 'Thiếu 5 khi kiểm đếm', now(), 'cod-test-acceptance', repeat('c',64),
        'test:accountant', 'test:accept', 'core-web', 'test:accountant'
      );
    `);
    await client.query("SET LOCAL session_replication_role = 'origin'");

    const custody = await client.query(
      'SELECT handed_over_amount::text, custody_remaining_amount::text FROM accounting.cod_collection_custody WHERE installation_id=$1 AND collection_id=$2',
      [config.installationId, ids.collection],
    );
    assert.deepEqual(custody.rows[0], { handed_over_amount: '60.000000', custody_remaining_amount: '40.000000' });

    const projection = await client.query(
      'SELECT projection_status, acceptance_difference_amount::text FROM accounting.cod_handover_projection WHERE installation_id=$1 AND id=$2',
      [config.installationId, ids.handover],
    );
    assert.deepEqual(projection.rows[0], { projection_status: 'discrepancy', acceptance_difference_amount: '-5.000000' });

    await client.query('SAVEPOINT before_append_only_check');
    await assert.rejects(
      client.query('UPDATE accounting.cod_collections SET note=$1 WHERE installation_id=$2 AND id=$3', ['mutated', config.installationId, ids.collection]),
      /cod_history_write_requires_service_context|cod_history_is_append_only/,
    );
    await client.query('ROLLBACK TO SAVEPOINT before_append_only_check');
    await client.query("SELECT set_config('npp.cod_write_context','cod_service',true)");
    await client.query(`
      INSERT INTO accounting.cod_cash_acceptance_reversals (
        id, installation_id, acceptance_id, reason, actor_id, request_id, source_app, reversed_at
      ) VALUES (${q(ids.acceptanceReversal)}, ${q(config.installationId)}, ${q(ids.acceptance)}, 'Đảo kiểm đếm', 'test:accountant', 'test:reverse', 'core-web', now());
      INSERT INTO accounting.cod_cash_handover_reversals (
        id, installation_id, handover_id, reason, actor_id, request_id, source_app, reversed_at
      ) VALUES (${q(ids.handoverReversal)}, ${q(config.installationId)}, ${q(ids.handover)}, 'Lập lại bàn giao', 'test:accountant', 'test:reverse2', 'core-web', now());
    `);
    const reversed = await client.query(
      'SELECT projection_status FROM accounting.cod_handover_projection WHERE installation_id=$1 AND id=$2',
      [config.installationId, ids.handover],
    );
    assert.equal(reversed.rows[0].projection_status, 'reversed');
    const restoredCustody = await client.query(
      'SELECT custody_remaining_amount::text FROM accounting.cod_collection_custody WHERE installation_id=$1 AND collection_id=$2',
      [config.installationId, ids.collection],
    );
    assert.equal(restoredCustody.rows[0].custody_remaining_amount, '100.000000');
    await client.query('ROLLBACK');
  } finally {
    client.release();
    await closePool();
  }
});
