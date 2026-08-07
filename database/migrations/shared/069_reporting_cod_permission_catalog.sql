-- Phase 8.6: dedicated COD operational reconciliation reporting permission metadata only.
-- Existing COD mutation permissions remain unchanged; no role grant or production mutation is introduced here.

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES (
  'core.reporting.cod.read',
  'Báo cáo COD',
  'Xem COD & đối soát vận hành',
  'Cho phép đọc trạng thái thu COD, tiền tài xế đang giữ, bàn giao, kế toán tiếp nhận và ngoại lệ trong đúng installation và phạm vi kho được cấp.',
  true,
  now()
)
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;
