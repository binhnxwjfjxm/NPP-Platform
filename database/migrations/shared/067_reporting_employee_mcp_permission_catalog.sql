-- Phase 8.4: register Employee + MCP Field reporting permission.
-- Metadata-only: this migration does not assign the permission to an end-user role.

INSERT INTO shared.permission_catalog (
  permission_key,
  module,
  label,
  description,
  is_system,
  created_at
) VALUES (
  'core.reporting.employee-mcp.read',
  'Báo cáo nhân sự & MCP',
  'Xem hiệu suất nhân viên / MCP',
  'Cho phép đọc hiệu suất route/session/visit/order-intent của MCP trong đúng installation và phạm vi field có thể xác minh canonical.',
  true,
  now()
)
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;
