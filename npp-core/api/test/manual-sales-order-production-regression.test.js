import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import test from 'node:test';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';
import { handleManualSalesOrderRoutes, manualSalesOrderRouteInternals } from '../src/routes/manual-sales-orders.js';
import { salesOrderRouteInternals } from '../src/routes/sales-orders.js';
import { hasPhysicalExecutionFacts } from '../src/db/repositories/sales-fulfillment-allocation-release.js';
import { manualEditAllocationReleaseInternals } from '../src/services/sales-fulfillment-allocation-release.js';

const salesOrderServiceSource = readFileSync(new URL('../src/services/sales-order.js', import.meta.url), 'utf8');
const salesOrderRouteSource = readFileSync(new URL('../src/routes/sales-orders.js', import.meta.url), 'utf8');
const stockIssueSource = readFileSync(new URL('../src/services/sales-manual-stock-issue.js', import.meta.url), 'utf8');
const manualCompletionSource = readFileSync(new URL('../src/services/sales-manual-completion.js', import.meta.url), 'utf8');
const workspaceSource = readFileSync(
  new URL('../../web/app/sales/sales-orders/SalesOrderWorkspace.tsx', import.meta.url),
  'utf8',
);

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

test('migration 095 makes direct Giao thủ công receivable header reachable', () => {
  const migration = CORE_API_MIGRATIONS.find(
    (entry) => entry.id === '095_manual_sales_order_receivable_delivery_order_nullable',
  );
  assert.ok(migration);
  assert.match(migration.sql, /ALTER TABLE accounting\.receivable_documents/);
  assert.match(migration.sql, /ALTER COLUMN delivery_order_id DROP NOT NULL/);
});

test('pre-execution release keeps physical execution as a hard boundary', async () => {
  const client = {
    async query(sql) {
      assert.match(sql, /picked_base_quantity <> 0/);
      assert.match(sql, /packed_base_quantity <> 0/);
      assert.match(sql, /issued_base_quantity <> 0/);
      return { rows: [{ blocked: true }] };
    },
  };
  assert.equal(await hasPhysicalExecutionFacts(client, {
    installationId: 'installation-1',
    salesOrderId: '11111111-1111-4111-8111-111111111111',
  }), true);
  assert.equal(manualEditAllocationReleaseInternals.releaseIntent('amendment').blockedCode, 'SALES_ORDER_AMENDMENT_BLOCKED');
  assert.equal(manualEditAllocationReleaseInternals.releaseIntent('cancel').blockedCode, 'SALES_ORDER_CANCEL_BLOCKED');
});

