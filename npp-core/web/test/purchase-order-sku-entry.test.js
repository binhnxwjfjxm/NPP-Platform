import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_PURCHASE_ORDER_SKU_SEARCH_LENGTH,
  PURCHASE_ORDER_BULK_TEMPLATE_FILENAME,
  PURCHASE_ORDER_BULK_TEMPLATE_MIME,
  PURCHASE_ORDER_SKU_FILTERS,
  filterPurchaseOrderSkuOptions,
  groupPurchaseOrderSkuOptions,
  normalizePurchaseOrderSkuSearchFailure,
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
  assert.equal(result.retryable, true);
  assert.match(result.message, /chưa được cập nhật đồng bộ/i);
});

test('does not infer version skew from a message without the stable code', () => {
  const result = normalizePurchaseOrderSkuSearchFailure({
    code: 'OTHER_NOT_FOUND',
    message: 'Purchase order was not found',
    statusCode: 404,
  });
  assert.equal(result.code, 'OTHER_NOT_FOUND');
  assert.equal(result.statusCode, 404);
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

test('bulk template contract is a real XLSX download', () => {
  assert.equal(PURCHASE_ORDER_BULK_TEMPLATE_FILENAME, 'mau-nhap-don-dat-hang.xlsx');
  assert.equal(PURCHASE_ORDER_BULK_TEMPLATE_MIME, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});
