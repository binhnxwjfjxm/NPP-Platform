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

test('Bộ lọc bán hàng gửi kỳ, kho và phân loại theo lựa chọn nghiệp vụ', () => {
  const workspace = read('app/components/sales-reporting-workspace.tsx');
  const gateway = read('lib/reporting-dashboard-gateway.ts');
  assert.match(workspace, /query\.set\('from', filters\.from\)/);
  assert.match(workspace, /query\.set\('to', filters\.to\)/);
  assert.match(workspace, /query\.set\('warehouseId', filters\.warehouseId\)/);
  assert.match(workspace, /query\.set\('productGroupId', filters\.productGroupId\)/);
  assert.match(workspace, /query\.set\('customerGroupId', filters\.customerGroupId\)/);
  assert.match(workspace, /query\.set\('includeZeroProducts', 'true'\)/);
  assert.match(workspace, /classification\.options\.productGroups/);
  assert.match(workspace, /classification\.options\.customerGroups/);
  assert.match(workspace, /Tất cả kho được cấp quyền/);
  assert.match(workspace, /Tất cả nhóm sản phẩm/);
  assert.match(workspace, /Tất cả nhóm khách hàng/);
  for (const field of ['productGroupId', 'customerGroupId', 'includeZeroProducts']) {
    assert.match(gateway, new RegExp(field));
  }
});


test('Nhóm khách và nhóm sản phẩm chỉ là bộ lọc của các mục cũ, bảng có dòng Tổng', () => {
  const workspace = read('app/components/sales-reporting-workspace.tsx');
  const styles = read('app/components/sales-reporting-workspace.module.css');
  const types = read('lib/sales-reporting-types.ts');

  assert.match(workspace, /activeDimension === 'customers'/);
  assert.match(workspace, /Lọc khách hàng theo nhóm/);
  assert.match(workspace, /activeDimension === 'products'/);
  assert.match(workspace, /Lọc sản phẩm theo nhóm/);
  assert.match(workspace, /Hiện sản phẩm không phát sinh/);
  assert.match(workspace, /report\?\.breakdownTotals\[activeDimension\]/);
  assert.match(workspace, /<tfoot>/);
  assert.match(workspace, /styles\.totalRow/);
  assert.match(styles, /\.dimensionFilterBar/);
  assert.match(styles, /\.totalRow/);
  assert.match(types, /breakdownTotals:/);

  assert.doesNotMatch(workspace, /Sản lượng sản phẩm theo nhóm khách hàng/);
  assert.doesNotMatch(workspace, /dimension="productCustomerMatrix"/);
  assert.doesNotMatch(workspace, /classificationToolbar/);
  assert.doesNotMatch(types, /SalesProductCustomerMatrixRow/);
});

test('Nền Báo cáo bán hàng giữ so kỳ, tỷ trọng, đối soát và cảnh báo', () => {
  const workspace = read('app/components/sales-reporting-workspace.tsx');
  assert.match(workspace, /previousRevenue/);
  assert.match(workspace, /sharePercent/);
  assert.match(workspace, /report\?\.reconciliation/);
  assert.match(workspace, /dataQuality\.warnings/);
  assert.match(workspace, /Xu hướng theo ngày/);
  assert.match(workspace, /Doanh thu kỳ trước/);
  assert.doesNotMatch(workspace, /Ngày tương ứng kỳ trước/);
});

test('Đổi chiều phân tích giữ vùng bảng ổn định, không điều hướng hoặc remount trang', () => {
  const workspace = read('app/components/sales-reporting-workspace.tsx');
  const styles = read('app/components/sales-reporting-workspace.module.css');
  assert.match(workspace, /onClick=\{\(\) => \{[\s\S]*setActiveDimension\(item\.key\)/);
  assert.doesNotMatch(workspace, /router\.push|window\.location|href=\{dimension/);
  assert.match(styles, /\.analysisTableWrap[\s\S]*height: clamp\(/);
  assert.match(workspace, /BusinessTableSequenceHeader/);
  assert.match(workspace, /BusinessTableSequenceCell/);
});


test('Lô 3 có preset kỳ, biểu đồ xu hướng, chi tiết và bộ lọc phân tích nâng cao', () => {
  const workspace = read('app/components/sales-reporting-workspace.tsx');
  for (const label of ['Hôm nay', '7 ngày', 'Tháng này', 'Tháng trước']) {
    assert.match(workspace, new RegExp(label));
  }
  assert.match(workspace, /vietnamTodayIso/);
  assert.match(workspace, /TrendChart/);
  assert.match(workspace, /<svg/);
  assert.match(workspace, /BigInt/);
  assert.doesNotMatch(workspace, /parseFloat\(|parseInt\(|Number\(/);
  assert.match(workspace, /analysisSearch/);
  assert.match(workspace, /currencyFilter/);
  assert.match(workspace, /comparisonFilter/);
  assert.match(workspace, /selectedRow/);
  assert.match(workspace, /Xem/);
  assert.match(workspace, /Chi tiết/);
});

test('Lô 3 lưu chế độ xem phía trình duyệt, không thêm API hoặc persistence server', () => {
  const workspace = read('app/components/sales-reporting-workspace.tsx');
  assert.match(workspace, /SAVED_VIEW_KEY/);
  assert.match(workspace, /window\.localStorage\.getItem/);
  assert.match(workspace, /window\.localStorage\.setItem/);
  assert.match(workspace, /Lưu chế độ xem/);
  assert.doesNotMatch(workspace, /fetch\([^)]*saved|\/api\/reporting\/sales\/view/);
});

test('Lô 3 giữ UX responsive cho công cụ phân tích, chi tiết và biểu đồ', () => {
  const styles = read('app/components/sales-reporting-workspace.module.css');
  assert.match(styles, /\.analysisTools/);
  assert.match(styles, /\.detailGrid/);
  assert.match(styles, /\.trendGrid/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.analysisTools/);
  assert.match(styles, /\.trendChart/);
});


test('Báo cáo bán hàng gom bộ lọc desktop một hàng và ưu tiên số liệu tổng', () => {
  const workspace = read('app/components/sales-reporting-workspace.tsx');
  const styles = read('app/components/sales-reporting-workspace.module.css');
  assert.match(workspace, /styles\.filterToolbar/);
  assert.match(styles, /\.filterToolbar[\s\S]*grid-template-columns: max-content/);
  assert.match(styles, /\.summaryGrid article[\s\S]*min-height: 92px/);
  assert.match(styles, /\.cardValue,[\s\S]*font-size: 2rem/);
  assert.match(workspace, /formatDecimal\(value, 2\)/);
  assert.match(workspace, /percent\(row\.sharePercent\)/);
});
