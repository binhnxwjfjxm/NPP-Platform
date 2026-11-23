import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routes = readFileSync(new URL('../src/routes/sales-orders.js', import.meta.url), 'utf8');
const engine = readFileSync(new URL('../src/services/sales-direct-stock-issue.js', import.meta.url), 'utf8');

test('stock issue emits one request-correlated timing outcome with safe stage timings', () => {
  assert.match(routes, /const tracingSalesStockIssue = action === 'manual_stock_issue' \|\| action === 'pickup_stock_issue'/);
  assert.match(routes, /const traceStartedAt = Date\.now\(\)/);
  assert.match(routes, /beforeReadMs: null, mutationMs: null, auditMs: null/);
  assert.match(routes, /traceSpans\.beforeReadMs = Date\.now\(\) - beforeStartedAt/);
  assert.match(routes, /traceSpans\.mutationMs = Date\.now\(\) - mutationStartedAt/);
  assert.match(routes, /traceSpans\.auditMs = Date\.now\(\) - auditStartedAt/);
  assert.match(routes, /event: 'sales_order_stock_issue_timing'/);
  assert.match(routes, /requestId: options\.requestId/);
  assert.match(routes, /statusCode: execution\.response\.statusCode/);
  assert.match(routes, /resultCode: execution\.response\.body\?\.error\?\.code \?\? null/);
  assert.match(routes, /\.\.\.traceSpans/);
});

test('transaction error retains sanitized event with elapsed stock posting stages', () => {
  assert.match(routes, /sanitizedUnexpectedError\(error,/);
  assert.match(routes, /\.\.\.sanitizedUnexpectedError\(error,/);
  assert.match(routes, /tracingSalesStockIssue \? \{ durationMs: Date\.now\(\) - traceStartedAt, \.\.\.traceSpans \} : \{\}/);
  assert.doesNotMatch(routes, /event: 'sales_order_stock_issue_timing'[\s\S]{0,250}idempotencyKey:/);
});

test('slow warehouse/SKU lock wait is logged without SQL text or credentials', () => {
  assert.match(engine, /const lockStartedAt = Date\.now\(\);\s*await lockOrderStockScopes\(client,/);
  assert.match(engine, /const scopeLockWaitMs = Date\.now\(\) - lockStartedAt/);
  assert.match(engine, /scopeLockWaitMs >= 1_000/);
  assert.match(engine, /event: 'sales_order_stock_issue_scope_lock_wait'/);
  assert.match(engine, /requestId: requestContext\.requestId \?\? null/);
  assert.match(engine, /lockWaitMs: scopeLockWaitMs/);
  assert.match(engine, /postServerOwnedSalesMovement\(client,/);
  assert.match(routes, /withAuditOutboxTransaction\(\{/);
});
