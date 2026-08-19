import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  MIN_PRODUCT_SEARCH_LENGTH,
  normalizedProductSearchTerm,
} from '../lib/product-search-contract.js';
import { MIN_PURCHASE_ORDER_SKU_SEARCH_LENGTH } from '../lib/purchase-order-sku-entry.js';

const salesOrderSource = readFileSync(
  new URL('../app/sales/sales-orders/SalesOrderCommercialForm.tsx', import.meta.url),
  'utf8',
);
const purchasePriceSource = readFileSync(
  new URL('../app/purchasing/purchase-prices/PurchasePriceWorkspace.tsx', import.meta.url),
  'utf8',
);
const purchaseOrderSource = readFileSync(
  new URL('../app/purchasing/purchase-orders/components/PurchaseOrderEditorV4.tsx', import.meta.url),
  'utf8',
);
const purchaseOrderContractSource = readFileSync(
  new URL('../lib/purchase-order-sku-entry.js', import.meta.url),
  'utf8',
);
const mcpOrderSource = readFileSync(
  new URL('../../../mcp/src/features/orders/CoreOrderCreateSheet.tsx', import.meta.url),
  'utf8',
);

test('product search contract starts from the first character', () => {
  assert.equal(MIN_PRODUCT_SEARCH_LENGTH, 1);
  assert.equal(MIN_PURCHASE_ORDER_SKU_SEARCH_LENGTH, MIN_PRODUCT_SEARCH_LENGTH);
  assert.equal(normalizedProductSearchTerm(' D '), 'D');
  assert.equal(normalizedProductSearchTerm('   '), '');
});

test('all Company SKU entry surfaces use the shared first-character contract', () => {
  assert.match(purchaseOrderContractSource, /MIN_PURCHASE_ORDER_SKU_SEARCH_LENGTH = MIN_PRODUCT_SEARCH_LENGTH/);
  assert.match(purchaseOrderSource, /MIN_PURCHASE_ORDER_SKU_SEARCH_LENGTH/);
  assert.match(salesOrderSource, /term\.length < MIN_PRODUCT_SEARCH_LENGTH/);
  assert.match(purchasePriceSource, /term\.length < MIN_PRODUCT_SEARCH_LENGTH/);
  assert.doesNotMatch(salesOrderSource, /term\.length < 2/);
  assert.doesNotMatch(purchasePriceSource, /term\.length < 2/);
});

test('MCP ordering already searches as the user types and keeps no two-character gate', () => {
  assert.match(mcpOrderSource, /void loadProducts\(productSearch, productCategory, productBrand\)/);
  assert.doesNotMatch(mcpOrderSource, /productSearch(?:\.trim\(\))?\.length < 2/);
});
