import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('shared navigation uses business grouping without fake system or unfinished-login status', async () => {
  const shell = await source('../app/components/app-shell-core.tsx');
  assert.match(shell, /Danh mục nghiệp vụ/);
  assert.match(shell, /Tổ chức, đối tác, hàng hóa, giá và chứng từ/);
  assert.match(shell, /Quản lý tài khoản và quyền truy cập/);
  assert.doesNotMatch(shell, /Đăng nhập sẽ được bổ sung|Hệ thống trực tuyến/);
});

test('login and user pages use neutral office language', async () => {
  const [login, users] = await Promise.all([
    source('../app/login/page.tsx'),
    source('../app/access/users/user-workspace.tsx'),
  ]);
  assert.match(login, /Đăng nhập hệ thống/);
  assert.match(login, /liên hệ người quản trị tài khoản nội bộ/);
  assert.doesNotMatch(login, /hộp thoại xác thực|Thông tin kết nối hệ thống|không gian quản trị/);
  assert.match(users, /Quản lý tài khoản sử dụng hệ thống/);
  assert.doesNotMatch(users, /chưa phải thông tin đăng nhập thật|tập vai trò trống/);
});

test('inventory keeps every business feature while removing JSON demo and DOM translation layers', async () => {
  const [workspace, opening, balancesPage, lotsPage, policyPage] = await Promise.all([
    source('../app/inventory/inventory-workspace.tsx'),
    source('../app/inventory/opening-balances/opening-balance-csv-workspace.tsx'),
    source('../app/inventory/balances/page.tsx'),
    source('../app/inventory/lots/page.tsx'),
    source('../app/inventory/tracking-policies/page.tsx'),
  ]);

  assert.match(workspace, /data-testid="inventory-balances-section"/);
  assert.match(workspace, /data-testid="inventory-policies-section"/);
  assert.match(workspace, /data-testid="inventory-lots-section"/);
  assert.match(workspace, /data-testid="inventory-opening-section"/);
  assert.match(workspace, /Mở màn hình nhập tồn đầu kỳ/);
  assert.match(workspace, /lotTrackingLabel/);
  assert.match(workspace, /expiryTrackingLabel/);
  assert.match(workspace, /movementDirectionLabel/);
  assert.doesNotMatch(workspace, /Sheet1!2|metadataText|rowsText|safeJsonArray|safeJsonObject|Giai đoạn 4\.4|theo đúng khả năng backend/);

  assert.match(opening, /Mã kho/);
  assert.match(opening, /Mã tham chiếu SKU/);
  assert.match(opening, /Tải mẫu Excel\/CSV/);
  assert.doesNotMatch(opening, /WAREHOUSE_UUID|VARIANT_UUID|Ví dụ: TON_DAU_2026/);

  for (const page of [balancesPage, lotsPage, policyPage]) {
    assert.doesNotMatch(page, /BusinessLanguageBoundary|InventoryLot3Boundary/);
  }
});

test('document numbering and pricing retain operational cards with office wording', async () => {
  const [numbering, pricing] = await Promise.all([
    source('../app/document-numbering/document-numbering-workspace.tsx'),
    source('../app/pricing/pricing-workspace.tsx'),
  ]);

  assert.match(numbering, /data-testid="allocate-test-number-button"/);
  assert.match(numbering, /Cấp số tham chiếu/);
  assert.match(numbering, /DOCUMENT_TYPES/);
  assert.match(numbering, /RESET_POLICY_LABELS/);
  assert.doesNotMatch(numbering, /NPP Document Numbering|Phase 3\.3F|Cấp số kiểm thử|Tạo khóa mới|Lịch sử bất biến|allocation thử nghiệm/);

  assert.match(pricing, /Kiểm tra giá áp dụng/);
  assert.match(pricing, /Quá trình xác định giá/);
  assert.match(pricing, /RESOLUTION_STEP_LABELS\[step\.kind\]/);
  assert.match(pricing, /SOURCE_LABELS\[item\.source_kind\]/);
  assert.doesNotMatch(pricing, /Ví dụ: bán lẻ|Priority càng lớn|giá không nằm trong code|Thử giá & giải thích|Trace áp giá|Mã rule ngoài|<strong>\{step\.kind\}<\/strong>/);
});

test('product catalog preserves product, SKU, unit and barcode features with translated labels', async () => {
  const [products, unitWorkspace, unitAdmin] = await Promise.all([
    source('../app/products/product-workspace.tsx'),
    source('../app/products/product-unit-workspace.tsx'),
    source('../app/products/product-unit-admin-v2.tsx'),
  ]);

  assert.match(products, /data-testid="add-product-button"/);
  assert.match(products, /data-testid="add-variant-button"/);
  assert.match(products, /VARIANT_KIND_LABELS\[variant\.variant_kind\]/);
  assert.match(products, /Hiển thị bán hàng/);
  assert.doesNotMatch(products, /NPP Product Catalog|bộ lọc admin|<td>\{variant\.variant_kind\}<\/td>|Vô hiệu/);

  assert.match(unitWorkspace, /Đơn vị tính, quy đổi &amp; mã vạch/);
  assert.doesNotMatch(unitWorkspace, /Phase 3\.3D|SKU gốc|barcode/);

  assert.match(unitAdmin, /UNIT_KIND_LABELS\[unit\.unit_kind\]/);
  assert.match(unitAdmin, /BARCODE_TYPE_LABELS\[item\.barcode_type\]/);
  assert.match(unitAdmin, /Kiểm tra quy đổi/);
  assert.match(unitAdmin, /Thêm mã vạch/);
  assert.doesNotMatch(unitAdmin, /Thử quy đổi|ĐVT mô tả|Nhãn nguồn|Quy cách nguồn|<td>\{unit\.unit_kind\}<\/td>|<td>\{item\.barcode_type\}<\/td>|Vô hiệu/);
});

test('roles, employees, customers, suppliers and organization use neutral administrative language', async () => {
  const [roles, employees, customers, suppliers, organization] = await Promise.all([
    source('../app/access/roles/role-workspace.tsx'),
    source('../app/access/employees/employee-workspace.tsx'),
    source('../app/customers/customer-workspace.tsx'),
    source('../app/suppliers/supplier-workspace.tsx'),
    source('../app/organization/organization-workspace.tsx'),
  ]);

  assert.match(roles, /Phạm vi quyền/);
  assert.match(roles, /moduleLabel\(group\.module\)/);
  assert.doesNotMatch(roles, /installation hiện tại|registry canonical|Ma trận quyền|Chọn quyền theo module|permissionKey\}>\{permission\.permission_key/);

  assert.match(employees, /Quản lý hồ sơ nhân sự, chức danh/);
  assert.doesNotMatch(employees, /installation hiện tại|trước khi liên kết tài khoản/);

  assert.match(customers, /kicker="Quản lý khách hàng"/);
  assert.match(customers, /Số nhà, tên đường/);
  assert.doesNotMatch(customers, /anh vui lòng|xóa cứng|Địa chỉ dòng 1|Địa chỉ dòng 2|NPP Core · Dữ liệu nền/);

  assert.match(suppliers, /Cập nhật dữ liệu/);
  assert.doesNotMatch(suppliers, /anh vui lòng|Vô hiệu/);

  assert.match(organization, /Chi nhánh quản lý/);
  assert.match(organization, /Kho quản lý/);
  assert.match(organization, /Đơn vị quản lý/);
  assert.doesNotMatch(organization, /hồ sơ gốc|Dữ liệu hệ thống|Cơ cấu trực thuộc|Chi nhánh mẹ|Kho mẹ/);
});
