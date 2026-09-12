import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Báo cáo bán hàng dùng workspace riêng thay vì workspace Sales/Mua hàng cũ', () => {
  const page = read('app/sales/reporting/page.tsx');
  assert.match(page, /SalesReportingWorkspace/);
  assert.doesNotMatch(page, /ReportingDashboardWorkspace/);
});

test('Báo cáo bán hàng hiển thị đủ 6 chiều canonical và dùng contract Sales mới', () => {
  const workspace = read('app/components/sales-reporting-workspace.tsx');
  const types = read('lib/sales-reporting-types.ts');

  for (const key of ['customers', 'customerGroups', 'channels', 'products', 'productGroups', 'employees']) {
    assert.match(workspace, new RegExp(`key: '${key}'`));
  }
  for (const label of ['Khách hàng', 'Loại khách', 'Kênh bán', 'Sản phẩm', 'Nhóm hàng', 'Nhân viên bán hàng']) {
    assert.match(workspace, new RegExp(label));
  }

  assert.match(workspace, /report\?\.breakdowns\[activeDimension\]/);
  assert.match(types, /comparison:/);
  assert.match(types, /reconciliation:/);
  assert.match(types, /dataQuality:/);
  assert.match(types, /scopeWarehouses:/);
  assert.doesNotMatch(workspace, /statusBreakdown/);
  assert.doesNotMatch(workspace, /sampleDocumentNumber|baseQuantity/);
});

test('Bộ lọc Sales gửi kỳ và kho, chỉ hiện kho trong scope backend', () => {
  const workspace = read('app/components/sales-reporting-workspace.tsx');
  assert.match(workspace, /query\.set\('from', filters\.from\)/);
  assert.match(workspace, /query\.set\('to', filters\.to\)/);
  assert.match(workspace, /query\.set\('warehouseId', filters\.warehouseId\)/);
  assert.match(workspace, /report\?\.scopeWarehouses/);
  assert.match(workspace, /Tất cả kho được cấp quyền/);
});

test('Lô 1 có so kỳ, tỷ trọng, đối soát và cảnh báo nhưng chưa mở export/preset', () => {
  const workspace = read('app/components/sales-reporting-workspace.tsx');
  assert.match(workspace, /previousRevenue/);
  assert.match(workspace, /sharePercent/);
  assert.match(workspace, /report\?\.reconciliation/);
  assert.match(workspace, /dataQuality\.warnings/);
  assert.match(workspace, /Xu hướng theo ngày/);
  assert.match(workspace, /Doanh thu kỳ trước/);
  assert.doesNotMatch(workspace, /Ngày tương ứng kỳ trước/);
  assert.doesNotMatch(workspace, /Xuất báo cáo|Xuất Excel|CSV|XLSX/);
  assert.doesNotMatch(workspace, /Hôm nay|7 ngày|Tháng trước/);
});

test('Đổi chiều phân tích giữ vùng bảng ổn định, không điều hướng hoặc remount trang', () => {
  const workspace = read('app/components/sales-reporting-workspace.tsx');
  const styles = read('app/components/sales-reporting-workspace.module.css');
  assert.match(workspace, /onClick=\{\(\) => setActiveDimension\(item\.key\)\}/);
  assert.doesNotMatch(workspace, /router\.push|window\.location|href=\{dimension/);
  assert.match(styles, /\.analysisTableWrap[\s\S]*height: clamp\(/);
  assert.match(workspace, /BusinessTableSequenceHeader/);
  assert.match(workspace, /BusinessTableSequenceCell/);
});
