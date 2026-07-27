export const PERMISSIONS = Object.freeze({
  coreConfigRead: 'core.config.read',
  coreHealthAuthenticatedRead: 'core.health.authenticated.read',
  coreIdempotencyTestWrite: 'core.idempotency.test.write',
  coreAuditOutboxTestWrite: 'core.audit-outbox.test.write',
  coreStorageR2TestWrite: 'core.storage.r2.test.write',
  coreOrganizationRead: 'core.organization.read',
  coreOrganizationWrite: 'core.organization.write',
  coreBranchRead: 'core.branch.read',
  coreBranchWrite: 'core.branch.write',
  coreWarehouseRead: 'core.warehouse.read',
  coreWarehouseWrite: 'core.warehouse.write',
  coreWarehouseLocationRead: 'core.warehouse.location.read',
  coreWarehouseLocationWrite: 'core.warehouse.location.write',
  coreCustomerRead: 'core.customer.read',
  coreCustomerWrite: 'core.customer.write',
  coreSupplierRead: 'core.supplier.read',
  coreSupplierWrite: 'core.supplier.write',
  coreProductRead: 'core.product.read',
  coreProductWrite: 'core.product.write',
  corePriceRead: 'core.price.read',
  corePriceWrite: 'core.price.write',
  coreDocumentNumberRead: 'core.document-number.read',
  coreDocumentNumberWrite: 'core.document-number.write',
  coreEmployeeRead: 'core.employee.read',
  coreEmployeeWrite: 'core.employee.write',
  coreUserRead: 'core.user.read',
  coreUserWrite: 'core.user.write',
  coreUserRoleWrite: 'core.user-role.write',
  corePermissionRead: 'core.permission.read',
  coreRoleRead: 'core.role.read',
  coreRoleWrite: 'core.role.write',
});

