import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/sales/sales-orders/SalesOrderWorkspace.tsx', import.meta.url), 'utf8');

test('lỗi thống kê độc lập với danh sách và thay đổi bộ lọc hủy truy vấn cũ', () => {
  assert.match(source, /const summaryRequest = append \? null : apiRequest/);
  assert.doesNotMatch(source, /Promise\.all\(\[\s*apiRequest<SalesOrder\[\]>/);
  assert.match(source, /requestAbortRef\.current\?\.abort\(\)/);
  assert.match(source, /setOrders\(\[\]\)/);
  assert.match(source, /setSummary\(null\)/);
  assert.match(source, /void summaryRequest\.then/);
  assert.match(source, /setSummaryUnavailable\(result\.failed\)/);
});

test('không giả tổng đơn bằng 50 đơn trên trang và không giữ banner lỗi cũ', () => {
  assert.match(source, /summary\?\.total \?\? '—'/);
  assert.doesNotMatch(source, /summary\?\.total \?\? orders\.length/);
  assert.match(source, /Tổng số đang cập nhật/);
  assert.match(source, /name !== 'orders'/);
  assert.match(source, /canLoadMore/);
});
