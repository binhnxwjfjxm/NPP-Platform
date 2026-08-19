import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const numberingSource = read('lib/business-table-numbering.ts');
const numberingJavascript = ts.transpileModule(numberingSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const numbering = await import(`data:text/javascript;base64,${Buffer.from(numberingJavascript).toString('base64')}`);

const rolloutPaths = [
  'app/purchasing/purchase-orders/components/PurchaseOrderList.tsx',
  'app/purchasing/goods-receipts/GoodsReceiptWorkspace.tsx',
  'app/purchasing/supplier-returns/SupplierReturnWorkspace.tsx',
  'app/purchasing/purchase-prices/PurchasePriceWorkspace.tsx',
  'app/accounting/payables/page.tsx',
  'app/accounting/receivables/page.tsx',
  'app/accounting/customer-payments/customer-payment-workspace.tsx',
  'app/accounting/supplier-payments/supplier-payment-workspace.tsx',
  'app/accounting/customer-return-credits/customer-return-credit-workspace.tsx',
  'app/inventory/balances/inventory-balances-workspace.tsx',
  'app/inventory/manual-inbounds/manual-inbound-workspace.tsx',
  'app/inventory/inventory-scoped-workspace.tsx',
  'app/components/inventory-reporting-workspace.tsx',
  'app/components/gross-margin-reporting-workspace.tsx',
  'app/components/reporting-dashboard-workspace.tsx',
  'app/inventory/costing/workspace.tsx',
  'app/inventory/opening-balances/opening-balance-csv-workspace.tsx',
  'app/customers/customer-workspace.tsx',
  'app/suppliers/supplier-workspace.tsx',
  'app/products/product-workspace.tsx',
];

test('business table numbering is one-based and continues across pages', () => {
  const { businessTablePageOffset, businessTableRowNumber } = numbering;
  assert.equal(businessTableRowNumber(0), 1);
  assert.equal(businessTableRowNumber(4), 5);
  assert.equal(businessTablePageOffset(1, 20), 0);
  assert.equal(businessTablePageOffset(2, 20), 20);
  assert.equal(businessTableRowNumber(0, businessTablePageOffset(2, 20)), 21);
  assert.equal(businessTableRowNumber(9, businessTablePageOffset(3, 10)), 30);
});

test('filtering and sorting use the rendered result index before pagination offset', () => {
  const { businessTablePageOffset, businessTableRowNumber } = numbering;
  const rows = [
    { id: 'a', amount: 10, visible: true },
    { id: 'b', amount: 40, visible: false },
    { id: 'c', amount: 30, visible: true },
    { id: 'd', amount: 20, visible: true },
  ]
    .filter((row) => row.visible)
    .sort((left, right) => right.amount - left.amount);
  const offset = businessTablePageOffset(2, 3);
  assert.deepEqual(rows.map((row) => row.id), ['c', 'd', 'a']);
  assert.deepEqual(rows.map((_, rowIndex) => businessTableRowNumber(rowIndex, offset)), [4, 5, 6]);
});

test('business table sequence exposes office-language STT through one shared component', () => {
  const componentSource = read('app/components/business-table-sequence.tsx');
  assert.match(componentSource, /BUSINESS_TABLE_SEQUENCE_HEADER/);
  assert.match(componentSource, /aria-label="Số thứ tự"/);
  assert.match(componentSource, /businessTableRowNumber\(rowIndex, offset\)/);
  assert.match(componentSource, /BusinessSequenceNumber/);
  assert.match(componentSource, /data-business-sequence/);
  assert.doesNotMatch(componentSource, /rowIndex\s*\+\s*1/);
});

test('primary business list tables use the shared STT convention', () => {
  for (const path of rolloutPaths) {
    const source = read(path);
    assert.match(source, /BusinessTableSequenceHeader/);
    assert.match(source, /BusinessTableSequenceCell/);
  }

  const purchaseOrders = read(rolloutPaths[0]);
  assert.match(purchaseOrders, /rowNumberOffset\s*=\s*0/);
  assert.match(purchaseOrders, /BusinessTableSequenceCell rowIndex=\{rowIndex\} offset=\{rowNumberOffset\}/);

  const goodsReceipts = read(rolloutPaths[1]);
  assert.match(goodsReceipts, /visibleItems\.map\(\(goodsReceipt, rowIndex\)/);
  assert.match(goodsReceipts, /BusinessTableSequenceCell rowIndex=\{rowIndex\}/);

  const supplierReturns = read(rolloutPaths[2]);
  assert.match(supplierReturns, /visibleItems\.map\(\(supplierReturn, rowIndex\)/);
  assert.match(supplierReturns, /BusinessTableSequenceCell rowIndex=\{rowIndex\}/);

  const purchasePrices = read(rolloutPaths[3]);
  assert.match(purchasePrices, /visiblePrices\.map\(\(price, rowIndex\)/);
  assert.match(purchasePrices, /BusinessTableSequenceCell rowIndex=\{rowIndex\}/);

  const returnCredits = read(rolloutPaths[8]);
  assert.match(returnCredits, /credits\.map\(\(credit, rowIndex\)/);
  assert.match(returnCredits, /BusinessTableSequenceCell rowIndex=\{rowIndex\}/);
  assert.match(returnCredits, /createIdempotencyKey\('customer-return-credit'\)/);
  assert.doesNotMatch(returnCredits, /Credit từ hàng khách trả/);
  assert.doesNotMatch(returnCredits, /Customer Return đã nhận/);

  const inventoryBalances = read(rolloutPaths[9]);
  assert.match(inventoryBalances, /filteredBalances\.map\(\(balance, rowIndex\)/);
  assert.match(inventoryBalances, /BusinessTableSequenceCell rowIndex=\{rowIndex\}/);

  const manualInboundHistory = read(rolloutPaths[10]);
  assert.match(manualInboundHistory, /history\.map\(\(document, rowIndex\)/);
  assert.match(manualInboundHistory, /BusinessTableSequenceCell rowIndex=\{rowIndex\}/);

  const scopedInventory = read(rolloutPaths[11]);
  assert.match(scopedInventory, /filteredBalances\.map\(\(balance, rowIndex\)/);
  assert.match(scopedInventory, /filteredLots\.map\(\(lot, rowIndex\)/);

  const customers = read(rolloutPaths[17]);
  assert.match(customers, /visibleCustomers\.map\(\(customer, rowIndex\)/);
  assert.match(customers, /groups\.map\(\(group, rowIndex\)/);

  const suppliers = read(rolloutPaths[18]);
  assert.match(suppliers, /visibleSuppliers\.map\(\(supplier, rowIndex\)/);
  assert.match(suppliers, /BusinessTableSequenceCell rowIndex=\{rowIndex\}/);

  const products = read(rolloutPaths[19]);
  assert.match(products, /visibleProducts\.map\(\(product, rowIndex\)/);
  assert.match(products, /variants\.map\(\(variant, rowIndex\)/);
  assert.match(products, /categories\.map\(\(category, rowIndex\)/);
  assert.match(products, /brands\.map\(\(brand, rowIndex\)/);
});

test('sales order and inventory operations keep their visible sequence on the shared generator', () => {
  const salesOrders = read('app/sales/sales-orders/SalesOrderWorkspace.tsx');
  const salesOrderDetail = read('app/sales/sales-orders/SalesOrderDetail.tsx');
  const salesOrderForm = read('app/sales/sales-orders/SalesOrderCommercialForm.tsx');
  const holds = read('app/components/stock-hold-breakdown.tsx');
  const fulfillment = read('app/inventory/fulfillment/fulfillment-workspace.tsx');
  const transfers = read('app/inventory/transfers/transfer-workspace.tsx');

  assert.match(salesOrders, /filtered\.map\(\(order, rowIndex\)/);
  assert.match(salesOrders, /BusinessSequenceNumber rowIndex=\{rowIndex\}/);
  assert.match(salesOrderDetail, /fulfillment\.lines\.map\(\(line, rowIndex\)/);
  assert.match(salesOrderDetail, /\(current\.lines \?\? \[\]\)\.map\(\(line, rowIndex\)/);
  assert.match(salesOrderForm, /BusinessSequenceNumber rowIndex=\{index\}/);
  assert.match(holds, /BusinessSequenceNumber rowIndex=\{index\}/);
  assert.match(fulfillment, /selectedOrder\.items\.map\(\(item, rowIndex\)/);
  assert.match(transfers, /filteredTransfers\.map\(\(transfer, rowIndex\)/);
});
