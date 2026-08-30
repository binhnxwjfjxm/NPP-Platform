import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Báo cáo quản trị tách Kinh doanh và Lợi nhuận', async () => {
  const page = await read('app/reports/page.tsx');
  assert.match(page, /href: '\/reports\/business'.*label: 'Kinh doanh'/s);
  assert.match(page, /href: '\/reports\/profit'.*label: 'Lợi nhuận'/s);
  assert.doesNotMatch(page, /label: 'Kinh doanh & lợi nhuận'/);
  assert.match(page, /aria-label="Giá trị xu hướng theo ngày"/);
});

test('Kinh doanh có 6 chiều, ĐVT riêng và đối soát cuối báo cáo', async () => {
  const [page, loader, reconciliation, profit] = await Promise.all([
    read('app/reports/business/page.tsx'), read('app/reports/business-report-data.ts'), read('app/reports/business/reconciliation/page.tsx'), read('app/reports/profit/page.tsx'),
  ]);
  for (const label of ['Loại khách', 'Khách hàng', 'SKU / Sản phẩm', 'Nhóm hàng', 'Kênh bán', 'Nhân viên bán hàng']) assert.match(page, new RegExp(label));
  assert.match(page, /Không cộng gộp các ĐVT khác nhau/);
  assert.match(loader, /reconciliation\.ok !== true/);
  assert.match(reconciliation, /Đối soát Báo cáo Kinh doanh/);
  assert.match(profit, /Thiếu giá vốn/);
});
