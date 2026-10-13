import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  parseManualReturnQuantity, formatManualReturnQuantity,
  getManualReturnEligibility, receiveManualOrderReturn,
} from '../src/services/sales-manual-return.js';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('lượng hàng nhập trả dùng số thập phân chính xác, không dùng float', () => {
  assert.equal(parseManualReturnQuantity('2.125'), 2125000000000n);
  assert.equal(formatManualReturnQuantity(parseManualReturnQuantity('2.125')), '2.125000000000');
  assert.equal(parseManualReturnQuantity('0'), 0n);
  for (const value of ['-1', '1e5', '1,5', '1.1234567890123', 'abc']) {
    assert.equal(parseManualReturnQuantity(value), null);
  }
});

test('chặn mode/ID không hợp lệ trước khi thay đổi tồn', async () => {
  const bomb = { query: () => { throw new Error('must not query'); } };
  const requestContext = { installationId: 'local', scopes: { warehouseIds: [] } };
  assert.equal((await getManualReturnEligibility(bomb, { requestContext, id: 'bad' })).code, 'INVALID_SALES_ORDER_ID');
  assert.equal((await receiveManualOrderReturn(bomb, {
    requestContext, id: 'bad', payload: { mode: 'ALL' }, idempotencyKey: 'local-test',
  })).code, 'INVALID_SALES_ORDER_ID');
});

test('migration giữ dòng xuất gốc, ràng buộc phiếu nhận và chống nhận vượt', () => {
  const migration = CORE_API_MIGRATIONS.find(entry => entry.id === '165_manual_delivery_return_receipts');
  assert.ok(migration);
  assert.match(migration.sql, /CREATE TABLE sales\.manual_delivery_return_receipts/);
  assert.match(migration.sql, /CREATE TABLE sales\.manual_delivery_return_lines/);
  assert.match(migration.sql, /issue_movement_line_id uuid NOT NULL/);
  assert.match(migration.sql, /already_returned \+ NEW\.returned_base_quantity > source_row\.issued_quantity/);
  assert.match(migration.sql, /manual_delivery_return_immutable/);
  assert.match(migration.sql, /MANUAL_SALES_ORDER_STOCK_ISSUE/);
});

test('nhập trả có xuất nguồn, warehouse scope, khóa đơn và movement IN riêng', () => {
  const src = read('../src/services/sales-manual-return.js');
  const ledger = read('../src/services/sales-inventory-ledger.js');
  assert.match(src, /FOR UPDATE OF orders/);
  assert.match(src, /MANUAL_SALES_ORDER_STOCK_ISSUE/);
  assert.match(src, /source\.issue_line_id/);
  assert.match(src, /SALES_MANUAL_UNDELIVERED_RETURN/);
  assert.match(src, /postServerOwnedSalesMovement/);
  assert.match(src, /requestContext\.scopes\?\.warehouseIds/);
  assert.match(src, /MANUAL_RETURN_EXCEEDS_ISSUED/);
  assert.match(src, /order\.status !== 'confirmed'/);
  assert.match(ledger, /SALES_MANUAL_UNDELIVERED_RETURN/);
});

test('công nợ chỉ ghi hàng khách nhận sau khi trừ số đã nhập trả', () => {
  const source = read('../src/services/sales-manual-completion.js');
  assert.match(source, /resolveCompletionFacts/);
  assert.match(source, /manual_delivery_return_receipts/);
  assert.match(source, /accepted_base_quantity/);
  assert.match(source, /originalAmount: completionFacts\.total/);
  assert.match(source, /amount: completionFacts\.total/);
  assert.match(source, /completionFacts\.hasReturns \? 'partially_delivered'/);
});

test('UX hai nút: toàn đơn xác nhận một lần; một phần chọn mã và số lượng', () => {
  const view = read('../../web/app/sales/sales-orders/ManualSalesOrderReturns.tsx');
  const detail = read('../../web/app/sales/sales-orders/SalesOrderDetail.tsx');
  assert.match(view, /Trả nguyên đơn/);
  assert.match(view, /Trả một phần/);
  assert.match(view, /window\.confirm/);
  assert.match(view, /Xác nhận nhập trả/);
  assert.match(view, /salesOrderLineId/);
  assert.match(detail, /<ManualSalesOrderReturns/);
});
