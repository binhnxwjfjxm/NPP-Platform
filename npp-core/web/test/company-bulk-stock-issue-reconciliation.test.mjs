import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspace = readFileSync(
  new URL('../app/sales/order-management/OrderManagementWorkspace.tsx', import.meta.url),
  'utf8',
);
const route = readFileSync(
  new URL('../app/api/sales-orders/[id]/issue-stock/route.ts', import.meta.url),
  'utf8',
);
const backend = readFileSync(
  new URL('../../api/src/routes/sales-orders.js', import.meta.url),
  'utf8',
);
const engine = readFileSync(
  new URL('../../api/src/services/sales-direct-stock-issue.js', import.meta.url),
  'utf8',
);
const idempotency = readFileSync(
  new URL('../../api/src/idempotency.js', import.meta.url),
  'utf8',
);

test('bulk direct-stock issue is bounded separately from other quick actions', () => {
  assert.match(workspace, /const BULK_STOCK_ISSUE_CONCURRENCY = 2;/);
  assert.match(workspace, /const concurrency = action === 'issue-stock' \? BULK_STOCK_ISSUE_CONCURRENCY : 4;/);
  assert.match(workspace, /targets\.slice\(index, index \+ concurrency\)/);
  assert.match(workspace, /await Promise\.all\(chunk\.map/);
});

test('each stock issue carries an independent trace ID with a stable idempotency key', () => {
  assert.match(workspace, /stableMutationKey\(action, fresh\.id, fingerprint, 'sales-manual-stock-issue'\)/);
  assert.match(workspace, /const requestId = mutationKey\('sales-stock-issue-request'\);/);
  assert.match(workspace, /headers: \{ 'Idempotency-Key': key, 'x-request-id': requestId \}/);
  assert.match(route, /salesOrderIdempotencyKey\(request\)/);
  assert.match(backend, /executeIdempotentMutation\(req, res, options,/);
  assert.match(idempotency, /const requestFingerprint = createRequestFingerprint\(payload\)/);
});

test('failed POST is reconciled by canonical GET and never assumed to have failed', () => {
  assert.match(workspace, /let submittedRequestId: string \| null = null;/);
  assert.match(workspace, /if \(submittedRequestId\) \{[\s\S]*?const latest = await fetchOrderDetail\(order\.id\);/);
  assert.match(workspace, /if \(directStockIssueCompleted\(latest\)\) \{[\s\S]*?status: 'verified-issued'/);
  assert.match(workspace, /status: knownRejection \? 'failed' : 'unverified'/);
  assert.doesNotMatch(workspace, /catch \(error\) \{[\s\S]{0,250}executeQuickAction\(order, action\)/);
});

test('failure before POST is distinct from an unknown result after POST', () => {
  assert.match(workspace, /onIssueSubmitted\?\.\(requestId\);/);
  assert.match(workspace, /if \(submittedRequestId\) \{/);
  assert.match(workspace, /The initial GET failed before POST was submitted/);
  assert.match(workspace, /outcome: \{ \.\.\.base, status: 'failed' \} as StockIssueOutcome/);
});

test('batch reports one outcome per order and retains failed or unverified selections', () => {
  assert.match(workspace, /if \(result\.outcome\) outcomes\.push\(result\.outcome\);/);
  assert.match(workspace, /setStockIssueReport\(\{ outcomes \}\);/);
  assert.match(workspace, /setSelectedIds\(new Set\(outcomes\.filter\(\(item\) =>[\s\S]*?item\.status === 'failed' \|\| item\.status === 'unverified'/);
  assert.match(workspace, /stockIssueReport\.outcomes\.map\(\(item\) =>/);
  assert.match(workspace, /Mã tra cứu:/);
});

test('unverified orders block bulk and row re-submission until operator reconciliation', () => {
  assert.match(workspace, /stockIssueReport\?\.outcomes\.some\(\(item\) => item\.status === 'unverified' && selectedIds\.has\(item\.orderId\)\)/);
  assert.match(workspace, /item\.orderId === order\.id && item\.status === 'unverified'/);
  assert.match(workspace, /Không xuất lại trước khi đối chiếu trạng thái và chứng từ/);
});

test('backend continues to guard ledger posting with locks, transaction and one-time issue checks', () => {
  assert.match(engine, /await lockOrderStockScopes\(client,/);
  assert.match(engine, /await lockDemands\(client,/);
  assert.match(engine, /const fullyIssued = demands\.every/);
  assert.match(engine, /if \(fullyIssued\) \{/);
  assert.match(engine, /postServerOwnedSalesMovement\(client,/);
  assert.match(backend, /withAuditOutboxTransaction\(\{/);
});
