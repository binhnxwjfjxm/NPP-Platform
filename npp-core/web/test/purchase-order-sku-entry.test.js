import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_PURCHASE_ORDER_SKU_SEARCH_LENGTH,
  PURCHASE_ORDER_SKU_FILTERS,
  filterPurchaseOrderSkuOptions,
  groupPurchaseOrderSkuOptions,
  normalizePurchaseOrderSkuSearchFailure,
  purchaseOrderBulkTemplate,
} from '../lib/purchase-order-sku-entry.js';

test('requires at least two characters for quick search', () => {
  assert.equal(MIN_PURCHASE_ORDER_SKU_SEARCH_LENGTH, 2);
});

test('remaps legacy missing-order response from dedicated SKU search', () => {
  const result = normalizePurchaseOrderSkuSearchFailure({
    code: 'PURCHASE_ORDER_NOT_FOUND',
    message: 'Purchase order was not found',
    statusCode: 404,
  });
  assert.equal(result.code, 'PURCHASE_ORDER_SKU_SEARCH_UNAVAILABLE');
  assert.equal(result.statusCode, 503);
  assert.match(result.message, /chưa được cập nhật đồng bộ/i);
});

test('filters eligible and setup-required SKU rows', () => {
  const rows = [
    { id: '1', eligibility: { selectable: true } },
    { id: '2', eligibility: { selectable: false } },
  ];
  assert.deepEqual(filterPurchaseOrderSkuOptions(rows, PURCHASE_ORDER_SKU_FILTERS.eligible).map((row) => row.id), ['1']);
  assert.deepEqual(filterPurchaseOrderSkuOptions(rows, PURCHASE_ORDER_SKU_FILTERS.setup).map((row) => row.id), ['2']);
  assert.equal(filterPurchaseOrderSkuOptions(rows, PURCHASE_ORDER_SKU_FILTERS.all).length, 2);
});

test('groups SKU rows by product for browse mode', () => {
  const groups = groupPurchaseOrderSkuOptions([
    { id: 'v2', productId: 'p1', productCode: 'P1', productName: 'Một', sku: 'P1-B' },
    { id: 'v1', productId: 'p1', productCode: 'P1', productName: 'Một', sku: 'P1-A' },
    { id: 'v3', productId: 'p2', productCode: 'P2', productName: 'Hai', sku: 'P2-A' },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].options.length, 2);
});

test('bulk template uses Vietnamese business headings', () => {
  const template = purchaseOrderBulkTemplate();
  assert.match(template, /Số lượng/);
  assert.match(template, /Kiểu chiết khấu/);
  assert.doesNotMatch(template, /TOTAL_AMOUNT/);
});
