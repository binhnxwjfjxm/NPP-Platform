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

test('Kinh doanh dùng client workspace để đổi chiều tại chỗ trên desktop', async () => {
  const [page, workspace, loader, reconciliation, profit, workspaceStyles] = await Promise.all([
    read('app/reports/business/page.tsx'),
    read('app/reports/business/business-report-workspace.tsx'),
    read('app/reports/business-report-data.ts'),
    read('app/reports/business/reconciliation/page.tsx'),
    read('app/reports/profit/page.tsx'),
    read('app/reports/business/business-workspace.module.css'),
  ]);

  assert.match(page, /BusinessReportWorkspace/);
  assert.match(page, /contentWidth="special"/);
  assert.match(workspace, /^'use client';/);
  for (const label of ['Loại khách', 'Khách hàng', 'Sản phẩm', 'Nhóm hàng', 'Kênh bán', 'Nhân viên bán hàng']) {
    assert.match(workspace, new RegExp(label));
  }

  assert.match(workspace, /useState<BusinessBreakdownKey>\(initialDimension\)/);
  assert.match(workspace, /window\.history\.replaceState/);
  assert.match(workspace, /onChange=\{\(event\) => selectDimension/);
  assert.match(workspace, /onClick=\{\(\) => selectDimension\(item\.key\)\}/);
  assert.doesNotMatch(workspace, /href=\{dimensionHref/);
  assert.match(workspace, /className=\{styles\.desktopAnalysisToolbar\}/);
  assert.match(workspace, /className=\{styles\.desktopDimensionControl\}/);
  assert.match(workspace, /className=\{styles\.desktopFilterSlot\}/);
  assert.match(workspace, /<table className=\{styles\.analysisTable\}>/);
  assert.match(workspace, /onClick=\{\(\) => selectRow\(row, index\)\}/);
  assert.match(workspace, /Đối soát/);
  assert.match(workspace, /trendChart/);
  assert.match(workspaceStyles, /\.analysisLayout\.withDetail/);
  assert.match(workspaceStyles, /\.desktopAnalysisToolbar/);
  assert.match(workspaceStyles, /@media\(min-width:761px\).*\.workspace :global\(\.adminKpiCard\)\{min-height:70px/s);
  assert.match(loader, /reconciliation\.ok !== true/);
  assert.match(reconciliation, /Đối soát Báo cáo Kinh doanh/);
  assert.match(profit, /Thiếu giá vốn/);
});

test('Kinh doanh không dùng sản lượng tổng vô nghĩa cho các chiều không phải sản phẩm', async () => {
  const [workspace, loader] = await Promise.all([
    read('app/reports/business/business-report-workspace.tsx'),
    read('app/reports/business-report-data.ts'),
  ]);

  assert.match(workspace, /function metricLabel/);
  assert.match(workspace, /dimension === 'products'.*'Sản lượng'/s);
  assert.match(workspace, /dimension === 'customers'.*'Số đơn'/s);
  assert.match(workspace, /dimension === 'productGroups'.*'Số sản phẩm'/s);
  assert.match(workspace, /customerGroups'.*khách.*đơn/s);
  assert.match(workspace, /channels'.*đơn.*khách/s);
  assert.match(workspace, /Mặt hàng đã bán/);
  assert.match(workspace, /Sản lượng xem theo từng sản phẩm để không cộng gộp sai ĐVT/);
  assert.match(workspace, /Chưa phân loại/);
  assert.doesNotMatch(workspace, /<th>Sản lượng<\/th>/);
  for (const field of ['documentCount', 'customerCount', 'productCount']) assert.match(loader, new RegExp(field));
});

test('Kinh doanh trên điện thoại giữ danh sách gọn và tab cuộn ngang', async () => {
  const [workspace, workspaceStyles] = await Promise.all([
    read('app/reports/business/business-report-workspace.tsx'),
    read('app/reports/business/business-workspace.module.css'),
  ]);

  assert.match(workspace, /role="tablist"/);
  assert.match(workspace, /className=\{styles\.desktopTableWrap\}/);
  assert.match(workspace, /className=\{styles\.mobileList\}/);
  assert.match(workspace, /<details className=\{styles\.mobileRowGroup\}/);
  assert.match(workspace, /metric\(row, selectedDimension\)/);
  assert.match(workspace, /<dt>Tỷ trọng<\/dt>/);
  assert.match(workspace, /<dt>Kỳ trước<\/dt>/);
  assert.match(workspace, /<dt>Thay đổi<\/dt>/);
  assert.match(workspace, /Có \{report\.warnings\.length\} điểm cần lưu ý/);
  assert.match(workspaceStyles, /@media\(max-width:760px\).*\.dimensionTabs\{display:flex/s);
  assert.match(workspaceStyles, /@media\(max-width:760px\).*\.desktopTableWrap\{display:none\}/s);
  assert.match(workspaceStyles, /@media\(max-width:760px\).*\.mobileList\{display:block\}/s);
  assert.match(workspaceStyles, /@media\(max-width:760px\).*\.detailPanel\{display:none\}/s);
  assert.match(workspaceStyles, /\.warningMobile\{display:none\}/);
  assert.match(workspaceStyles, /@media\(max-width:760px\).*\.warningMobile\{display:block/s);
  assert.doesNotMatch(workspaceStyles, /@media\(max-width:760px\)[^}]*\.analysisTable\{min-width:/s);
});
