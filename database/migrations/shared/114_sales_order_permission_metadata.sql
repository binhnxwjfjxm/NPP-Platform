-- Issue #791: forward-only alignment of Sales Order permission metadata.
-- Do not rewrite migrations 037/040; installations may already have applied them.

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES
  (
    'core.sales-order.price.override',
    'Bán hàng',
    'Sửa giá bán trên đơn',
    'Cho phép sửa trực tiếp đơn giá trên dòng hàng; hệ thống tự lưu lịch sử thay đổi.',
    true,
    now()
  ),
  (
    'core.sales-order.discount.override',
    'Bán hàng',
    'Sửa chiết khấu bán hàng',
    'Cho phép nhập chiết khấu theo từng dòng hoặc chiết khấu bổ sung toàn đơn theo đúng chính sách.',
    true,
    now()
  )
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;
