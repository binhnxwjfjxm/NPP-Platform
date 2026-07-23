# MCP Execution Plan

Mục tiêu: từ giờ triển khai theo từng cổng test. Anh test xong mục nào pass mới qua mục kế tiếp. Không sửa lan man.

## 0. Quy trình làm việc

### Frontend/UI

```text
Sửa GitHub main -> Vercel auto deploy -> anh test -> local git pull
```

### Backend/API

```text
Sửa repo -> Vercel frontend nếu cần -> VPS pullmcp khi backend đổi
```

### Supabase

```text
Chỉ migration khi thiếu schema/cột/function thật.
Không đụng Supabase nếu chỉ sửa UI.
```

## 1. Test Gate A - Khóa nền audit/contract

### Mục tiêu

Có tài liệu thống nhất để không sửa lệch nghiệp vụ.

### Files

```text
docs/MCP_AUDIT.md
docs/MCP_CONTRACT.md
docs/MCP_EXECUTION_PLAN.md
```

### Pass khi

```text
[ ] Đã đọc và thống nhất data flow.
[ ] Đã thống nhất /routes là master.
[ ] Đã thống nhất /visits là phiên ngày.
[ ] Đã thống nhất orders là module riêng.
[ ] Không còn sửa UI trước khi biết endpoint/bảng.
```

## 2. Test Gate B - Mobile shell/popup nền

### Mục tiêu

Trước khi làm form thật, mobile shell phải dùng được.

### Việc cần làm

```text
[ ] Bottom nav sát mép dưới, không tạo khoảng trắng khó chịu.
[ ] Safe-area iPhone có nền nhấn nhẹ.
[ ] Popup con dễ bấm.
[ ] Button trong popup đủ cao.
[ ] Input/textarea/select trong popup focus được.
[ ] Keyboard iPhone không che nút chính.
```

### Pass khi

```text
[ ] Mở popup trên iPhone bấm nút không hụt.
[ ] Có thể tap vào input và gõ được.
[ ] Đóng popup dễ.
[ ] Scroll nội dung popup không giật/cứng.
```

## 3. Test Gate C - `/routes` Tuyến master

### Mục tiêu

/routes trở thành nơi quản lý tuyến gốc, khách tuyến, GPS và mở phiên.

### C1. Danh sách tuyến

```text
[ ] Hiển thị tuyến master từ API.
[ ] Xem chi tiết tuyến.
[ ] Không trộn dữ liệu phiên ngày.
```

### C2. Tạo/sửa tuyến

Cần backend API:

```text
POST  /api/routes
PATCH /api/routes/:id
```

UI cần popup:

```text
[ ] Tạo tuyến
[ ] Sửa tuyến
[ ] Tên tuyến
[ ] Khu vực
[ ] Nhân viên phụ trách
[ ] Thứ trong tuần
[ ] Ghi chú
[ ] Active/tạm dừng
```

Pass khi:

```text
[ ] Tạo tuyến xong reload vẫn thấy.
[ ] Sửa tuyến xong dữ liệu đổi thật.
[ ] Tạm dừng tuyến không còn hiện ở danh sách mở phiên.
```

### C3. Khách tuyến

Cần backend API:

```text
POST  /api/routes/:routeId/customers
PATCH /api/routes/customers/:id
PATCH /api/routes/customers/:id/hide
PATCH /api/routes/customers/reorder
```

UI cần popup:

```text
[ ] Thêm khách tuyến
[ ] Sửa khách tuyến
[ ] Ẩn khỏi tuyến
[ ] Đổi thứ tự ghé
```

Pass khi:

```text
[ ] Thêm khách vào tuyến xong thấy trong tab Khách tuyến.
[ ] Sửa khách xong reload vẫn đúng.
[ ] Ẩn khách không còn đi vào phiên mới.
[ ] Thứ tự ghé đúng khi mở phiên.
```

### C4. GPS

Cần backend API:

```text
PATCH /api/routes/customers/:id/gps
```

UI cần:

```text
[ ] Mở Google Maps
[ ] Lấy GPS hiện tại nếu browser cho phép
[ ] Nhập lat/lng thủ công nếu cần
[ ] Lưu GPS
```

Pass khi:

```text
[ ] Lưu GPS xong khách chuyển khỏi danh sách Cần GPS.
[ ] Reload vẫn giữ GPS.
```

### C5. Mở phiên

Cần backend API:

```text
POST /api/mcp-day/open-session
```

UI cần popup:

```text
[ ] Chọn tuyến
[ ] Chọn ngày
[ ] Chọn sale/người phụ trách
[ ] Mở phiên
[ ] Nếu đã có phiên thì vào lại phiên đó
```

Pass khi:

