import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { getPool, closePool } from '../src/db/pool.js';
import { startServer } from '../src/server.js';

function closeServer(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function headers(config, idempotencyKey) {
  return {
    Authorization: `Bearer ${config.backendApiToken}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
  };
}

async function readResponse(responseOrPromise) {
  const response = await responseOrPromise;
  const body = await response.json();
  return { response, body };
}

async function seed(pool, installationId) {
  const client = await pool.connect();
  const actor = 'test:customer-payment-fixture';
  const code = randomUUID().slice(0, 8).toUpperCase();
  const ids = {
    branchId: randomUUID(),
    warehouseA: randomUUID(),
    warehouseB: randomUUID(),
    customerId: randomUUID(),
    customerAddressId: randomUUID(),
    targetA: randomUUID(),
    targetB: randomUUID(),
  };
  const targetSeeds = [
    {
      id: ids.targetA,
      warehouseId: ids.warehouseA,
      warehouseCode: `WHA-${code}`,
      warehouseName: `Kho A ${code}`,
      number: `REC-A-${code}`,
      amount: '100.000000',
    },
    {
      id: ids.targetB,
      warehouseId: ids.warehouseB,
      warehouseCode: `WHB-${code}`,
      warehouseName: `Kho B ${code}`,
      number: `REC-B-${code}`,
      amount: '200.000000',
    },
  ];

  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO shared.branches (
         id, installation_id, code, name, is_active, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,true,$5,$5)`,
      [ids.branchId, installationId, `BR-${code}`, `Chi nhánh ${code}`, actor],
    );
    await client.query(
      `INSERT INTO shared.warehouses (
         id, installation_id, branch_id, code, name, warehouse_type,
         is_active, created_by, updated_by
       ) VALUES
         ($1,$3,$4,$5,$6,'main',true,$7,$7),
         ($2,$3,$4,$8,$9,'main',true,$7,$7)`,
      [
        ids.warehouseA,
        ids.warehouseB,
        installationId,
        ids.branchId,
        targetSeeds[0].warehouseCode,
        targetSeeds[0].warehouseName,
        actor,
        targetSeeds[1].warehouseCode,
        targetSeeds[1].warehouseName,
      ],
    );
    await client.query(
      `INSERT INTO shared.customers (
         id, installation_id, code, name, payment_terms_days, credit_limit,
         is_active, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,0,0,true,$5,$5)`,
      [ids.customerId, installationId, `CUS-${code}`, `Khách hàng ${code}`, actor],
    );
    await client.query(
      `INSERT INTO shared.customer_addresses (
         id, installation_id, customer_id, label, address_line1,
         country_code, is_default, is_active, created_by, updated_by
       ) VALUES ($1,$2,$3,'Trụ sở','1 Đường kiểm thử','VN',true,true,$4,$4)`,
      [ids.customerAddressId, installationId, ids.customerId, actor],
    );

    const series = await client.query(
      `SELECT document_type
         FROM shared.document_number_series
        WHERE installation_id = $1 AND code = 'CUSTOMER_PAYMENT'`,
      [installationId],
    );
    assert.equal(series.rowCount, 1, 'customer insert must create the payment series');
    assert.equal(series.rows[0].document_type, 'CUSTOMER_PAYMENT');

    await client.query("SET LOCAL session_replication_role = 'replica'");
    for (const target of targetSeeds) {
      await client.query(
        `INSERT INTO accounting.receivable_documents (
           id, installation_id, customer_id, customer_address_id, warehouse_id,
           sales_order_id, sales_order_version_id, delivery_order_id,
           direction, document_type, source_document_type, source_document_id,
           source_document_number, source_document_date,
           customer_code_snapshot, customer_name_snapshot,
           warehouse_code_snapshot, warehouse_name_snapshot, collection_policy,
           currency_code, original_amount, allocated_amount, remaining_amount,
           status, source_revision, posting_origin, posted_at, posted_by,
           revision, created_by, updated_by
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,
           'DEBIT','SALE_DELIVERY','DELIVERY_ATTEMPT',$9,
           $10,'2026-08-05',$11,$12,$13,$14,'CREDIT_TERMS',
           'VND',$15,0,$15,'open',1,'runtime','2026-08-05T01:00:00Z',$16,
           1,$16,$16
         )`,
        [
          target.id,
          installationId,
          ids.customerId,
          ids.customerAddressId,
          target.warehouseId,
          randomUUID(),
          randomUUID(),
          randomUUID(),
          randomUUID(),
          target.number,
          `CUS-${code}`,
          `Khách hàng ${code}`,
          target.warehouseCode,
          target.warehouseName,
          target.amount,
          actor,
        ],
      );
    }
    await client.query("SET LOCAL session_replication_role = 'origin'");
    await client.query("SELECT set_config('npp.receivable_write_context', 'receivable_service', true)");
    for (const target of targetSeeds) {
      await client.query(
        `INSERT INTO accounting.receivable_ledger_entries (
           id, installation_id, receivable_document_id, customer_id,
           currency_code, entry_type, amount, source_document_type,
           source_document_id, source_document_number, source_revision,
           document_status_after, actor_id, request_id, source_app,
           occurred_at, metadata
         ) VALUES (
           $1,$2,$3,$4,'VND','SALE_POST',$5,'DELIVERY_ATTEMPT',
           $6,$7,1,'open',$8,$9,'test','2026-08-05T01:00:00Z','{}'::jsonb
         )`,
        [
          randomUUID(),
          installationId,
          target.id,
          ids.customerId,
          target.amount,
          randomUUID(),
          target.number,
          actor,
          `seed-${target.id}`,
        ],
      );
    }
    await client.query('COMMIT');
    return { ...ids, code };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function projection(pool, installationId, ids) {
  const result = await pool.query(
    `SELECT id, status, allocated_amount::text, remaining_amount::text
       FROM accounting.receivable_documents
      WHERE installation_id = $1 AND id = ANY($2::uuid[])`,
    [installationId, ids],
  );
  return new Map(result.rows.map((row) => [row.id, row]));
}

async function customerBalance(pool, installationId, customerId) {
  const result = await pool.query(
    `SELECT balance::text
       FROM accounting.customer_receivable_balances
      WHERE installation_id = $1 AND customer_id = $2 AND currency_code = 'VND'`,
    [installationId, customerId],
  );
  return result.rows[0]?.balance ?? null;
}

test('Phase 6F.2 records, multi-allocates, serializes and reverses customer payment facts', async () => {
  const installationId = `customer-payment-${randomUUID()}`;
  const config = loadConfig({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '3087',
    INSTALLATION_ID: installationId,
    DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://user:password@127.0.0.1:5432/npp_platform',
    DATABASE_SSL_MODE: process.env.TEST_DATABASE_SSL_MODE || process.env.DATABASE_SSL_MODE || 'disable',
    BACKEND_API_TOKEN: 'test-token-0123456789abcdef',
    CORE_BOOTSTRAP_ACTOR_ID: 'test:bootstrap',
    CORS_ORIGINS: 'http://127.0.0.1:3003',
  });
  const pool = getPool(config);
  let server;

  try {
    const fixture = await seed(pool, installationId);
    assert.equal(await customerBalance(pool, installationId, fixture.customerId), '300.000000');

    server = await startServer({ config });
    const baseUrl = `http://${config.host}:${config.port}`;
    const createKey = `customer-payment-${randomUUID()}`;
    const createPayload = {
      customerId: fixture.customerId,
      warehouseId: fixture.warehouseA,
      paymentDate: '2026-08-05',
      currencyCode: 'VND',
      paymentMethod: 'BANK_TRANSFER',
      amount: '150',
      externalReference: `BANK-${fixture.code}`,
      note: 'Một phiếu thu phân bổ qua hai kho',
      allocations: [
        { receivableDocumentId: fixture.targetA, amount: '100' },
        { receivableDocumentId: fixture.targetB, amount: '50' },
      ],
    };

    let result = await readResponse(fetch(`${baseUrl}/api/customer-payments`, {
      method: 'POST',
      headers: headers(config, createKey),
      body: JSON.stringify(createPayload),
    }));
    assert.equal(result.response.status, 201, JSON.stringify(result.body));
    const payment = result.body.data;
    assert.equal(payment.documentType, 'CUSTOMER_PAYMENT');
    assert.match(payment.documentNumber, /^CP-202608-\d{6}$/);
    assert.equal(payment.originalAmount, '150.000000');
    assert.equal(payment.allocatedAmount, '150.000000');
    assert.equal(payment.remainingAmount, '0.000000');
    assert.equal(payment.status, 'settled');
    assert.equal(payment.allocations.length, 2);
    assert.equal(await customerBalance(pool, installationId, fixture.customerId), '150.000000');

    result = await readResponse(fetch(`${baseUrl}/api/customer-payments`, {
      method: 'POST',
      headers: headers(config, createKey),
      body: JSON.stringify(createPayload),
    }));
    assert.equal(result.response.status, 201, JSON.stringify(result.body));
    assert.equal(result.body.data.id, payment.id);
    const replayCounts = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM accounting.receivable_documents
           WHERE installation_id = $1 AND document_type = 'CUSTOMER_PAYMENT') AS payments,
         (SELECT count(*)::int FROM accounting.receivable_allocations
           WHERE installation_id = $1 AND source_receivable_document_id = $2) AS allocations`,
      [installationId, payment.id],
    );
    assert.deepEqual(replayCounts.rows[0], { payments: 1, allocations: 2 });

    let byId = await projection(pool, installationId, [fixture.targetA, fixture.targetB]);
    assert.equal(byId.get(fixture.targetA).status, 'settled');
    assert.equal(byId.get(fixture.targetA).remaining_amount, '0.000000');
    assert.equal(byId.get(fixture.targetB).status, 'partially_allocated');
    assert.equal(byId.get(fixture.targetB).remaining_amount, '150.000000');

    result = await readResponse(fetch(`${baseUrl}/api/customer-payments/${payment.id}/reverse`, {
      method: 'POST',
      headers: headers(config, `reverse-blocked-${randomUUID()}`),
      body: JSON.stringify({ reason: 'Không được đảo khi còn phân bổ' }),
    }));
    assert.equal(result.response.status, 409, JSON.stringify(result.body));
    assert.equal(result.body.error.code, 'PAYMENT_ALLOCATION_EXISTS');

    const secondPayload = {
      customerId: fixture.customerId,
      warehouseId: fixture.warehouseB,
      paymentDate: '2026-08-05',
      currencyCode: 'VND',
      paymentMethod: 'CASH',
      amount: '40',
      note: 'Phiếu dùng kiểm tra cạnh tranh đồng thời',
    };
    result = await readResponse(fetch(`${baseUrl}/api/customer-payments`, {
      method: 'POST',
      headers: headers(config, `customer-payment-second-${randomUUID()}`),
      body: JSON.stringify(secondPayload),
    }));
    assert.equal(result.response.status, 201, JSON.stringify(result.body));
    const secondPayment = result.body.data;

    const concurrentPayload = JSON.stringify({
      allocationDate: '2026-08-05',
      allocations: [{ receivableDocumentId: fixture.targetB, amount: '40' }],
    });
    const concurrent = await Promise.all([
      readResponse(fetch(`${baseUrl}/api/customer-payments/${secondPayment.id}/allocations`, {
        method: 'POST',
        headers: headers(config, `allocate-a-${randomUUID()}`),
        body: concurrentPayload,
      })),
      readResponse(fetch(`${baseUrl}/api/customer-payments/${secondPayment.id}/allocations`, {
        method: 'POST',
        headers: headers(config, `allocate-b-${randomUUID()}`),
        body: concurrentPayload,
      })),
    ]);
    const success = concurrent.filter((entry) => entry.response.status === 200);
    const conflict = concurrent.filter((entry) => entry.response.status === 409);
    assert.equal(success.length, 1, JSON.stringify(concurrent.map((entry) => entry.body)));
    assert.equal(conflict.length, 1, JSON.stringify(concurrent.map((entry) => entry.body)));
    assert.equal(conflict[0].body.error.code, 'ALLOCATION_EXCEEDS_SOURCE');

    const firstAllocationIds = payment.allocations.map((allocation) => allocation.id);
    for (const allocationId of firstAllocationIds) {
      result = await readResponse(fetch(`${baseUrl}/api/receivable-allocations/${allocationId}/reverse`, {
        method: 'POST',
        headers: headers(config, `reverse-allocation-${allocationId}`),
        body: JSON.stringify({ reason: 'Đảo phân bổ để đảo phiếu thu' }),
      }));
      assert.equal(result.response.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.data.reversed, true);
    }

    const paymentReverseKey = `reverse-customer-payment-${randomUUID()}`;
    const paymentReversePayload = { reason: 'Đảo phiếu thu sau khi đã đảo phân bổ' };
    result = await readResponse(fetch(`${baseUrl}/api/customer-payments/${payment.id}/reverse`, {
      method: 'POST',
      headers: headers(config, paymentReverseKey),
      body: JSON.stringify(paymentReversePayload),
    }));
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.data.status, 'reversed');

    result = await readResponse(fetch(`${baseUrl}/api/customer-payments/${payment.id}/reverse`, {
      method: 'POST',
      headers: headers(config, paymentReverseKey),
      body: JSON.stringify(paymentReversePayload),
    }));
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.data.status, 'reversed');

    byId = await projection(pool, installationId, [fixture.targetA, fixture.targetB, payment.id]);
    assert.equal(byId.get(fixture.targetA).remaining_amount, '100.000000');
    assert.equal(byId.get(fixture.targetB).remaining_amount, '160.000000');
    assert.equal(byId.get(payment.id).status, 'reversed');

    const facts = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM accounting.receivable_allocations
           WHERE installation_id = $1 AND source_receivable_document_id = $2) AS first_allocations,
         (SELECT count(*)::int FROM accounting.receivable_allocation_reversals reversal
           JOIN accounting.receivable_allocations allocation
             ON allocation.installation_id = reversal.installation_id
            AND allocation.id = reversal.allocation_id
          WHERE reversal.installation_id = $1
            AND allocation.source_receivable_document_id = $2) AS first_reversals,
         (SELECT count(*)::int FROM accounting.receivable_ledger_entries
           WHERE installation_id = $1 AND receivable_document_id = $2) AS payment_ledger,
         (SELECT count(*)::int FROM shared.core_audit_records
           WHERE installation_id = $1
             AND resource_type = 'accounting.customer_payment'
             AND resource_id = $2::text) AS payment_audits,
         (SELECT count(*)::int FROM shared.core_outbox_events
           WHERE installation_id = $1
             AND aggregate_type = 'accounting.customer_payment'
             AND aggregate_id = $2::text) AS payment_outbox`,
      [installationId, payment.id],
    );
    assert.deepEqual(facts.rows[0], {
      first_allocations: 2,
      first_reversals: 2,
      payment_ledger: 2,
      payment_audits: 2,
      payment_outbox: 2,
    });

    await assert.rejects(
      pool.query(
        `UPDATE accounting.receivable_allocations
            SET amount = 1
          WHERE installation_id = $1 AND id = $2`,
        [installationId, firstAllocationIds[0]],
      ),
      /receivable_allocation_history_is_append_only/,
    );
  } finally {
    if (server) await closeServer(server);
    await closePool();
  }
});
