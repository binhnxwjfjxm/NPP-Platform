import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const globalStyles = source('../app/globals.css');
const operationalStyles = source('../app/operational-tables.css');
const fulfillment = source('../app/inventory/fulfillment/fulfillment-workspace.tsx');
const inventoryBalances = source('../app/inventory/balances/inventory-balances-workspace.tsx');
const reconciliation = source('../app/logistics/trip-reconciliation/trip-reconciliation-workspace.tsx');

test('issue 615 lot 4 loads one shared operational table presentation contract', () => {
  assert.match(globalStyles, /@import '\.\/operational-tables\.css';/);
  assert.match(operationalStyles, /fulfillment-product-table/);
  assert.match(operationalStyles, /inventory-balances-page/);
  assert.match(operationalStyles, /trip-reconciliation-workspace/);
  assert.match(operationalStyles, /font-variant-numeric:\s*tabular-nums/);
});

test('fulfillment table keeps product identity, stock context and inline allocation readable', () => {
  assert.match(fulfillment, /data-testid="fulfillment-product-table"/);
  assert.match(fulfillment, /<strong>\{item\.itemName\}<\/strong><small>\{item\.sku\}<\/small>/);
  assert.match(fulfillment, /orderedQuantityLabel\(item\)/);
  assert.match(fulfillment, /Sản phẩm \/ SKU/);
  assert.match(fulfillment, /Khách đặt → Kho/);
  assert.match(fulfillment, /Tồn thực tế/);
  assert.match(fulfillment, /Đơn khác giữ/);
  assert.match(fulfillment, /Khả dụng/);
  assert.match(fulfillment, /SL PB/);
  assert.match(fulfillment, /fulfillment-allocation-quantity-/);
  assert.match(fulfillment, /fulfillment-allocate-quantity-/);
  assert.match(fulfillment, /PB đủ/);

  assert.match(operationalStyles, /fulfillment-product-table'\] > div[\s\S]*display:\s*grid/);
  assert.match(operationalStyles, /grid-template-columns:[\s\S]*minmax\(240px, 1\.6fr\)/);
  assert.match(operationalStyles, /fulfillment-product-table'\] > div > span:first-child[\s\S]*text-align:\s*left/);
  assert.match(operationalStyles, /fulfillment-product-table'\] > div > input[\s\S]*text-align:\s*right/);
  assert.match(operationalStyles, /span:nth-child\(9\)[\s\S]*display:\s*flex/);
  assert.match(operationalStyles, /fulfillment-product-table'\][\s\S]*min-width:\s*1480px/);
});

test('inventory and trip reconciliation keep product identity readable and numeric columns aligned', () => {
  assert.match(inventoryBalances, /<th>Sản phẩm \/ SKU<\/th>/);
  assert.match(inventoryBalances, /balance\.product_name/);
  assert.match(inventoryBalances, /balance\.base_sku/);
  assert.match(inventoryBalances, /<InventoryQuantity balance=\{balance\} value=\{balance\.on_hand_quantity\}/);
  assert.match(operationalStyles, /inventory-balances-page'\] table[\s\S]*min-width:\s*980px/);
  assert.match(operationalStyles, /inventory-balances-page'\] td:nth-child\(n \+ 5\):nth-child\(-n \+ 7\)[\s\S]*text-align:\s*right/);

  assert.match(reconciliation, /\{line\.sku\} · \{line\.itemName\}/);
  assert.match(reconciliation, /formatExactDecimal\(line\.issuedBaseQuantity\)/);
  assert.match(reconciliation, /formatExactDecimal\(line\.outstandingBaseQuantity\)/);
  assert.match(operationalStyles, /trip-reconciliation-workspace'\] table[\s\S]*min-width:\s*860px/);
  assert.match(operationalStyles, /trip-reconciliation-workspace'\] td:nth-child\(n \+ 3\):nth-child\(-n \+ 6\)[\s\S]*text-align:\s*right/);
});
