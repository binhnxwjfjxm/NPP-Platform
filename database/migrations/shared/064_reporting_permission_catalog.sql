-- Phase 8.1: register reporting permissions in the canonical database catalog.
-- This is metadata-only and does not assign either permission to any end-user role.

INSERT INTO shared.permission_catalog (
  permission_key,
  module,
  label,
  description,
  is_system,
  created_at
) VALUES
  (
    'core.reporting.sales.read',
    'Báo cáo bán hàng',
    'Xem báo cáo bán hàng',
    'Cho phép đọc dashboard bán hàng trong đúng installation và phạm vi kho được cấp.',
    true,
    now()
  ),
  (
    'core.reporting.purchasing.read',
    'Báo cáo mua hàng',
    'Xem báo cáo mua hàng',
    'Cho phép đọc dashboard mua hàng trong đúng installation và phạm vi kho được cấp.',
    true,
    now()
  )
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;
