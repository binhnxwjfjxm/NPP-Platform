import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('Issue #1190 Lô 2 reuses the shared spreadsheet foundation', () => {
  const component = read('app/components/operational-export-actions.tsx');
  assert.match(component, /exportTable/);
  assert.match(component, /\/api\/data-exchange\/workbook-xlsx/);
  assert.match(component, /Xuất Excel/);
  assert.match(component, /Xuất CSV/);
  assert.doesNotMatch(component, /window\.open|document\.body\.innerHTML/);
});

test('Issue #1190 Lô 2 wires exports into all locked operational screens', () => {
  const files = [
    'app/sales/order-management/OrderManagementWorkspace.tsx',
    'app/purchasing/goods-receipts/GoodsReceiptWorkspace.tsx',
    'app/purchasing/supplier-returns/SupplierReturnWorkspace.tsx',
    'app/inventory/customer-returns/customer-return-workspace.tsx',
    'app/logistics/delivery-attempts/delivery-attempt-workspace.tsx',
    'app/accounting/customer-payments/customer-payment-workspace.tsx',
    'app/accounting/supplier-payments/supplier-payment-workspace.tsx',
    'app/accounting/customer-return-credits/customer-return-credit-workspace.tsx',
    'app/accounting/receivables/page.tsx',
    'app/accounting/payables/page.tsx',
    'app/purchasing/purchase-prices/PurchasePriceWorkspace.tsx',
  ].map(read);
  for (const source of files) assert.match(source, /OperationalExportActions/);
});

test('filtered exports use the same in-screen filtered collections', () => {
  assert.match(read('app/sales/order-management/OrderManagementWorkspace.tsx'), /rows: filteredOrders\.map/);
  assert.match(read('app/purchasing/goods-receipts/GoodsReceiptWorkspace.tsx'), /rows: visibleItems\.map/);
  assert.match(read('app/purchasing/supplier-returns/SupplierReturnWorkspace.tsx'), /rows: visibleItems\.map/);
  assert.match(read('app/purchasing/purchase-prices/PurchasePriceWorkspace.tsx'), /rows: visiblePrices\.map/);
});

test('financial multi-table screens stay in one workbook', () => {
  const receivables = read('app/accounting/receivables/page.tsx');
  const payables = read('app/accounting/payables/page.tsx');
  const credits = read('app/accounting/customer-return-credits/customer-return-credit-workspace.tsx');
  assert.match(receivables, /sheetName: 'Số dư phải thu'/);
  assert.match(receivables, /sheetName: 'Chứng từ phải thu'/);
  assert.match(payables, /sheetName: 'Số dư phải trả'/);
  assert.match(payables, /sheetName: 'Chứng từ phải trả'/);
  assert.match(credits, /sheetName: 'Giảm công nợ'/);
  assert.match(credits, /sheetName: 'Hoàn tiền'/);
});
