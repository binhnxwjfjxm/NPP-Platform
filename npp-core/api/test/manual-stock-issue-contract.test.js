import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const wrapperPath = fileURLToPath(new URL('../src/services/sales-manual-stock-issue.js', import.meta.url));
const enginePath = fileURLToPath(new URL('../src/services/sales-direct-stock-issue.js', import.meta.url));
const routePath = fileURLToPath(new URL('../src/routes/sales-orders.js', import.meta.url));

test('Giao thủ công giữ nguyên contract và dùng shared direct stock issue engine', async () => {
  const [wrapper, source] = await Promise.all([
    readFile(wrapperPath, 'utf8'),
    readFile(enginePath, 'utf8'),
  ]);

  assert.match(wrapper, /issueDirectSalesOrderStock/);
  assert.match(wrapper, /mode: 'MANUAL'/);
  assert.match(wrapper, /manualStockIssueInternals = directStockIssueInternals/);
  assert.match(source, /createIdempotencyKey/);
  assert.match(source, /IDEMPOTENCY_KEY_PATTERN/);
  assert.match(source, /postServerOwnedSalesMovement/);
  assert.match(source, /movementType: 'SALES_DELIVERY_ISSUE'/);
  assert.match(source, /sourceDocumentType: 'SALES_ORDER'/);
  assert.match(source, /sales-manual-stock-issue-movement/);
  assert.match(source, /reasonCode: 'MANUAL_SALES_ORDER_STOCK_ISSUE'/);
  assert.doesNotMatch(source, /receivable/i);

  const prepare = source.indexOf('const prepared = await prepareDemandsForIssue');
  const movement = source.indexOf('const movementResult = await postServerOwnedSalesMovement');
  const issued = source.indexOf('const updated = await markDemandsIssued');
  assert.ok(prepare >= 0 && movement > prepare && issued > movement);
});

test('shared direct stock issue engine giữ lock, FEFO/FIFO và chống thiếu hàng của Giao thủ công', async () => {
  const source = await readFile(enginePath, 'utf8');

  assert.match(source, /FOR UPDATE OF orders, version/);
  assert.match(source, /FOR UPDATE OF demand/);
  assert.match(source, /FOR UPDATE OF balance/);
  assert.match(source, /location\.is_active = true/);
  assert.match(source, /location\.location_type = 'storage'/);
  assert.match(source, /lot\.expiry_date >= CURRENT_DATE/);
  assert.match(source, /sales-fulfillment-scope/);
  assert.match(source, /expectedRevision/);
  assert.match(source, /MANUAL_STOCK_ISSUE/);
});

test('route Giao thủ công cũ giữ nguyên endpoint, permission và idempotent transaction', async () => {
  const source = await readFile(routePath, 'utf8');

  assert.match(source, /manual_stock_issue: 'sales\.sales_order\.manual_stock_issued'/);
  assert.match(source, /action === 'issue-stock' && method === 'POST'/);
  assert.match(source, /options\.PERMISSIONS\.coreDeliveryOrderIssueInventory/);
  assert.match(source, /executeIdempotentMutation\(req, res, options/);
  assert.match(source, /manualStockIssueService\.issueManualSalesOrderStock/);
});
