# MCP-Plan Audit Baseline

Mục tiêu file này: khóa lại hiện trạng thật của MCP-Plan trước khi sửa tiếp. Từ giờ không sửa UI theo cảm giác. Mỗi mục phải biết rõ: dữ liệu lấy từ đâu, nút gọi endpoint nào, lưu vào bảng nào, sau khi lưu xem ở đâu.

## 1. Nguyên tắc audit

- Không phát triển kiểu landing page.
- Mỗi nghiệp vụ là một module/trang rõ.
- Popup chỉ dùng cho tạo nhanh hoặc thao tác nhanh.
- Tạo xong thì thao tác chi tiết nằm ở trang dữ liệu đúng module.
- Supabase là nguồn dữ liệu trung tâm.
- UI chỉ được gọi API/backend đúng contract, không tự bịa logic.
- Không làm nút giả. Nút hiện ra thì phải có tác dụng thật hoặc ghi rõ là chưa triển khai.

## 2. Repo tham khảo `report`

Repo `gustavjung01/report` chỉ dùng để tham khảo tổ chức luồng UI/popup, không bê logic.

Pattern cần học:

```text
Home = card điều hướng nhanh
Data hub = MCP / Đơn / Test / Báo cáo
Popup/dialog = tạo nhanh
Trang dữ liệu = xem/sửa/theo dõi chi tiết
```

Nguyên tắc lấy từ repo report:

```text
- Không phát triển kiểu landing page.
- Mỗi nghiệp vụ phải là một module/trang rõ ràng.
- Tạo dữ liệu bằng popup gọn.
- Sau khi tạo xong, thao tác chi tiết nằm ở trang Dữ liệu.
- Supabase là nguồn đồng bộ trung tâm.
```

## 3. Backend/DB hiện tại đang có gì

Theo backend hiện tại, MCP-Plan đang dựa vào các bảng chính:

```text
mcp_routes              = tuyến master
mcp_route_customers     = khách cố định trong tuyến
mcp_route_sessions      = phiên MCP ngày
mcp_session_customers   = snapshot khách trong phiên ngày
mcp_visits              = lượt ghé/kết quả ghé
orders                  = đơn hàng
order_items             = chi tiết sản phẩm trong đơn
```

Luồng hiện có trong backend:

```text
mcp_routes
  -> mcp_route_customers
  -> mở phiên ngày bằng routeId + sessionDate
  -> tạo mcp_route_sessions
  -> copy khách active sang mcp_session_customers
  -> ghi lượt ghé/kết quả vào mcp_visits hoặc session customer result
  -> orders/order_items hiện chủ yếu để đọc danh sách đơn/doanh thu
```

## 4. Endpoint/API hiện đã thấy trong frontend/backend

Frontend API client hiện có các hàm:

```text
getRoutesData()
getRouteCustomersData()
getMcpDayData()
createMcpDayResult()
addMcpDayCustomer()
createMcpDayFollowup()
listOrders()
```

Backend hiện có đường đọc/ghi liên quan MCP ngày:

```text
GET  /api/routes/data
GET  /api/routes/customers/data
GET  /api/mcp-day/data
POST /api/mcp-day/session-customer/result
POST /api/mcp-day/session-customer/add
POST /api/mcp-day/session-customer/followup
```

Backend cũng có logic mở phiên MCP ngày trong code, nhưng UI hiện chưa có màn chuẩn để chọn tuyến + ngày + sale và gọi đúng API mở phiên.

## 5. Các lỗ hổng nghiệp vụ hiện tại

### 5.1 Tuyến MCP master

Hiện đã xem được tuyến/khách tuyến ở `/routes`, nhưng còn thiếu:

```text
[ ] Tạo tuyến
[ ] Sửa tuyến
[ ] Bật/tắt tuyến
[ ] Chọn thứ trong tuần
[ ] Chọn khu vực
[ ] Chọn nhân viên phụ trách
```

### 5.2 Khách trong tuyến

Hiện mới xem khách tuyến/GPS, còn thiếu:

```text
[ ] Thêm khách vào tuyến
[ ] Sửa thông tin khách tuyến
[ ] Ẩn khách khỏi tuyến
[ ] Đổi thứ tự ghé
[ ] Cập nhật GPS thật
```

### 5.3 Mở phiên MCP ngày

Backend có logic mở phiên theo tuyến/ngày, nhưng UI còn thiếu:

```text
[ ] Chọn tuyến cố định
[ ] Chọn ngày thực thi
[ ] Chọn sale/người phụ trách
[ ] Mở phiên thật
[ ] Nếu phiên đã tồn tại thì vào lại phiên đó
[ ] /visits phải lấy đúng phiên theo routeId + date, không chỉ lấy latest
```

### 5.4 Phiên MCP ngày

Hiện có danh sách khách phiên và các action cơ bản, nhưng còn thiếu form/luồng rõ:

```text
[ ] Check-in khách
[ ] Bỏ qua + lý do
[ ] Ghi ghi chú lượt ghé
[ ] Thêm khách phát sinh trong phiên
[ ] Tạo đơn thật từ khách trong phiên
[ ] Tạo test/report/follow-up thật theo session customer
```

### 5.5 Đơn hàng/doanh thu

Hiện `/orders` đọc danh sách đơn và KPI doanh số, nhưng còn thiếu:

```text
[ ] API tạo đơn thật
[ ] Form tạo đơn
[ ] Thêm SKU/số lượng/giá
[ ] Link đơn với session_customer_id/visit_id
[ ] Theo dõi doanh thu theo ngày/tuyến/sale/khách
```

## 6. Những lỗi UI đã phát hiện cần test lại

```text
[ ] Popup con trong khách khó bấm
[ ] Trường nhập trong popup không focus/khó nhập
[ ] Bottom nav quá cao hoặc che safe-area iPhone
[ ] Card phiên ngày quá nhiều nút
[ ] /visits có cảm giác landing page dài
[ ] /routes và /visits bị trộn dữ liệu master/session
```

## 7. Quy tắc pass/fail khi test

Một mục chỉ xem là xong khi đủ 4 điều kiện:

```text
1. UI hiển thị đúng chỗ.
2. Bấm được trên mobile/iPhone.
3. Gọi đúng API hoặc ghi rõ chưa có API.
4. Dữ liệu lưu xong xem lại được ở màn đúng module.
```

Nếu thiếu 1 trong 4 điều kiện thì không qua mục tiếp theo.
