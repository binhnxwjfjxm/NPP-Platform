-- Cho phép đơn MCP dùng trực tiếp khách Công Ty đã được phân công mà không bắt buộc phải có Điểm bán MCP.
-- source_outlet_id chỉ còn là thông tin nguồn tùy chọn khi đơn thực sự phát sinh từ một Điểm bán MCP đã liên kết.

ALTER TABLE sales.sales_orders
  DROP CONSTRAINT IF EXISTS sales_orders_source_shape_check;

ALTER TABLE sales.sales_orders
  ADD CONSTRAINT sales_orders_source_shape_check CHECK (
    (source_type = 'MANUAL' AND source_id IS NULL AND source_outlet_id IS NULL)
    OR (source_type IN ('IMPORT', 'API') AND source_id IS NOT NULL AND source_outlet_id IS NULL)
    OR (source_type = 'MCP' AND source_id IS NOT NULL)
  );

COMMENT ON COLUMN sales.sales_orders.source_outlet_id IS
  'Điểm bán nguồn của đơn MCP khi có liên kết rõ ràng; có thể NULL khi MCP tạo đơn trực tiếp cho khách Công Ty theo nhân viên phụ trách.';

COMMENT ON COLUMN sales.sales_order_versions.source_outlet_id IS
  'Bản chụp Điểm bán nguồn của phiên bản đơn MCP; có thể NULL với đơn tạo trực tiếp từ khách Công Ty.';
