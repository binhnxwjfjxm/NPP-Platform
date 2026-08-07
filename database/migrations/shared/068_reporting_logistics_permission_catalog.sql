-- Phase 8.5: dedicated Delivery / Logistics reporting permission metadata only.
-- No role grant, business-table mutation, production migration or deployment is introduced here.

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES (
  'core.reporting.logistics.read',
  'Báo cáo giao hàng',
  'Xem hiệu suất giao hàng / logistics',
  'Cho phép đọc báo cáo chuyến, điểm dừng, kết quả giao và hiệu suất tài xế/phương tiện trong đúng installation và phạm vi kho được cấp.',
  true,
  now()
)
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;