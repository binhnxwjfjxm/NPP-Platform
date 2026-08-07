-- Phase 8.2: register the dedicated inventory reporting permission.
-- Metadata only: this migration does not grant the permission to any role.

INSERT INTO shared.permission_catalog (
  permission_key,
  module,
  label,
  description,
  is_system,
  created_at
) VALUES (
  'core.reporting.inventory.read',
  'Báo cáo tồn kho',
  'Xem báo cáo tồn kho',
  'Cho phép đọc dashboard tồn kho trong đúng installation và phạm vi kho được cấp.',
  true,
  now()
)
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;