```text
[ ] Mở phiên xong vào /visits đúng tuyến/ngày.
[ ] Snapshot khách bằng đúng khách active trong tuyến.
[ ] Mở lại cùng ngày không nhân đôi snapshot.
```

## 4. Test Gate D - `/visits` Phiên MCP ngày

### Mục tiêu

/visits là nơi thực thi phiên ngày, không sửa master.

### D1. Chọn đúng phiên

```text
[ ] /visits nhận routeId + date/sessionId.
[ ] Không tự lấy latest session sai tuyến/ngày.
[ ] Header hiện rõ tuyến/ngày/sale.
```

### D2. Xử lý khách phiên

Cần API:

```text
PATCH /api/mcp-day/session-customer/status
```

UI cần:

```text
[ ] Check-in
[ ] Bỏ qua
[ ] Lý do bỏ qua
[ ] Ghi chú ghé
```

Pass khi:

```text
[ ] Check-in xong khách chuyển trạng thái Đã ghé.
[ ] Bỏ qua bắt buộc nhập lý do.
[ ] Reload vẫn đúng trạng thái.
```

### D3. Thêm khách phát sinh

Cần API:

```text
POST /api/mcp-day/session-customer/add
```

UI cần:

```text
[ ] Tên khách
[ ] SĐT
[ ] Khu vực
[ ] Địa chỉ
[ ] Ghi chú
```

Pass khi:

```text
[ ] Thêm xong xuất hiện trong tab Phát sinh.
[ ] source = added.
[ ] Không làm thay đổi tuyến master.
```

### D4. Ghi kết quả

Cần API:

```text
POST /api/mcp-day/session-customer/result
POST /api/mcp-day/session-customer/followup
```

UI cần:

```text
[ ] Ghi có đơn
[ ] Ghi có test
[ ] Ghi báo cáo
[ ] Tạo follow-up
```

Pass khi:

```text
[ ] Ghi xong tab Kết quả cập nhật.
[ ] Follow-up hiển thị ở tab Follow-up.
[ ] Không mất sessionCustomerId.
```

## 5. Test Gate E - Đơn hàng thật

### Mục tiêu

Đơn hàng không chỉ là ghi cờ có đơn; phải tạo record order/order_items thật.

### Backend cần có

```text
POST   /api/orders
GET    /api/orders/:id
PATCH  /api/orders/:id/status
POST   /api/orders/:id/items
PATCH  /api/orders/:id/items/:itemId
DELETE /api/orders/:id/items/:itemId
GET    /api/orders/summary
```

### UI cần có

```text
[ ] Popup tạo đơn từ khách MCP.
[ ] Chọn/nhập sản phẩm.
[ ] Số lượng.
[ ] Đơn giá.
[ ] Thành tiền tự tính.
[ ] Lưu nháp.
[ ] Chốt đơn.
[ ] Xem đơn ở /orders.
```

### DB cần đảm bảo

```text
[ ] orders có nguồn từ MCP/session.
[ ] orders link được session_customer_id hoặc visit_id.
[ ] order_items link đúng order_id.
```

### Pass khi

```text
[ ] Tạo đơn từ /visits xong /orders thấy đơn.
[ ] Doanh số dashboard tăng đúng.
[ ] Lọc theo tuyến/ngày/sale ra đúng.
```

## 6. Test Gate F - Dashboard/doanh thu

### Mục tiêu

Dashboard là kết quả thật từ DB/API, không mock.

### KPI cần có

```text
[ ] Doanh thu hôm nay.
[ ] Đơn hôm nay.
[ ] Lượt ghé hôm nay.
[ ] Tỷ lệ ghé.
[ ] Tỷ lệ có đơn.
[ ] Việc cần xử lý.
```

### Pass khi

```text
[ ] Tạo đơn mới thì dashboard đổi.
[ ] Check-in khách thì lượt ghé đổi.
[ ] Follow-up mới thì việc cần xử lý đổi.
```

## 7. Thứ tự triển khai từ đây

```text
1. Gate A: docs audit/contract/plan - đã tạo.
2. Gate B: test mobile shell/popup nền.
3. Gate C1: /routes xem tuyến master sạch.
4. Gate C5: mở phiên ngày thật.
5. Gate D1-D2: /visits chọn đúng phiên + check-in/bỏ qua.
6. Gate D3-D4: phát sinh + kết quả/follow-up.
7. Gate E: đơn hàng thật.
8. Gate F: dashboard/doanh thu thật.
```

## 8. Nguyên tắc dừng

Nếu một gate fail:

```text
- Dừng ở gate đó.
- Tìm nguyên nhân đúng layer: UI, API, backend, DB hay deploy.
- Không sửa sang gate sau.
- Không vá CSS/label nếu lỗi là thiếu API/DB.
```
