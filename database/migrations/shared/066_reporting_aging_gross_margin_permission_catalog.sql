-- Phase 8.3: register aging and gross-margin reporting permissions.
-- Metadata only: no role grant is performed here.

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES
  (
    'core.reporting.aging.read',
    'Báo cáo công nợ',
    'Xem tuổi nợ phải thu / phải trả',
    'Cho phép đọc tuổi khoản phải thu và tuổi nợ phải trả trong đúng installation và phạm vi kho được cấp.',
    true,
    now()
  ),
  (
    'core.reporting.gross-margin.read',
    'Báo cáo lãi gộp',
    'Xem báo cáo lãi gộp',
    'Cho phép đọc doanh thu thuần, giá vốn Phase 7 và lãi gộp trong đúng installation và phạm vi kho được cấp.',
    true,
    now()
  )
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;
