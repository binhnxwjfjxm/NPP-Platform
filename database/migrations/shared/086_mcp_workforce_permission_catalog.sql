-- Lô 5: đăng ký quyền MCP vào danh mục phân quyền Công Ty.
-- Chỉ đăng ký catalog; không tự cấp quyền cho vai trò hoặc người dùng hiện hữu.

INSERT INTO shared.permission_catalog (
  permission_key,
  module,
  label,
  description,
  is_system,
  created_at
) VALUES
  ('mcp.session.write', 'MCP hiện trường', 'Thực hiện phiên đi tuyến', 'Cho phép mở và cập nhật phiên đi tuyến theo phạm vi được giao.', true, now()),
  ('mcp.session-customer.write', 'MCP hiện trường', 'Cập nhật điểm bán trong phiên', 'Cho phép cập nhật trạng thái điểm bán thuộc phiên đi tuyến đang phụ trách.', true, now()),
  ('mcp.order.write', 'MCP hiện trường', 'Ghi nhận đơn tại điểm bán', 'Cho phép ghi nhận nghiệp vụ đơn hàng tại điểm bán trong phiên MCP.', true, now()),
  ('mcp.test.write', 'MCP hiện trường', 'Ghi nhận kiểm tra tại điểm bán', 'Cho phép ghi nhận kết quả kiểm tra nghiệp vụ tại điểm bán.', true, now()),
  ('mcp.report.write', 'MCP hiện trường', 'Ghi báo cáo thị trường', 'Cho phép lập và cập nhật báo cáo thị trường trong phiên được giao.', true, now()),
  ('mcp.followup.write', 'MCP hiện trường', 'Ghi việc cần theo dõi', 'Cho phép tạo và cập nhật việc cần theo dõi phát sinh từ hoạt động thị trường.', true, now()),
  ('mcp.sales-order.read', 'MCP bán hàng', 'Xem đơn Công Ty từ MCP', 'Cho phép MCP đọc đơn Công Ty theo phạm vi kho được cấp.', true, now()),
  ('mcp.sales-order.create', 'MCP bán hàng', 'Tạo đơn Công Ty từ MCP', 'Cho phép MCP tạo đơn Công Ty cho khách đã mở mã theo phạm vi được cấp.', true, now()),
  ('mcp.route.write', 'Cấu hình MCP', 'Quản lý tuyến cố định', 'Cho phép tạo, sửa và ngừng sử dụng tuyến bán hàng cố định.', true, now()),
  ('mcp.route-customer.write', 'Cấu hình MCP', 'Quản lý điểm bán trong tuyến', 'Cho phép thêm, sửa và loại điểm bán khỏi danh sách tuyến cố định.', true, now()),
  ('mcp.report-setting.write', 'Cấu hình MCP', 'Quản lý mẫu báo cáo thị trường', 'Cho phép thay đổi các lựa chọn dùng chung trong cấu hình báo cáo thị trường.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;
