-- Cho phép cấu hình quyền tự duyệt phiếu xử lý tồn kho theo vai trò.
-- Đồng thời đồng bộ mô tả hai quyền hiện có vì contract quyền đã mở thêm ngoại lệ tự duyệt có kiểm soát.

INSERT INTO shared.permission_catalog (
  permission_key,
  module,
  label,
  description,
  is_system,
  created_at
) VALUES
  (
    'core.inventory-adjustment.submit',
    'Kho',
    'Gửi duyệt phiếu xử lý tồn kho',
    'Cho phép gửi phiếu xử lý tồn kho để duyệt.',
    true,
    now()
  ),
  (
    'core.inventory-adjustment.approve',
    'Kho',
    'Duyệt phiếu xử lý tồn kho',
    'Cho phép duyệt phiếu xử lý tồn kho trong phạm vi kho được cấp.',
    true,
    now()
  ),
  (
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
