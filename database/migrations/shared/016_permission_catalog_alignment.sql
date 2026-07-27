-- Phase 3 closeout: forward-only alignment of canonical permission metadata.
-- Do not rewrite previously applied migrations. This migration reconciles fresh databases
-- and installations that already applied migrations 002 through 009.

INSERT INTO shared.permission_catalog (
  permission_key,
  module,
  label,
  description,
  is_system,
  created_at
) VALUES
  (
    'core.warehouse.location.read',
    'Tổ chức',
    'Xem vị trí kho',
    'Cho phép đọc danh sách và chi tiết vị trí kho hàng.',
    true,
    now()
  ),
  (
    'core.customer.read',
    'Tổ chức',
    'Xem khách hàng',
    'Cho phép đọc danh sách và chi tiết khách hàng.',
    true,
    now()
  ),
  (
    'core.customer.write',
    'Tổ chức',
    'Quản lý khách hàng',
    'Cho phép tạo, cập nhật và thay đổi trạng thái khách hàng.',
    true,
    now()
  ),
  (
    'core.supplier.read',
    'Tổ chức',
    'Xem nhà cung cấp',
    'Cho phép đọc danh sách và chi tiết nhà cung cấp.',
    true,
    now()
  ),
  (
    'core.supplier.write',
    'Tổ chức',
    'Quản lý nhà cung cấp',
    'Cho phép tạo, cập nhật và thay đổi trạng thái nhà cung cấp.',
    true,
    now()
  ),
  (
    'core.product.write',
    'Sản phẩm',
    'Quản lý danh mục sản phẩm',
    'Cho phép tạo, cập nhật, nhập và thay đổi trạng thái danh mục sản phẩm.',
    true,
    now()
  )
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;
