import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const servicePath = fileURLToPath(new URL('../src/services/sales-manual-stock-issue.js', import.meta.url));
const routePath = fileURLToPath(new URL('../src/routes/sales-orders.js', import.meta.url));

test('manual stock issue uses canonical inventory ledger without receivable side effects', async () => {
  const source = await readFile(servicePath, 'utf8');

  assert.match(source, /createIdempotencyKey/);
  assert.match(source, /IDEMPOTENCY_KEY_PATTERN/);
  assert.match(source, /postServerOwnedSalesMovement/);
  assert.match(source, /movementType: 'SALES_DELIVERY_ISSUE'/);
  assert.match(source, /sourceDocumentType: 'SALES_ORDER'/);
  assert.doesNotMatch(source, /receivable/i);

  const prepare = source.indexOf('const prepared = await prepareDemandsForIssue');
  const movement = source.indexOf('const movementResult = await postServerOwnedSalesMovement');
  const issued = source.indexOf('const updated = await markDemandsIssued');
  assert.ok(prepare >= 0 && movement > prepare && issued > movement);
});

test('manual stock issue locks business scope and rejects invalid stock candidates', async () => {
  const source = await readFile(servicePath, 'utf8');

  assert.match(source, /FOR UPDATE OF orders, version/);
  assert.match(source, /FOR UPDATE OF demand/);
  assert.match(source, /FOR UPDATE OF balance/);
  assert.match(source, /location\.is_active = true/);
  assert.match(source, /location\.location_type = 'storage'/);
  assert.match(source, /lot\.expiry_date >= CURRENT_DATE/);
  assert.match(source, /MANUAL_STOCK_ISSUE_SHORTAGE/);
  assert.match(source, /expectedRevision/);
});

test('sales order route exposes one idempotent manual stock issue mutation with existing inventory authority', async () => {
  const source = await readFile(routePath, 'utf8');

  assert.match(source, /manual_stock_issue: 'sales\.sales_order\.manual_stock_issued'/);
  assert.match(source, /action === 'issue-stock' && method === 'POST'/);
  assert.match(source, /options\.PERMISSIONS\.coreDeliveryOrderIssueInventory/);
  assert.match(source, /executeIdempotentMutation\(req, res, options/);
  assert.match(source, /manualStockIssueService\.issueManualSalesOrderStock/);
});
