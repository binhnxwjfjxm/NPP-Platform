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

test('fulfillment table groups product name and SKU without squeezing operational columns', () => {
  assert.match(fulfillment, /data-testid="fulfillment-product-table"/);
  assert.match(fulfillment, /<strong>\{item\.itemName\}<\/strong>/);
  assert.match(fulfillment, /<span>\{item\.sku\}<\/span>/);
  assert.match(fulfillment, /formatQuantity\(item\.orderedBaseQuantity\).*item\.unitCode/);

  assert.match(operationalStyles, /content:\s*'Sản phẩm \/ SKU'/);
  assert.match(operationalStyles, /content:\s*'Đặt \/ ĐVT'/);
  assert.match(operationalStyles, /button > span:nth-child\(2\)[\s\S]*grid-column:\s*1/);
  assert.match(operationalStyles, /button > strong[\s\S]*white-space:\s*normal/);
  assert.match(operationalStyles, /button > span:nth-child\(n \+ 3\):nth-child\(-n \+ 6\)[\s\S]*text-align:\s*right/);
  assert.match(operationalStyles, /fulfillment-product-table'\][\s\S]*min-width:\s*780px/);
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
