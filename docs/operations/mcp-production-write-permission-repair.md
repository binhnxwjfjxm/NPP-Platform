# MCP production write permission repair

## Phần này làm gì

Khôi phục các thao tác tạo và cập nhật trên MCP khi máy chủ trả `403` vì thiếu quyền dịch vụ.

Người dùng được phép tiếp tục:

- tạo và cập nhật tuyến;
- thêm và cập nhật điểm bán;
- mở phiên và cập nhật trạng thái điểm bán;
- check-in;
- tạo nhu cầu mua, test, báo cáo và theo dõi;
- quản lý cài đặt báo cáo;
- dùng cầu nối tạo đơn chính thức đã được duyệt.

## Nguyên nhân đã xác minh

Cấu hình Phase 6C production chỉ bổ sung quyền đọc/tạo đơn bán hàng. Các quyền ghi MCP trước đó không tồn tại trong cấu hình production, trong khi máy chủ áp dụng nguyên tắc từ chối mặc định. Vì vậy các thao tác như `POST /api/routes` và `POST /api/mcp-report-settings` đều bị chặn `403` trước khi ghi dữ liệu.

## Cách sửa

Nguồn chuẩn nằm tại:

```text
mcp/apps/backend/config/mcp-service-permissions.json
```

Lệnh vận hành chỉ bổ sung quyền còn thiếu vào cấu hình hiện có. Lệnh không thay mã đang chạy, không chạy migration và không ghi dữ liệu nghiệp vụ.

Sau khi cập nhật, lệnh kiểm tra:

```text
/health/live
/health/ready
POST /api/routes với body rỗng -> 400
POST /api/mcp-report-settings với body rỗng -> 400
```

Hai yêu cầu POST rỗng chỉ kiểm tra rằng quyền không còn bị chặn `403`; chúng không tạo dữ liệu.

Nếu kiểm tra sức khỏe hoặc kiểm tra an toàn thất bại, cấu hình quyền cũ được phục hồi.

## Lệnh production

Chỉ owner gửi đúng lệnh sau tại Issue #5:

```text
/repair-mcp-production-write-permissions
```
