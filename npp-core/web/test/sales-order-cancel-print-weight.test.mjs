import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

function extractBody(source, name) {
  const match = new RegExp(`function ${name}\\([^)]*\\): string \\{([\\s\\S]*?)\\n\\}`).exec(source);
  assert.ok(match, `Không tìm thấy hàm ${name}`);
  return match[1];
}

const detail = read('../app/sales/sales-orders/SalesOrderDetail.tsx');
const print = read('../app/sales/sales-orders/SalesOrderPrintSheet.tsx');

test('đơn bán hàng đã huỷ có số đơn vẫn hiển thị hành động in mà không hồi sinh chứng từ', () => {
  assert.match(detail, /current && order\.number && \['confirmed', 'closed', 'cancelled'\]\.includes\(order\.status\)/);
  assert.doesNotMatch(detail, /current && order\.number && \['confirmed', 'closed'\]\.includes\(order\.status\)/);
});

test('phiếu xuất kho dùng tên Công Ty ngắn và khối lượng nằm trong vùng thông tin đầu phiếu', () => {
  const metaStart = print.indexOf('meta={[');
  const columnsStart = print.indexOf('columns={[', metaStart);
  const totalsStart = print.indexOf('totals={[', columnsStart);
  const noteStart = print.indexOf('note={', totalsStart);

  assert.ok(metaStart >= 0 && columnsStart > metaStart && totalsStart > columnsStart && noteStart > totalsStart);
  const metaBlock = print.slice(metaStart, columnsStart);
  const totalsBlock = print.slice(totalsStart, noteStart);

  assert.match(print, /title="PHIẾU XUẤT KHO"/);
  assert.match(print, /headingFallback="Hưng Phát"/);
  assert.match(metaBlock, /key: 'customer', label: 'Khách hàng'/);
  assert.match(metaBlock, /key: 'document_date', label: 'Ngày đơn'/);
  assert.match(metaBlock, /key: 'total_weight', label: 'Khối lượng', value: orderWeightText\(lines\), full: true/);
  assert.ok(metaBlock.indexOf("key: 'customer'") < metaBlock.indexOf("key: 'document_date'"));
  assert.ok(metaBlock.indexOf("key: 'document_date'") < metaBlock.indexOf("key: 'total_weight'"));
  assert.doesNotMatch(totalsBlock, /total_weight|Tổng khối lượng/);
});

test('khối lượng in chỉ hiện tổng phần có dữ liệu; tất cả thiếu trả 0 kg', () => {
  const formatWeightKg = new Function('value', extractBody(print, 'formatWeightKg'));
  const sumKnownWeightKg = new Function('lines', extractBody(print, 'sumKnownWeightKg'));
  const orderWeightText = new Function('formatWeightKg', 'sumKnownWeightKg', 'lines', extractBody(print, 'orderWeightText'));

  const known = [{ lineWeightKg: '1.5' }, { lineWeightKg: '2.25' }];
  const mixed = [{ lineWeightKg: '1.5' }, { lineWeightKg: null }, { lineWeightKg: '2.25' }];
  const missing = [{ lineWeightKg: null }, { lineWeightKg: null }];

  assert.equal(sumKnownWeightKg(known), '3.75');
  assert.equal(sumKnownWeightKg(mixed), '3.75');
  assert.equal(sumKnownWeightKg(missing), '0');
  assert.equal(orderWeightText(formatWeightKg, sumKnownWeightKg, known), '3,75 kg');
  assert.equal(orderWeightText(formatWeightKg, sumKnownWeightKg, mixed), '3,75 kg');
  assert.equal(orderWeightText(formatWeightKg, sumKnownWeightKg, missing), '0 kg');
  assert.doesNotMatch(print, /chưa tính .*dòng thiếu khối lượng/);
});

test('khối lượng in làm tròn half-up tối đa 2 số lẻ và bỏ số 0 dư', () => {
  const formatWeightKg = new Function('value', extractBody(print, 'formatWeightKg'));

  assert.equal(formatWeightKg('25'), '25 kg');
  assert.equal(formatWeightKg('25.5'), '25,5 kg');
  assert.equal(formatWeightKg('25.678'), '25,68 kg');
  assert.equal(formatWeightKg('1.333333'), '1,33 kg');
  assert.equal(formatWeightKg('1.335'), '1,34 kg');
  assert.equal(formatWeightKg('999.999'), '1.000 kg');
  assert.equal(formatWeightKg(null), 'Chưa đủ dữ liệu');
});
