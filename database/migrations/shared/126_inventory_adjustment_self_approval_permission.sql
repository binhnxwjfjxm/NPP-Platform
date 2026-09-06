-- Cho phép cấu hình quyền tự duyệt phiếu xử lý tồn kho theo vai trò.
-- Quyền duyệt thông thường vẫn là điều kiện bắt buộc tại route; quyền này chỉ mở ngoại lệ cùng người tạo.

INSERT INTO shared.permission_catalog (
  permission_key,
  module,
  label,
  description,
  is_system,
  created_at
) VALUES (
  'core.inventory-adjustment.self-approve',
  'Kho',
  'Tự duyệt phiếu mình tạo',
  'Cho phép người đã có quyền duyệt tự duyệt phiếu xử lý tồn kho do chính mình tạo.',
  true,
  now()
)
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;
