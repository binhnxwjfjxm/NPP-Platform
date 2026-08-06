import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { closePool, getPool } from '../src/db/pool.js';

function q(value) { return `'${String(value).replaceAll("'", "''")}'`; }

test('PostgreSQL Phase 6F views reconcile ledger and allocation projections', async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    INSTALLATION_ID: `phase6f-${randomUUID()}`,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3005',
  });
  const pool = getPool(config);
  const client = await pool.connect();
  const ids = Object.freeze({
    document: randomUUID(), customer: randomUUID(), warehouse: randomUUID(), salesOrder: randomUUID(),
    salesVersion: randomUUID(), deliveryOrder: randomUUID(), source: randomUUID(), ledger: randomUUID(),
  });
  try {
    const views = await client.query(`
      SELECT viewname FROM pg_views
       WHERE schemaname='reporting' AND viewname LIKE 'phase6f_%'
       ORDER BY viewname
    `);
    assert.deepEqual(views.rows.map((row) => row.viewname), [
      'phase6f_closeout_anomalies',
      'phase6f_cod_collection_reconciliation',
      'phase6f_cod_handover_reconciliation',
      'phase6f_customer_balance_reconciliation',
      'phase6f_document_reconciliation',
      'phase6f_order_status_projection',
    ]);

    await client.query('BEGIN');
    await client.query("SET LOCAL session_replication_role = 'replica'");
    await client.query(`
      INSERT INTO accounting.receivable_documents (
        id, installation_id, customer_id, warehouse_id, sales_order_id, sales_order_version_id,
        delivery_order_id, direction, document_type, source_document_type, source_document_id,
        source_document_number, source_document_date, customer_code_snapshot, customer_name_snapshot,
        warehouse_code_snapshot, warehouse_name_snapshot, collection_policy, currency_code,
        original_amount, allocated_amount, remaining_amount, status, posted_at, posted_by,
        created_by, updated_by
      ) VALUES (
        ${q(ids.document)}, ${q(config.installationId)}, ${q(ids.customer)}, ${q(ids.warehouse)},
        ${q(ids.salesOrder)}, ${q(ids.salesVersion)}, ${q(ids.deliveryOrder)}, 'DEBIT', 'SALE_DELIVERY',
        'DELIVERY_ATTEMPT', ${q(ids.source)}, 'DO-TEST-001', DATE '2026-08-06',
        'KH-TEST', 'Khách thử', 'KHO-TEST', 'Kho thử', 'COLLECT_AFTER_DELIVERY', 'VND',
        100, 0, 100, 'open', now(), 'test:actor', 'test:actor', 'test:actor'
      );
      INSERT INTO accounting.receivable_ledger_entries (
        id, installation_id, receivable_document_id, customer_id, currency_code, entry_type,
        amount, source_document_type, source_document_id, source_document_number,
        document_status_after, actor_id, request_id, source_app, occurred_at
      ) VALUES (
        ${q(ids.ledger)}, ${q(config.installationId)}, ${q(ids.document)}, ${q(ids.customer)}, 'VND',
        'SALE_POST', 100, 'DELIVERY_ATTEMPT', ${q(ids.source)}, 'DO-TEST-001', 'open',
        'test:actor', 'test:request', 'test', now()
      );
    `);
    const matched = await client.query(`
      SELECT ledger_amount::text, expected_ledger_amount::text,
             projected_remaining_amount::text, calculated_remaining_amount::text,
             reconciliation_status
        FROM reporting.phase6f_document_reconciliation
       WHERE installation_id=$1 AND id=$2
    `, [config.installationId, ids.document]);
    assert.deepEqual(matched.rows[0], {
      ledger_amount: '100.000000',
      expected_ledger_amount: '100.000000',
      projected_remaining_amount: '100.000000',
      calculated_remaining_amount: '100.000000',
      reconciliation_status: 'matched',
    });
    await client.query('UPDATE accounting.receivable_ledger_entries SET amount=90 WHERE installation_id=$1 AND id=$2', [config.installationId, ids.ledger]);
    const mismatched = await client.query('SELECT reconciliation_status FROM reporting.phase6f_document_reconciliation WHERE installation_id=$1 AND id=$2', [config.installationId, ids.document]);
    assert.equal(mismatched.rows[0].reconciliation_status, 'mismatch');
    await client.query('ROLLBACK');
  } finally {
    client.release();
    await closePool();
  }
});
