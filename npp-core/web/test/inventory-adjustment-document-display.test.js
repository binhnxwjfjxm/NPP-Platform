import test from 'node:test';
import assert from 'node:assert/strict';
import { adjustmentLineDisplay } from '../lib/inventory-adjustment-document-display.js';

const row = { baseQuantity: '8', systemBaseQuantity: '1712', countedBaseQuantity: '1704' };

test('imported decrease remains intelligible after posting without consulting current stock', () => {
  const display = adjustmentLineDisplay({
    documentKind: 'MANUAL_ADJUSTMENT', adjustmentDirection: 'OUT',
    reconciliationBatchCode: 'DS-20261108-X', status: 'POSTED',
  }, row, '2100');
  assert.equal(display.before, '1712');
  assert.equal(display.delta, '-8');
  assert.equal(display.after, '1704');
  assert.equal(display.beforeLabel, 'Tồn hệ thống khi lập phiếu');
  assert.equal(display.afterLabel, 'Tồn kiểm kê theo file');
});

test('imported increase uses the same immutable import snapshot before and after posting', () => {
  const document = {
    documentKind: 'MANUAL_ADJUSTMENT', adjustmentDirection: 'IN',
    reconciliationBatchCode: 'DS-20261108-X', status: 'APPROVED',
  };
  const imported = { baseQuantity: '92', systemBaseQuantity: '1712', countedBaseQuantity: '1804' };
  assert.deepEqual(
    [adjustmentLineDisplay(document, imported, '1700').before,
      adjustmentLineDisplay(document, imported, '1700').delta,
      adjustmentLineDisplay(document, imported, '1700').after],
    ['1712', '92', '1804'],
  );
  assert.equal(adjustmentLineDisplay({ ...document, status: 'POSTED' }, imported, '999').after, '1804');
});

test('manual pending adjustment previews current stock; posted without snapshot does not fake history', () => {
  const document = {
    documentKind: 'MANUAL_ADJUSTMENT', adjustmentDirection: 'OUT',
    reconciliationBatchCode: null, status: 'APPROVED',
  };
  const line = { baseQuantity: '8', systemBaseQuantity: null, countedBaseQuantity: null };
  assert.deepEqual(
    [adjustmentLineDisplay(document, line, '1712').before, adjustmentLineDisplay(document, line, '1712').after],
    ['1712', '1704'],
  );
  const posted = adjustmentLineDisplay({ ...document, status: 'POSTED' }, line, '2000');
  assert.equal(posted.before, null);
  assert.equal(posted.after, null);
});
