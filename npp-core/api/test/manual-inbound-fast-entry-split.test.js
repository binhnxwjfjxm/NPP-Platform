import assert from 'node:assert/strict';
import test from 'node:test';
import { manualInboundPreparationInternals } from '../src/services/manual-inbound-preparation.js';

const warehouseId = '11111111-1111-4111-8111-111111111111';

function normalize(rows) {
  return manualInboundPreparationInternals.normalizePreviewPayload({
    warehouseId,
    inboundType: 'MANUAL_RECEIPT',
    documentDate: '2026-09-17',
    rows,
  });
}

test('Nhập hàng thủ công vẫn gộp dòng thường trùng cùng điều kiện', () => {
  const result = normalize([
    { sku: 'SP-01', sourceQuantity: '1.25', locationCode: 'A-01' },
    { sku: 'sp-01', sourceQuantity: '2.75', locationCode: 'a-01' },
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.value.inputRowCount, 2);
  assert.equal(result.value.rows.length, 1);
  assert.equal(result.value.rows[0].sourceQuantity, '4');
  assert.deepEqual(result.value.rows[0].sourceLineNumbers, [1, 2]);
  assert.equal(result.value.rows[0].splitIdentity, null);
});

test('dòng đã Tách dòng giữ độc lập dù cùng SKU và cùng điều kiện', () => {
  const result = normalize([
    { sku: 'SP-01', sourceQuantity: '5', unitCost: '10000', splitIdentity: 'split_A' },
    { sku: 'SP-01', sourceQuantity: '1', unitCost: '10000', splitIdentity: 'split_B' },
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.value.inputRowCount, 2);
  assert.equal(result.value.rows.length, 2);
  assert.deepEqual(result.value.rows.map((row) => row.splitIdentity), ['split_A', 'split_B']);
  assert.deepEqual(result.value.rows.map((row) => row.sourceLineNumbers), [[1], [2]]);
});

test('định danh Tách dòng chỉ nhận ký tự an toàn và không được trùng', () => {
  const invalid = normalize([
    { sku: 'SP-01', sourceQuantity: '1', splitIdentity: 'split/bad' },
  ]);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, 'INVALID_SPLIT_IDENTITY');

  const duplicated = normalize([
    { sku: 'SP-01', sourceQuantity: '1', splitIdentity: 'split_A' },
    { sku: 'SP-01', sourceQuantity: '1', splitIdentity: 'split_A' },
  ]);
  assert.equal(duplicated.ok, false);
  assert.equal(duplicated.code, 'DUPLICATE_SPLIT_IDENTITY');
});
