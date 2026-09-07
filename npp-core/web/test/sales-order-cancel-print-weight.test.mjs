import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const detail = read('../app/sales/sales-orders/SalesOrderDetail.tsx');
const print = read('../app/sales/sales-orders/SalesOrderPrintSheet.tsx');

test('đơn bán hàng đã huỷ vẫn hiển thị hành động in mà không cần hồi sinh chứng từ', () => {
  assert.match(detail, /current && \['confirmed', 'closed', 'cancelled'\]\.includes\(order\.status\)/);
  assert.doesNotMatch(detail, /current && order\.number && \['confirmed', 'closed'\]\.includes\(order\.status\)/);
});

test('khối lượng nằm trong vùng thông tin đầu phiếu và không còn trong khu vực tổng tiền', () => {
  const metaStart = print.indexOf('meta={[');
  const columnsStart = print.indexOf('columns={[', metaStart);
  const totalsStart = print.indexOf('totals={[', columnsStart);
  const noteStart = print.indexOf('note={', totalsStart);

  assert.ok(metaStart >= 0 && columnsStart > metaStart && totalsStart > columnsStart && noteStart > totalsStart);
  const metaBlock = print.slice(metaStart, columnsStart);
  const totalsBlock = print.slice(totalsStart, noteStart);

  assert.match(metaBlock, /key: 'customer', label: 'Khách hàng'/);
  assert.match(metaBlock, /key: 'document_date', label: 'Ngày đơn'/);
  assert.match(metaBlock, /key: 'total_weight', label: 'Khối lượng'[\s\S]*missingWeightLineCount > 0 \? 'Chưa đủ dữ liệu' : formatWeightKg\(version\.totalWeightKg\)[\s\S]*full: true/);
  assert.ok(metaBlock.indexOf("key: 'customer'") < metaBlock.indexOf("key: 'document_date'"));
  assert.ok(metaBlock.indexOf("key: 'document_date'") < metaBlock.indexOf("key: 'total_weight'"));
  assert.doesNotMatch(totalsBlock, /total_weight|Tổng khối lượng/);
});

test('khối lượng in làm tròn half-up tối đa 2 số lẻ và bỏ số 0 dư', () => {
  const formatter = /function formatWeightKg\(value: string \| null \| undefined\): string \{([\s\S]*?)\n\}/.exec(print);
  assert.ok(formatter, 'Không tìm thấy formatter khối lượng');
  const formatWeightKg = new Function('value', formatter[1]);

  assert.equal(formatWeightKg('25'), '25 kg');
  assert.equal(formatWeightKg('25.5'), '25,5 kg');
  assert.equal(formatWeightKg('25.678'), '25,68 kg');
  assert.equal(formatWeightKg('1.333333'), '1,33 kg');
  assert.equal(formatWeightKg('1.335'), '1,34 kg');
  assert.equal(formatWeightKg('999.999'), '1.000 kg');
  assert.equal(formatWeightKg(null), 'Chưa đủ dữ liệu');
});