export const PERMISSION_CATALOG = Object.freeze([
  Object.freeze({ permissionKey: PERMISSIONS.coreConfigRead, module: 'Hệ thống', label: 'Xem cấu hình hệ thống', description: 'Cho phép đọc thông tin cấu hình và trạng thái nền tảng đã được chuẩn hóa.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.coreHealthAuthenticatedRead, module: 'Hệ thống', label: 'Xem trạng thái xác thực', description: 'Cho phép đọc trạng thái sức khỏe có xác thực của Core API.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.coreIdempotencyTestWrite, module: 'Hệ thống', label: 'Kiểm thử idempotency', description: 'Cho phép thực thi luồng kiểm thử idempotency ở tầng Core.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.coreAuditOutboxTestWrite, module: 'Hệ thống', label: 'Kiểm thử audit/outbox', description: 'Cho phép thực thi kiểm thử giao dịch audit và outbox của Core API.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.coreStorageR2TestWrite, module: 'Hệ thống', label: 'Kiểm thử lưu trữ R2', description: 'Cho phép thực thi kiểm thử tích hợp lưu trữ đối tượng của Core.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.coreOrganizationRead, module: 'Tổ chức', label: 'Xem cấu trúc tổ chức', description: 'Cho phép đọc tổng quan cơ cấu tổ chức và các đơn vị trực thuộc.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.coreOrganizationWrite, module: 'Tổ chức', label: 'Quản lý cấu trúc tổ chức', description: 'Cho phép chỉnh sửa thông tin tổng quan cơ cấu tổ chức.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.coreBranchRead, module: 'Tổ chức', label: 'Xem chi nhánh', description: 'Cho phép đọc danh sách và chi tiết chi nhánh.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.coreBranchWrite, module: 'Tổ chức', label: 'Quản lý chi nhánh', description: 'Cho phép tạo, cập nhật và thay đổi trạng thái chi nhánh.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.coreWarehouseRead, module: 'Tổ chức', label: 'Xem kho hàng', description: 'Cho phép đọc danh sách và chi tiết kho hàng.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.coreWarehouseWrite, module: 'Tổ chức', label: 'Quản lý kho hàng', description: 'Cho phép tạo, cập nhật và thay đổi trạng thái kho hàng.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.coreWarehouseLocationRead, module: 'Tổ chức', label: 'Xem vị trí kho', description: 'Cho phép đọc danh sách và chi tiết vị trí kho hàng.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.coreWarehouseLocationWrite, module: 'Tổ chức', label: 'Quản lý vị trí kho', description: 'Cho phép tạo, cập nhật và thay đổi trạng thái vị trí kho.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.coreCustomerRead, module: 'Tổ chức', label: 'Xem khách hàng', description: 'Cho phép đọc danh sách và chi tiết khách hàng.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.coreCustomerWrite, module: 'Tổ chức', label: 'Quản lý khách hàng', description: 'Cho phép tạo, cập nhật và thay đổi trạng thái khách hàng.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.coreSupplierRead, module: 'Tổ chức', label: 'Xem nhà cung cấp', description: 'Cho phép đọc danh sách và chi tiết nhà cung cấp.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.coreSupplierWrite, module: 'Tổ chức', label: 'Quản lý nhà cung cấp', description: 'Cho phép tạo, cập nhật và thay đổi trạng thái nhà cung cấp.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.coreProductRead, module: 'Sản phẩm', label: 'Xem danh mục sản phẩm', description: 'Cho phép đọc danh mục, thương hiệu, sản phẩm và SKU.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.coreProductWrite, module: 'Sản phẩm', label: 'Quản lý danh mục sản phẩm', description: 'Cho phép tạo, cập nhật, nhập và thay đổi trạng thái danh mục sản phẩm.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.corePriceRead, module: 'Giá bán', label: 'Xem bảng giá', description: 'Cho phép đọc kênh bán, bảng giá, quy tắc giá và kết quả phân giải giá.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.corePriceWrite, module: 'Giá bán', label: 'Quản lý bảng giá', description: 'Cho phép tạo, cập nhật, nhập và thay đổi trạng thái bảng giá, quy tắc giá và chương trình.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.coreDocumentNumberRead, module: 'Số chứng từ', label: 'Xem cấu hình số chứng từ', description: 'Cho phép đọc series, bộ đếm và lịch sử cấp số chứng từ.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.coreDocumentNumberWrite, module: 'Số chứng từ', label: 'Quản lý và cấp số chứng từ', description: 'Cho phép tạo, cập nhật series và cấp số chứng từ theo hợp đồng idempotent.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.coreEmployeeRead, module: 'Nhân sự', label: 'Xem nhân sự', description: 'Cho phép đọc hồ sơ nhân sự nghiệp vụ.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.coreEmployeeWrite, module: 'Nhân sự', label: 'Quản lý nhân sự', description: 'Cho phép tạo, cập nhật và thay đổi trạng thái hồ sơ nhân sự.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.coreUserRead, module: 'Nhân sự', label: 'Xem người dùng', description: 'Cho phép đọc thông tin định danh người dùng và liên kết vai trò/nhân viên.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.coreUserWrite, module: 'Nhân sự', label: 'Quản lý người dùng', description: 'Cho phép tạo, cập nhật và quản lý liên kết vai trò/nhân viên của người dùng.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.coreUserRoleWrite, module: 'Nhân sự', label: 'Quản lý liên kết vai trò người dùng', description: 'Cho phép thay thế toàn bộ tập vai trò của người dùng một cách nguyên tử.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.corePermissionRead, module: 'Phân quyền', label: 'Xem danh mục quyền', description: 'Cho phép đọc danh mục quyền chuẩn hóa của Core Platform.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.coreRoleRead, module: 'Phân quyền', label: 'Xem vai trò', description: 'Cho phép đọc danh sách và chi tiết vai trò quản trị.', isSystem: true }),
  Object.freeze({ permissionKey: PERMISSIONS.coreRoleWrite, module: 'Phân quyền', label: 'Quản lý vai trò', description: 'Cho phép tạo, cập nhật, bật/tắt và thay thế tập quyền của vai trò.', isSystem: true }),
]);

export const PERMISSION_REGISTRY = new Set(PERMISSION_CATALOG.map((entry) => entry.permissionKey));

export function isKnownPermissionKey(value) {
  return typeof value === 'string' && PERMISSION_REGISTRY.has(value);
}

export function createPermissionCatalogRows(occurredAt = new Date().toISOString()) {
  return PERMISSION_CATALOG.map((entry) => ({
    permission_key: entry.permissionKey,
    module: entry.module,
    label: entry.label,
    description: entry.description,
    is_system: entry.isSystem,
    created_at: occurredAt,
  }));
}
