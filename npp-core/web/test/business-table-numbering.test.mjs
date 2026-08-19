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
  'app/accounting/payables/page.tsx',
  'app/accounting/receivables/page.tsx',
  'app/accounting/customer-payments/customer-payment-workspace.tsx',
  'app/accounting/supplier-payments/supplier-payment-workspace.tsx',
  'app/inventory/balances/inventory-balances-workspace.tsx',
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
  assert.doesNotMatch(componentSource, /rowIndex\s*\+\s*1/);
});

test('primary business list tables use the shared STT convention instead of local formulas', () => {
  for (const path of rolloutPaths) {
    const source = read(path);
    assert.match(source, /BusinessTableSequenceHeader/);
    assert.match(source, /BusinessTableSequenceCell/);
    assert.doesNotMatch(source, /(?:rowIndex|index)\s*\+\s*1/);
  }

  const purchaseOrders = read(rolloutPaths[0]);
  assert.match(purchaseOrders, /rowNumberOffset\s*=\s*0/);
  assert.match(purchaseOrders, /BusinessTableSequenceCell rowIndex=\{rowIndex\} offset=\{rowNumberOffset\}/);

  const inventoryBalances = read(rolloutPaths[5]);
  assert.match(inventoryBalances, /filteredBalances\.map\(\(balance, rowIndex\)/);
  assert.match(inventoryBalances, /BusinessTableSequenceCell rowIndex=\{rowIndex\}/);
});
