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
  assert.match(workspace, /query\.set\('brandId', filters\.brandId\)/);
  assert.match(workspace, /query\.set\('customerGroupId', filters\.customerGroupId\)/);
  assert.match(workspace, /query\.set\('includeZeroProducts', 'true'\)/);
  assert.match(workspace, /classification\.options\.productGroups/);
  assert.match(workspace, /classification\.options\.brands/);
  assert.match(workspace, /classification\.options\.customerGroups/);
  assert.match(workspace, /Tất cả kho/);
  assert.match(workspace, /Loại sản phẩm/);
  assert.match(workspace, /Tất cả loại sản phẩm/);
  assert.match(workspace, /Nhãn hàng/);
  assert.match(workspace, /Tất cả nhãn hàng/);
  assert.match(workspace, /Tất cả nhóm khách hàng/);
  assert.doesNotMatch(workspace, /<span>Tiền tệ<\/span>/);
  for (const field of ['productGroupId', 'brandId', 'customerGroupId', 'includeZeroProducts']) {
    assert.match(gateway, new RegExp(field));
  }
});

test('Nhóm khách và nhóm sản phẩm vẫn là bộ lọc theo chiều, bảng có dòng Tổng', () => {
  const workspace = read('app/components/sales-reporting-workspace.tsx');
  const styles = read('app/components/sales-reporting-workspace.module.css');
  const types = read('lib/sales-reporting-types.ts');

  assert.match(workspace, /activeDimension === 'customers'/);
  assert.match(workspace, /Nhóm khách/);
  assert.match(workspace, /activeDimension === 'products'/);
  assert.match(workspace, /Nhóm sản phẩm/);
  assert.match(workspace, /Hiện mã không phát sinh/);
  assert.match(workspace, /report\?\.breakdownTotals\[activeDimension\]/);
  assert.match(workspace, /<tfoot>/);
  assert.match(workspace, /styles\.totalRow/);
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
  assert.match(workspace, /report\.reconciliation/);
  assert.match(workspace, /dataQuality\.warnings/);
  assert.match(workspace, /Doanh thu theo ngày/);
  assert.match(workspace, /Doanh thu kỳ trước/);
  assert.match(workspace, /warningDetails/);
  assert.doesNotMatch(workspace, /Ngày tương ứng kỳ trước/);
});

test('Lô 2 đổi 6 tab thành dropdown và đổi chiều tại chỗ, không điều hướng/remount', () => {
  const workspace = read('app/components/sales-reporting-workspace.tsx');
  const styles = read('app/components/sales-reporting-workspace.module.css');
  assert.match(workspace, /<span>Chiều phân tích<\/span>/);
  assert.match(workspace, /<select value=\{activeDimension\} onChange=\{\(event\) => changeDimension\(event\.target\.value\)\}>/);
  assert.match(workspace, /setActiveDimension\(value\)/);
  assert.doesNotMatch(workspace, /role="tablist"|role="tab"/);
  assert.doesNotMatch(workspace, /router\.push|window\.location|href=\{dimension/);
  assert.match(styles, /\.analysisTableWrap[\s\S]*height: clamp\(/);
  assert.match(workspace, /BusinessTableSequenceHeader/);
  assert.match(workspace, /BusinessTableSequenceCell/);
});

test('Preset kỳ, biểu đồ xu hướng, chi tiết và bộ lọc phân tích nâng cao vẫn còn', () => {
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
  assert.match(workspace, />Xem<\/button>/);
  assert.match(workspace, /Chi tiết/);
});

test('Lưu chế độ xem vẫn ở trình duyệt, không thêm API/persistence server', () => {
  const workspace = read('app/components/sales-reporting-workspace.tsx');
  assert.match(workspace, /SAVED_VIEW_KEY/);
  assert.match(workspace, /window\.localStorage\.getItem/);
  assert.match(workspace, /window\.localStorage\.setItem/);
  assert.match(workspace, /Lưu chế độ xem/);
  assert.doesNotMatch(workspace, /fetch\([^)]*saved|\/api\/reporting\/sales\/view/);
});

test('Lô 2 gom filter một hàng desktop, KPI thấp và nội dung chính theo tỷ lệ 75/25', () => {
  const workspace = read('app/components/sales-reporting-workspace.tsx');
  const styles = read('app/components/sales-reporting-workspace.module.css');

  assert.match(workspace, /styles\.filterToolbar/);
  assert.match(styles, /\.filterToolbar[\s\S]*display: flex/);
  assert.match(styles, /\.filterToolbar[\s\S]*overflow-x: auto/);
  assert.match(styles, /\.summaryGrid article[\s\S]*min-height: 68px/);
  assert.match(styles, /\.cardValue,[\s\S]*font-size: 1\.45rem/);
  assert.match(workspace, /styles\.mainGrid/);
  assert.match(styles, /\.mainGrid[\s\S]*grid-template-columns: minmax\(0, 3fr\) minmax\(260px, 1fr\)/);
  assert.match(workspace, /styles\.analysisPanel/);
  assert.match(workspace, /styles\.trendPanel/);
});

test('Lô 2 bỏ heading/tab/card thừa nhưng giữ trạng thái đối soát và cảnh báo dạng gọn', () => {
  const workspace = read('app/components/sales-reporting-workspace.tsx');

  assert.doesNotMatch(workspace, /<p className=\{styles\.eyebrow\}>Phân tích<\/p>/);
  assert.doesNotMatch(workspace, /Xem theo \{selectedDimension\.label\.toLowerCase\(\)\}/);
  assert.doesNotMatch(workspace, /<h2>Khớp với đơn bán hàng<\/h2>/);
  assert.doesNotMatch(workspace, /<h2>Điểm cần lưu ý<\/h2>/);
  assert.match(workspace, /Đối soát:/);
  assert.match(workspace, /chênh lệch/);
  assert.match(workspace, /cảnh báo/);
});

test('Responsive giữ filter, bảng chi tiết và biểu đồ ổn trên màn hình nhỏ', () => {
  const styles = read('app/components/sales-reporting-workspace.module.css');
  assert.match(styles, /@media \(max-width: 980px\)[\s\S]*\.mainGrid/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.filterToolbar/);
  assert.match(styles, /\.detailGrid/);
  assert.match(styles, /\.trendGrid/);
  assert.match(styles, /\.trendChart/);
});