test('confirmed amendment, manual edit and cancel share the pre-execution release service', () => {
  assert.match(salesOrderServiceSource, /releasePreExecutionAllocations\(client/);
  assert.match(salesOrderServiceSource, /preExecutionReleaseIntent = 'amendment'/);
  assert.match(salesOrderServiceSource, /preExecutionReleaseIntent: 'manual-edit'/);
  assert.match(salesOrderServiceSource, /intentName: 'cancel'/);
  assert.doesNotMatch(
    salesOrderServiceSource,
    /warehouseExecutionStarted = \[\s*totals\.allocatedBaseQuantity/,
  );
});

test('cancel passes the canonical request idempotency key into the shared unwind', () => {
  assert.match(salesOrderRouteSource, /mutate: \(client, key\) => service\.cancelSalesOrder/);
  assert.match(salesOrderRouteSource, /idempotencyKey: key/);
  assert.match(salesOrderServiceSource, /IDEMPOTENCY_KEY_PATTERN\.test\(String\(input\.idempotencyKey/);
  assert.doesNotMatch(salesOrderServiceSource, /idempotencyKey: input\.idempotencyKey \?\? input\.id/);
});

test('shortage remains the same operation but is re-evaluated on retry', () => {
  assert.match(
    stockIssueSource,
    /code === 'MANUAL_STOCK_ISSUE_SHORTAGE' \? true : retryable/,
  );
  assert.match(workspaceSource, /type StockIssueKeyState = Readonly<\{ orderId: string; stateKey: string; key: string \}>/);
  assert.match(workspaceSource, /existing\?\.orderId === selected\.id && existing\.stateKey === actionStateKey/);
  assert.match(workspaceSource, /stockIssueKeyRef\.current = \{ orderId: selected\.id, stateKey: actionStateKey, key \}/);
});

test('Nộp tiền/Nợ accepts full debt without creating a customer payment', () => {
  assert.match(manualCompletionSource, /decimalToScaled\(payload\?\.paidAmount, \{ allowZero: true \}\)/);
  assert.match(manualCompletionSource, /if \(paid === 0n\)/);
  assert.match(manualCompletionSource, /customerPayment: null/);
  assert.match(manualCompletionSource, /auditOutboxEffect: auditOutboxEffect\(\)/);
});

test('order operation errors are scoped to the selected business state', () => {
  assert.match(workspaceSource, /export function orderBusinessStateKey/);
  assert.match(workspaceSource, /operationError\.orderId === selected\.id/);
  assert.match(workspaceSource, /operationError\.stateKey === selectedStateKey/);
  assert.match(workspaceSource, /setOperationError\(Object\.freeze\(\{/);
});

test('unexpected completion transaction failure is logged safely and still returns office-facing 503', async () => {
  const salesOrderId = '11111111-1111-4111-8111-111111111111';
  const req = Readable.from([JSON.stringify({ expectedRevision: '3' })]);
  req.url = `/api/manual-sales-orders/${salesOrderId}/complete`;
  req.method = 'POST';
  req.headers = { 'idempotency-key': 'manual.complete.regression' };
  const res = responseCapture();
  const captured = [];
  const originalConsoleError = console.error;
  console.error = (...args) => captured.push(args.join(' '));
  try {
    const handled = await handleManualSalesOrderRoutes(req, res, {
      config: {},
      requestId: 'req-manual-complete-regression',
      receivedAt: '2026-08-19T07:30:00.000Z',
      PERMISSIONS: {
        coreSalesOrderConfirm: 'core.sales-order.confirm',
        coreCustomerPaymentCreate: 'core.customer-payment.create',
      },
      authenticate: () => ({ ok: true, principal: { id: 'actor-1' } }),
      authorize: () => ({ ok: true }),
      createContext: () => Object.freeze({
        installationId: 'installation-1',
        actorId: 'actor-1',
        roles: Object.freeze([]),
        permissions: Object.freeze(['core.sales-order.confirm']),
        scopes: Object.freeze({
          branchIds: Object.freeze([]),
          warehouseIds: Object.freeze(['22222222-2222-4222-8222-222222222222']),
          territoryIds: Object.freeze([]),
        }),
      }),
      getPool: () => ({
        async connect() {
          const error = new Error('insert failed on postgresql://user:secret@db.example.test/app');
          error.code = '23502';
          throw error;
        },
      }),
      idempotencyStore: {},
      executeRequestWithIdempotency: async ({ onProcess }) => ({
        response: await onProcess(),
        replayed: false,
      }),
    });
    assert.equal(handled, true);
    assert.equal(res.statusCode, 503);
    const payload = JSON.parse(res.body);
    assert.equal(payload.error.code, 'MANUAL_ORDER_TRANSACTION_UNAVAILABLE');
    assert.equal(payload.error.retryable, true);
    assert.equal(captured.length, 1);
    assert.match(captured[0], /manual_sales_order_unexpected_error/);
    assert.match(captured[0], /23502/);
    assert.doesNotMatch(captured[0], /user:secret/);
    assert.match(captured[0], /\[redacted\]/);
  } finally {
    console.error = originalConsoleError;
  }
});

test('sanitizer never exposes database connection strings', () => {
  const error = Object.assign(
    new Error('connect postgresql://alice:password@db.example.test/app failed'),
    { code: '23502' },
  );
  const safe = manualSalesOrderRouteInternals.sanitizedUnexpectedError(
    error,
    'req-1',
    'complete',
    '11111111-1111-4111-8111-111111111111',
  );
  assert.equal(safe.code, '23502');
  assert.doesNotMatch(safe.message, /alice:password/);
  assert.match(safe.message, /\[redacted\]/);
});

test('Sales Order transaction log keeps request and PostgreSQL constraint but redacts secrets', () => {
  const error = Object.assign(
    new Error('delete failed at postgresql://alice:password@db.example.test/app token=secret-value'),
    { code: '23503', constraint: 'trip_order_assignments_stop_fk' },
  );
  const safe = salesOrderRouteInternals.sanitizedUnexpectedError(error, {
    requestId: 'req-cancel-1',
    action: 'cancel',
    resourceId: '11111111-1111-4111-8111-111111111111',
    route: '/api/sales-orders/11111111-1111-4111-8111-111111111111/cancel',
  });
  assert.equal(safe.requestId, 'req-cancel-1');
  assert.equal(safe.code, '23503');
  assert.equal(safe.constraint, 'trip_order_assignments_stop_fk');
  assert.doesNotMatch(safe.message, /alice:password|secret-value/);
});
