# MCP Contract

File này là hợp đồng giữa UI, backend và Supabase DB cho module MCP. Từ giờ sửa màn nào phải bám contract này.

## 1. Data flow chuẩn

```text
Tuyến master
  mcp_routes
    -> Khách cố định trong tuyến
       mcp_route_customers
          -> Mở phiên ngày
             mcp_route_sessions
                -> Snapshot khách phiên ngày
                   mcp_session_customers
                      -> Lượt ghé/kết quả ghé
                         mcp_visits
                      -> Đơn/Test/Báo cáo/Follow-up
                         orders / order_items / test/report/action tables
```

## 2. Module `/routes` - Tuyến MCP master

### Vai trò

`/routes` chỉ quản lý dữ liệu gốc, không hiển thị kết quả phiên ngày.

### Tabs chuẩn

```text
1. Tuyến
2. Khách tuyến
3. GPS
4. Chuẩn bị phiên
```

### Bảng chính

```text
mcp_routes
mcp_route_customers
```

### API cần có

```text
GET    /api/routes/data
POST   /api/routes
PATCH  /api/routes/:id
PATCH  /api/routes/:id/status

GET    /api/routes/customers/data
POST   /api/routes/:routeId/customers
PATCH  /api/routes/customers/:id
PATCH  /api/routes/customers/:id/gps
PATCH  /api/routes/customers/:id/hide
PATCH  /api/routes/customers/reorder
```

### Popup cần có

```text
- Tạo tuyến
- Sửa tuyến
- Thêm khách tuyến
- Sửa khách tuyến
- Cập nhật GPS
- Ẩn khách khỏi tuyến
- Đổi thứ tự ghé
- Mở phiên ngày
```

### Nguyên tắc

```text
- Sửa tuyến master không tự sửa snapshot phiên đã mở.
- Ẩn khách khỏi tuyến không xóa lịch sử cũ.
- Đổi thứ tự ghé chỉ tác động route master, không sửa phiên đã mở.
```

## 3. Module `/visits` - Phiên MCP ngày

### Vai trò

`/visits` chỉ xử lý phiên ngày đã mở. Không sửa tuyến master ở đây.

### Bảng chính

```text
mcp_route_sessions
mcp_session_customers
mcp_visits
```

### API cần có

```text
POST  /api/mcp-day/open-session
GET   /api/mcp-day/data?date=YYYY-MM-DD&routeId=...
POST  /api/mcp-day/session-customer/add
PATCH /api/mcp-day/session-customer/status
POST  /api/mcp-day/session-customer/result
POST  /api/mcp-day/session-customer/followup
```

### Tabs chuẩn

```text
1. Khách phiên
2. Kết quả
3. Phát sinh
4. Follow-up
```

### Popup cần có

```text
- Xử lý khách trong phiên
- Check-in khách
- Bỏ qua + lý do
- Ghi kết quả ghé
- Thêm khách phát sinh
- Tạo đơn từ khách phiên
- Tạo test/report/follow-up
```

### Nguyên tắc

```text
- Mỗi khách trong phiên phải có sessionCustomerId.
- Ghi kết quả phải gắn sessionCustomerId.
- Khách phát sinh trong ngày source = added.
- Không hard delete khách khỏi phiên.
- /visits phải lấy theo date + routeId/sessionId, không chỉ lấy latest session.
```

## 4. Module `/orders` - Đơn hàng/doanh thu

### Vai trò

Theo dõi đơn hàng và doanh thu. Đơn tạo từ MCP phải trace được về phiên MCP.

### Bảng chính

```text
orders
order_items
mcp_session_customers
mcp_visits
```

### API cần có

```text
GET    /api/orders
POST   /api/orders
GET    /api/orders/:id
PATCH  /api/orders/:id/status
POST   /api/orders/:id/items
PATCH  /api/orders/:id/items/:itemId
DELETE /api/orders/:id/items/:itemId
GET    /api/orders/summary
```

### Form tạo đơn cần có

```text
- Khách hàng
- Tuyến
- Sale
- Ngày đơn
- Nguồn đơn
- sessionCustomerId nếu tạo từ MCP
- visitId nếu đã check-in
- Sản phẩm/SKU
- Số lượng
- Đơn giá
- Thành tiền
- Trạng thái: draft/confirmed/delivered/cancelled
```

### Nguyên tắc

```text
- Đơn tạo từ MCP phải có source_type = MCP/session hoặc tương đương.
- Nên lưu session_customer_id hoặc visit_id để tính doanh thu theo MCP.
- Doanh thu dashboard phải lấy từ orders/order_items, không lấy từ mock.
```

## 5. Module dashboard

### Vai trò

Tổng quan nhanh, không nhập liệu phức tạp.

### Nguồn dữ liệu

```text
mcp_routes
mcp_route_sessions
mcp_session_customers
mcp_visits
orders
order_items
actions/followups
```

### KPI chuẩn

```text
- Số tuyến đang chạy
- Số khách trong tuyến
- Số lượt ghé hôm nay
- Số đơn hôm nay
- Doanh thu hôm nay
- Việc cần xử lý
```

## 6. Quy tắc popup

Popup dùng cho:

```text
- Tạo nhanh
- Sửa nhanh
- Xác nhận nhanh
- Ghi kết quả nhanh
```

Popup không dùng cho:

```text
- Báo cáo dài
- Dashboard
- Danh sách quá dài
- Quy trình nhiều bước phức tạp không thể lưu nháp
```

## 7. Quy tắc UI/action

```text
- Không có nút giả.
- Không dùng label mơ hồ như Đơn/Test/Việc nếu không rõ hành động.
- Label phải là động từ: Ghi có đơn, Ghi có test, Tạo follow-up, Xem tuyến, Xem khách.
- Nút primary chỉ dành cho hành động chính.
- Nút phụ phải có tác dụng thật hoặc ẩn đi.
```

## 8. Quy tắc build/deploy

Frontend/UI:

```text
GitHub main -> Vercel auto deploy -> local git pull
```

Backend/API:

```text
GitHub main -> VPS pullmcp
```

Supabase:

```text
Chỉ chạy migration khi có thay đổi schema/function thật.
Không sửa DB nếu chỉ chỉnh UI.
```
