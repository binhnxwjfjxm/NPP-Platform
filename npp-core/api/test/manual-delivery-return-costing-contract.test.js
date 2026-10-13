import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manual = readFileSync(new URL('../src/services/sales-manual-return.js', import.meta.url), 'utf8');
const legacy = readFileSync(new URL('../src/services/inventory-costing.js', import.meta.url), 'utf8');
const period = readFileSync(new URL('../src/services/inventory-costing-period-resolution.js', import.meta.url), 'utf8');

test('hàng chưa giao nhập trả giữ đúng mã dòng xuất kho để lấy giá vốn gốc', () => {
  assert.match(manual, /originalInventoryMovementLineId: source\.issue_line_id/);
  assert.match(manual, /sourceLineId: source\.issue_line_id/);
  assert.match(legacy, /originalInventoryMovementLineId/);
  assert.match(period, /originalInventoryMovementLineId/);
});

test('hai bộ tính giá vốn đều từ chối nhập trả nếu không tìm được giá vốn gốc', () => {
  assert.match(legacy, /\['SALES_CUSTOMER_RETURN', 'SALES_MANUAL_UNDELIVERED_RETURN'\]\.includes\(row\.movement_type\)/);
  assert.match(period, /\['SALES_CUSTOMER_RETURN', 'SALES_MANUAL_UNDELIVERED_RETURN'\]\.includes\(row\.movement_type\)/);
  assert.match(legacy, /MANUAL_RETURN_ORIGINAL_COST_MISSING/);
  assert.match(period, /MANUAL_RETURN_ORIGINAL_COST_MISSING/);
});
