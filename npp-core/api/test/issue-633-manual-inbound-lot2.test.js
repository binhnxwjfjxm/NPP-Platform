import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { manualInboundPreparationInternals } from '../src/services/manual-inbound-preparation.js';

const preparationSource = await readFile(new URL('../src/services/manual-inbound-preparation.js', import.meta.url), 'utf8');
const routeSource = await readFile(new URL('../src/routes/manual-inbound.js', import.meta.url), 'utf8');

const warehouseId = '11111111-1111-4111-8111-111111111111';

test('Lô 2 chuẩn hóa header và gộp dòng trùng cùng điều kiện bằng số thập phân chính xác', () => {
  const result = manualInboundPreparationInternals.normalizePreviewPayload({
    warehouseId,
    inboundType: 'MANUAL_RECEIPT',
    documentDate: '2026-08-18',
    rows: [
      { sku: ' sp-01 ', sourceQuantity: '1.25', locationCode: ' a-01 ' },
      { sku: 'SP-01', sourceQuantity: '2.75', locationCode: 'A-01' },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.rows.length, 1);
  assert.equal(result.value.rows[0].sku, 'SP-01');
  assert.equal(result.value.rows[0].sourceQuantity, '4');
  assert.deepEqual(result.value.rows[0].sourceLineNumbers, [1, 2]);
  assert.equal(result.value.inputRowCount, 2);
});

test('Lô 2 giữ semantic loại Khác bắt buộc ghi chú', () => {
  const result = manualInboundPreparationInternals.normalizePreviewPayload({
    warehouseId,
    inboundType: 'OTHER',
    documentDate: '2026-08-18',
    rows: [{ sku: 'SP-01', sourceQuantity: '1' }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'MANUAL_INBOUND_NOTE_REQUIRED');
});

test('Lô 2 preview là read-only và fail-closed theo chính sách quản lý tồn', () => {
  assert.match(preparationSource, /information_schema\.columns/);
  assert.match(preparationSource, /is_inventory_managed/);
  assert.match(preparationSource, /INVENTORY_POLICY_UNAVAILABLE/);
  assert.match(preparationSource, /SKU_NOT_INVENTORY_MANAGED/);
  assert.match(preparationSource, /inventory_cost_balances/);
  assert.match(preparationSource, /product_tracking_policies/);
  assert.doesNotMatch(preparationSource, /\bINSERT\s+INTO\b/i);
  assert.doesNotMatch(preparationSource, /\bUPDATE\s+inventory\./i);
  assert.doesNotMatch(preparationSource, /\bDELETE\s+FROM\b/i);
});

test('điểm ghi sổ Lô 1 không thể bỏ qua chính sách quản lý tồn', () => {
  assert.match(routeSource, /validateManualInboundPostInventoryPolicy/);
  assert.match(routeSource, /operator\/preview/);
  const policyCheck = routeSource.indexOf('validateManualInboundPostInventoryPolicy(options.getPool()');
  const posting = routeSource.indexOf('postManualInbound({');
  assert.ok(policyCheck > 0 && posting > policyCheck);
});
