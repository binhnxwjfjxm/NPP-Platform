import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Admin tách Kinh doanh và Lợi nhuận, không giữ tab gộp', async () => {
  const [data, page] = await Promise.all([read('app/reports/report-data.ts'), read('app/reports/page.tsx')]);
  assert.match(data, /\| 'sales'/);
  assert.match(data, /\| 'profit'/);
  assert.match(page, /key: 'sales', label: 'Kinh doanh'/);
  assert.match(page, /key: 'profit', label: 'Lợi nhuận'/);
  assert.doesNotMatch(page, /label: 'Kinh doanh & lợi nhuận'/);
});

test('Kinh doanh dùng 6 chiều nghiệp vụ và xu hướng có giá trị nhìn thấy trên mobile', async () => {
  const [salesDetail, salesPage, profitPage, page] = await Promise.all([
    read('app/reports/report-sales-data.ts'),
    read('app/reports/sales-summary/page.tsx'),
    read('app/reports/profit-summary/page.tsx'),
    read('app/reports/page.tsx'),
  ]);
  for (const label of ['Khách hàng', 'Loại khách', 'Kênh bán', 'SKU / Sản phẩm', 'Nhóm hàng', 'Nhân viên bán hàng']) assert.match(salesDetail, new RegExp(label));
  assert.match(salesPage, /loadSalesBusinessDetail/);
  assert.doesNotMatch(salesPage, /loadLotCDrilldown/);
  assert.match(profitPage, /loadLotCPresentation\('profit'/);
  assert.match(page, /aria-label="Giá trị xu hướng theo ngày"/);
  assert.match(page, /<strong>\{point\.display\}<\/strong>/);
});
