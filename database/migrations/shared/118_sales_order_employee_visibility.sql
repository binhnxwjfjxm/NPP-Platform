-- Sales Order employee visibility contract.
-- Baseline read is employee-owned within existing installation/warehouse scope.
-- Elevated cross-employee visibility is an explicit permission and does not grant write capabilities.

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES
  (
    'core.sales-order.read-all',
    'Bán hàng',
    'Xem đơn của nhân viên khác',
    'Cho phép đọc và xử lý phạm vi đơn của nhân viên khác khi đồng thời có quyền thao tác tương ứng; không mở rộng phạm vi kho và không tự cấp quyền sửa giá, xuất kho hoặc thu tiền.',
    true,
    now()
  )
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

UPDATE shared.permission_catalog
SET description = 'Cho phép đọc đơn bán hàng của chính nhân viên trong phạm vi kho được cấp.'
WHERE permission_key = 'core.sales-order.read';

UPDATE shared.permission_catalog
SET description = 'Cho phép Công Ty xác nhận giao trực tiếp Delivery Order giao tận nơi, ghi Inventory OUT và công nợ theo lượng thực giao.'
WHERE permission_key = 'core.delivery-order.manual-handover';
