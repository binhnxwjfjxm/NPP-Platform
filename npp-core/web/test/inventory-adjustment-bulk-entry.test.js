import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  MAX_BULK_INVENTORY_ADJUSTMENT_ROWS,
  bulkInventoryAdjustmentTemplateCsv,
  parseBulkInventoryAdjustmentSheet,
} from '../lib/inventory-adjustment-bulk-entry.js';

const bulkUiSource = readFileSync(
  new URL('../app/inventory/adjustments/bulk/bulk-workspace.tsx', import.meta.url),
  'utf8',
);
const gatewaySource = readFileSync(new URL('../lib/inventory-adjustment-gateway.ts', import.meta.url), 'utf8');

test('bulk adjustment sheet accepts minimum SKU and actual-stock columns', () => {
  const rows = parseBulkInventoryAdjustmentSheet([
    ['SKU', 'Số lượng tồn thực tế'],
    ['SKU001', '92'],
  ]);
  assert.deepEqual(rows, [{
    lineNumber: 2,
    sku: 'SKU001',
    actualQuantity: '92',
    locationCode: '',
    lotCode: '',
  }]);
});

test('bulk adjustment sheet keeps optional lot and location scope', () => {
  const rows = parseBulkInventoryAdjustmentSheet([
    ['SKU', 'Tồn thực tế', 'Vị trí', 'Lô'],
    ['SKU001', '8', 'A01', 'LO-001'],
  ]);
  assert.equal(rows[0].locationCode, 'A01');
  assert.equal(rows[0].lotCode, 'LO-001');
});

test('bulk adjustment sheet enforces row limit and required columns', () => {
  assert.equal(MAX_BULK_INVENTORY_ADJUSTMENT_ROWS, 200);
  assert.throws(
    () => parseBulkInventoryAdjustmentSheet([['SKU'], ['SKU001']]),
    /SKU và Tồn thực tế/,
  );
  const oversized = [['SKU', 'Tồn thực tế'], ...Array.from({ length: 201 }, (_, index) => [`SKU${index}`, '1'])];
  assert.throws(() => parseBulkInventoryAdjustmentSheet(oversized), /tối đa 200 dòng/i);
});

test('bulk adjustment UI follows the compact file-import workflow and stays usable for hundreds of rows', () => {
  assert.match(bulkInventoryAdjustmentTemplateCsv(), /SKU,Tồn thực tế,Vị trí,Lô/);
  assert.match(bulkUiSource, /Các bước điều chỉnh tồn hàng loạt/);
  assert.match(bulkUiSource, /Tải mẫu Excel\/CSV/);
  assert.match(bulkUiSource, /Chọn tệp đã điền/);
  assert.match(bulkUiSource, /Kiểm tra tệp/);
  assert.match(bulkUiSource, /Đi tới lập phiếu/);
  assert.match(bulkUiSource, /const DISPLAY_ROW_LIMIT = 100/);
  assert.match(bulkUiSource, /rows\.slice\(0, DISPLAY_ROW_LIMIT\)/);
  assert.match(bulkUiSource, /preview\.rows\.slice\(0, DISPLAY_ROW_LIMIT\)/);
  assert.match(bulkUiSource, /bulk-adjustment-import-table/);
  assert.match(bulkUiSource, /bulk-adjustment-preview-table/);
  assert.doesNotMatch(bulkUiSource, /styles\.lineCard/);
});

test('bulk adjustment preview remains read-only and confirmation keeps canonical idempotency', () => {
  assert.match(bulkUiSource, /Tồn hệ thống/);
  assert.match(bulkUiSource, /Tồn thực tế/);
  assert.match(bulkUiSource, /Hệ thống vẫn kiểm tra toàn bộ/);
  assert.match(bulkUiSource, /Tồn kho chưa thay đổi/);
  assert.match(bulkUiSource, /createIdempotencyKey\('inventory-adjustment-bulk'\)/);
  assert.match(gatewaySource, /previewBulkInventoryAdjustment/);
  assert.match(gatewaySource, /confirmBulkInventoryAdjustment/);
});
