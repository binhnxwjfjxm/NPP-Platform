import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { IDEMPOTENCY_KEY_PATTERN } from '@npp/contracts';
import { withAuditOutboxTransaction } from '../src/audit-outbox.js';
import { deriveIdempotencyKey } from '../src/idempotency-derived.js';
import { codDriverInternals } from '../src/routes/cod-driver.js';
import { codReconciliationInternals } from '../src/routes/cod-reconciliation.js';

const requestContext = Object.freeze({
  installationId: 'installation-cod-regression',
  actorId: 'employee-cod-regression',
  employeeId: null,
  sourceApp: 'delivery',
  requestId: 'req_cod_regression',
});

function createClient() {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql: String(sql).trim(), values });
      return { rows: [], rowCount: 1 };
    },
    async release() {},
  };
}

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('COD payment and document-number child keys use one deterministic canonical derivation contract', () => {
  const first = deriveIdempotencyKey('cod-payment', 'same-logical-operation');
  const retry = deriveIdempotencyKey('cod-payment', 'same-logical-operation');
  const another = deriveIdempotencyKey('customer-payment-number', first);

  assert.equal(first, retry);
  assert.notEqual(first, another);
  assert.match(first, IDEMPOTENCY_KEY_PATTERN);
  assert.match(another, IDEMPOTENCY_KEY_PATTERN);
  assert.doesNotMatch(first, /:/);
  assert.doesNotMatch(another, /:/);
});

test('COD audit/outbox transaction declares two facts when customer payment is created', () => {
  assert.deepEqual(
    codDriverInternals.transactionExpectations({ payment: { id: randomUUID() } }),
    { expectedAuditCount: 2, expectedOutboxCount: 2 },
  );
  assert.deepEqual(
    codDriverInternals.transactionExpectations({ payment: null }),
    { expectedAuditCount: 1, expectedOutboxCount: 1 },
  );
});

test('COD reconciliation transaction declares every audit/outbox fact and preserves replay marker', () => {
  assert.deepEqual(
    codReconciliationInternals.transactionExpectations({ paymentEvents: [] }),
    { expectedAuditCount: 1, expectedOutboxCount: 1 },
  );
  assert.deepEqual(
    codReconciliationInternals.transactionExpectations({ paymentEvents: [{ id: 'a' }, { id: 'b' }] }),
    { expectedAuditCount: 3, expectedOutboxCount: 3 },
  );

  const route = source('../src/routes/cod-reconciliation.js');
  assert.match(route, /if \(result\.replayed\) return \{ result, replayed: true \};/);
  assert.match(route, /return \{ result, \.\.\.transactionExpectations\(result\) \};/);
});

test('audit/outbox guard commits an explicitly declared two-audit two-outbox COD transaction', async () => {
  const client = createClient();
  const result = await withAuditOutboxTransaction({
    adapter: { connect: async () => client },
    mutate: async (transactionClient, helpers) => {
      await transactionClient.query('INSERT INTO accounting.example_cod_fact (id) VALUES ($1)', [randomUUID()]);
      for (const suffix of ['collection', 'payment']) {
        await helpers.insertAuditRecord(transactionClient, helpers.buildAuditRecord({
          requestContext,
          action: `cod.${suffix}`,
          resourceType: `accounting.${suffix}`,
          resourceId: randomUUID(),
        }));
        await helpers.insertOutboxEvent(transactionClient, helpers.buildOutboxEvent({
          requestContext,
          aggregateType: `accounting.${suffix}`,
          aggregateId: randomUUID(),
          eventType: `core.cod.${suffix}`,
          payload: { suffix },
        }));
      }
      return {
        eventId: randomUUID(),
        expectedAuditCount: 2,
        expectedOutboxCount: 2,
      };
    },
  });

  assert.equal(result.expectedAuditCount, 2);
  assert.equal(result.expectedOutboxCount, 2);
  assert.equal(client.calls.at(-1).sql, 'COMMIT');
});

test('unexpected COD transaction diagnostics keep request lineage and redact provider secrets', () => {
  const error = Object.assign(
    new Error('postgresql://user:private@db.example/core password=topsecret failed'),
    { code: 'XX000', constraint: 'safe_constraint' },
  );
  const diagnostic = codDriverInternals.sanitizeCodTransactionError(error, {
    requestId: 'req_cod_503',
    route: '/api/logistics/driver/trips/trip/assignments/assignment/cod-collections',
    stage: 'audit-outbox-transaction',
  });
  const encoded = JSON.stringify(diagnostic);

  assert.equal(diagnostic.requestId, 'req_cod_503');
  assert.equal(diagnostic.stage, 'audit-outbox-transaction');
  assert.equal(diagnostic.code, 'XX000');
  assert.equal(diagnostic.constraint, 'safe_constraint');
  assert.doesNotMatch(encoded, /private@|topsecret/);
  assert.match(encoded, /\[redacted-url\]/);
});

test('COD chain has no ad-hoc colon-delimited child idempotency keys and preserves replay marker', () => {
  const codService = source('../src/services/cod-settlement-driver.js');
  const paymentService = source('../src/services/customer-payment.js');
  const route = source('../src/routes/cod-driver.js');

  assert.match(codService, /deriveIdempotencyKey\('cod-payment', hash\)/);
  assert.match(paymentService, /deriveIdempotencyKey\('customer-payment-number', idempotencyKey\)/);
  assert.doesNotMatch(codService, /codpay:/);
  assert.doesNotMatch(paymentService, /customer-payment:\$\{idempotencyKey\}/);
  assert.match(route, /return \{ result, replayed: true \}/);
  assert.match(route, /expectedAuditCount/);
  assert.match(route, /expectedOutboxCount/);
  assert.match(route, /COD_TRANSACTION_FAILED/);
});
