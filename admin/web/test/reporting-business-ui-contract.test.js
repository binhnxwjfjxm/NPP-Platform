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

test('Kinh doanh dùng màn hình làm việc: tab phân tích, bảng và chi tiết', async () => {
  const [page, loader, reconciliation, profit, workspaceStyles] = await Promise.all([
    read('app/reports/business/page.tsx'),
    read('app/reports/business-report-data.ts'),
    read('app/reports/business/reconciliation/page.tsx'),
    read('app/reports/profit/page.tsx'),
    read('app/reports/business/business-workspace.module.css'),
  ]);

  for (const label of ['Loại khách', 'Khách hàng', 'Sản phẩm', 'Nhóm hàng', 'Kênh bán', 'Nhân viên bán hàng']) {
    assert.match(page, new RegExp(label));
  }

  assert.match(page, /role="tablist"/);
  assert.match(page, /report\.breakdowns\[selectedDimension\]/);
  assert.match(page, /<table className=\{styles\.analysisTable\}>/);
  assert.match(page, /rowDetailHref/);
  assert.match(page, /Đối soát/);
  assert.match(page, /trendChart/);
  assert.match(workspaceStyles, /\.analysisLayout\.withDetail/);
  assert.match(workspaceStyles, /\.dimensionTabs/);
  assert.match(loader, /reconciliation\.ok !== true/);
  assert.match(reconciliation, /Đối soát Báo cáo Kinh doanh/);
  assert.match(profit, /Thiếu giá vốn/);
});

test('Kinh doanh không dùng sản lượng tổng vô nghĩa cho các chiều không phải sản phẩm', async () => {
  const [page, loader] = await Promise.all([
    read('app/reports/business/page.tsx'),
    read('app/reports/business-report-data.ts'),
  ]);

  assert.match(page, /function metricLabel/);
  assert.match(page, /dimension === 'products'.*'Sản lượng'/s);
  assert.match(page, /dimension === 'customers'.*'Số đơn'/s);
  assert.match(page, /dimension === 'productGroups'.*'Số sản phẩm'/s);
  assert.match(page, /customerGroups'.*khách.*đơn/s);
  assert.match(page, /channels'.*đơn.*khách/s);
  assert.match(page, /Mặt hàng đã bán/);
  assert.match(page, /Sản lượng xem theo từng sản phẩm để không cộng gộp sai ĐVT/);
  assert.match(page, /Chưa phân loại/);
  assert.doesNotMatch(page, /<th>Sản lượng<\/th>/);
  for (const field of ['documentCount', 'customerCount', 'productCount']) assert.match(loader, new RegExp(field));
});

test('Kinh doanh trên điện thoại dùng danh sách gọn thay cho bảng cuộn ngang', async () => {
  const [page, workspaceStyles] = await Promise.all([
    read('app/reports/business/page.tsx'),
    read('app/reports/business/business-workspace.module.css'),
  ]);

  assert.match(page, /className=\{styles\.desktopTableWrap\}/);
  assert.match(page, /className=\{styles\.mobileList\}/);
  assert.match(page, /<details className=\{styles\.mobileRowGroup\}/);
  assert.match(page, /metric\(row, selectedDimension\)/);
  assert.match(page, /<dt>Tỷ trọng<\/dt>/);
  assert.match(page, /<dt>Kỳ trước<\/dt>/);
  assert.match(page, /<dt>Thay đổi<\/dt>/);
  assert.match(page, /Có \{report\.warnings\.length\} điểm cần lưu ý/);
  assert.match(workspaceStyles, /@media\(max-width:760px\).*\.desktopTableWrap\{display:none\}/s);
  assert.match(workspaceStyles, /@media\(max-width:760px\).*\.mobileList\{display:block\}/s);
  assert.match(workspaceStyles, /@media\(max-width:760px\).*\.detailPanel\{display:none\}/s);
  assert.match(workspaceStyles, /\.warningMobile\{display:none\}/);
  assert.match(workspaceStyles, /@media\(max-width:760px\).*\.warningMobile\{display:block/s);
  assert.doesNotMatch(workspaceStyles, /@media\(max-width:760px\)[^}]*\.analysisTable\{min-width:/s);
});
