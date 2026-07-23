# MCP Pass Checklist

File này dùng để theo dõi tiến độ pass/fail từng phần. Từ giờ làm theo nguyên tắc: **mục nào anh test pass mới qua mục kế tiếp**.

## Quy ước trạng thái

```text
[ ] Chưa làm
[~] Đang làm / đang test
[x] Pass
[!] Fail / cần sửa lại
[-] Tạm hoãn
```

## Nguyên tắc chốt pass

Một mục chỉ được tick `[x] Pass` khi đủ 4 điều kiện:

```text
1. UI hiển thị đúng chỗ.
2. Bấm được trên mobile/iPhone.
3. Gọi đúng API hoặc ghi rõ chưa có API.
4. Lưu xong reload/xem lại được ở đúng màn.
```

Nếu thiếu 1 điều kiện thì để `[!] Fail` và dừng ở mục đó.

---

# Gate A - Audit / Contract / Plan

Mục tiêu: khóa nền nghiệp vụ trước khi sửa tiếp.

```text
[x] A1. Có docs/MCP_AUDIT.md
[x] A2. Có docs/MCP_CONTRACT.md
[x] A3. Có docs/MCP_EXECUTION_PLAN.md
[x] A4. Có file checklist pass/fail này
[ ] A5. Anh đọc và chốt quy trình pass từng phần
```

Pass Gate A khi:

```text
[ ] Đồng ý /routes là tuyến master
[ ] Đồng ý /visits là phiên MCP ngày
[ ] Đồng ý /orders là đơn hàng/doanh thu
[ ] Đồng ý không sửa lan man ngoài gate đang test
```

---

# Gate B - Mobile Shell / Popup nền

Mục tiêu: app dùng được trên mobile/iPhone trước khi làm nghiệp vụ thật.

## B1. Bottom navigation

```text
[~] B1.1 Thanh menu dưới hiển thị ổn
[~] B1.2 Thanh menu không quá đục / không quá nặng
[ ] B1.3 Thanh menu không che card/action cuối
[ ] B1.4 Bấm từng tab dễ, không hụt
[ ] B1.5 Không sửa tiếp vùng trắng home indicator nếu chưa có hướng chắc
```

Pass khi:

```text
[ ] Anh test iPhone thấy menu chấp nhận được
[ ] Không có card cuối bị che bởi menu
[ ] Không còn thử CSS safe-area phá layout
```

## B2. Popup / Bottom sheet

```text
[ ] B2.1 Popup mở đúng vị trí
[ ] B2.2 Popup đóng dễ
[ ] B2.3 Nút trong popup đủ cao, dễ bấm
[ ] B2.4 Nội dung popup scroll mượt
[ ] B2.5 Input/textarea/select focus được
[ ] B2.6 Keyboard không che nút chính
```

Pass khi:

```text
[ ] Tap input gõ được trên iPhone
[ ] Bấm action không hụt
[ ] Không có popup bị cứng/đơ
```

## B3. Chuyển tab / cảm giác app

```text
[ ] B3.1 Bấm bottom nav không chớp trắng quá rõ
[ ] B3.2 Active tab đổi đúng
[ ] B3.3 Không mất layout khi chuyển trang
[ ] B3.4 Ghi nhận phase riêng: Mobile Tab Smoothness sau khi nghiệp vụ ổn
```

Pass khi:

```text
[ ] Chấp nhận độ mượt hiện tại để quay lại nghiệp vụ
```

---

# Gate C - /routes Tuyến MCP Master

Mục tiêu: `/routes` là nơi quản lý tuyến gốc, khách tuyến, GPS và mở phiên.

## C1. Xem tuyến master sạch

```text
[ ] C1.1 Header /routes rõ là MCP tuyến master
[ ] C1.2 Có tab: Tuyến / Khách tuyến / GPS / Chuẩn bị phiên
[ ] C1.3 Danh sách tuyến đọc từ API thật
[ ] C1.4 Card tuyến compact, không landing page dài
[ ] C1.5 Không trộn dữ liệu phiên ngày vào /routes
[ ] C1.6 Không có nút giả
```

Pass khi:

```text
[ ] /routes chỉ hiển thị dữ liệu master
[ ] Xem chi tiết tuyến được
[ ] Không có khách/kết quả phiên ngày lẫn vào
```

## C2. Tạo / sửa tuyến master

Cần backend/API:

```text
POST  /api/routes
PATCH /api/routes/:id
PATCH /api/routes/:id/status
```

Checklist:

```text
[ ] C2.1 Audit backend hiện có endpoint chưa
[ ] C2.2 Nếu thiếu thì bổ sung backend đúng layer
[ ] C2.3 Popup tạo tuyến
[ ] C2.4 Popup sửa tuyến
[ ] C2.5 Trường: tên tuyến
[ ] C2.6 Trường: khu vực
[ ] C2.7 Trường: sale/người phụ trách
[ ] C2.8 Trường: thứ/ngày chạy tuyến
[ ] C2.9 Trường: trạng thái active/tạm dừng
[ ] C2.10 Lưu xong reload vẫn đúng
```

Pass khi:

```text
[ ] Tạo tuyến mới thấy trong danh sách
[ ] Sửa tuyến reload vẫn giữ
[ ] Tạm dừng tuyến không hiện ở danh sách mở phiên
```

## C3. Khách trong tuyến

Cần backend/API:

```text
POST  /api/routes/:routeId/customers
PATCH /api/routes/customers/:id
PATCH /api/routes/customers/:id/hide
PATCH /api/routes/customers/reorder
```

Checklist:

```text
[ ] C3.1 Audit endpoint hiện có chưa
[ ] C3.2 Popup thêm khách tuyến
[ ] C3.3 Popup sửa khách tuyến
[ ] C3.4 Ẩn khách khỏi tuyến
[ ] C3.5 Đổi thứ tự ghé
[ ] C3.6 Khách active mới được copy vào phiên mới
[ ] C3.7 Ẩn khách không xóa lịch sử phiên cũ
```

Pass khi:

```text
[ ] Thêm khách xong thấy ở tab Khách tuyến
[ ] Sửa khách reload vẫn đúng
[ ] Ẩn khách không vào phiên mới
[ ] Thứ tự ghé đúng khi mở phiên
```

## C4. GPS khách tuyến

Cần backend/API:

```text
PATCH /api/routes/customers/:id/gps
```

Checklist:

```text
[ ] C4.1 Danh sách khách thiếu GPS
[ ] C4.2 Mở Google Maps
[ ] C4.3 Lấy GPS hiện tại nếu browser cho phép
[ ] C4.4 Nhập lat/lng thủ công
[ ] C4.5 Lưu GPS
[ ] C4.6 Reload vẫn giữ GPS
```

Pass khi:

```text
[ ] Lưu GPS xong khách ra khỏi tab Cần GPS
[ ] Mở maps đúng tọa độ
```

## C5. Chuẩn bị / mở phiên MCP ngày

Cần backend/API:

```text
POST /api/mcp-day/open-session
GET  /api/mcp-day/data?date=YYYY-MM-DD&routeId=...
```

Checklist:

```text
[ ] C5.1 Chọn tuyến cố định
[ ] C5.2 Chọn ngày thực thi
[ ] C5.3 Chọn sale/người phụ trách
[ ] C5.4 Mở phiên ngày
[ ] C5.5 Nếu phiên đã có thì dùng lại
[ ] C5.6 Không duplicate mcp_session_customers
[ ] C5.7 Mở xong chuyển qua /visits đúng phiên
```

Pass khi:

```text
[ ] Mở phiên routeId + date lần 1 tạo session
[ ] Mở lại lần 2 không duplicate
[ ] /visits hiển thị đúng tuyến/ngày/sale
```

---

# Gate D - /visits Phiên MCP Ngày

Mục tiêu: `/visits` chỉ xử lý phiên đã mở, không sửa master.

## D1. Chọn đúng phiên

```text
[ ] D1.1 /visits nhận routeId + date hoặc sessionId
[ ] D1.2 Không tự lấy latest session sai tuyến/ngày
[ ] D1.3 Header hiện tuyến/ngày/sale/trạng thái
[ ] D1.4 Tab: Khách phiên / Kết quả / Phát sinh / Follow-up
```

Pass khi:

```text
[ ] Mở từ /routes qua /visits đúng phiên vừa chọn
```

## D2. Xử lý khách phiên

Cần backend/API:

```text
PATCH /api/mcp-day/session-customer/status
```

Checklist:

```text
[ ] D2.1 Card khách phiên gọn
[ ] D2.2 Mở xử lý khách
[ ] D2.3 Check-in
[ ] D2.4 Bỏ qua
[ ] D2.5 Bỏ qua bắt buộc có lý do
[ ] D2.6 Ghi chú ghé
[ ] D2.7 Reload vẫn giữ trạng thái
```

Pass khi:

```text
[ ] Check-in chuyển trạng thái Đã ghé
[ ] Bỏ qua có lý do
[ ] Không mất sessionCustomerId
```

## D3. Thêm khách phát sinh trong phiên

Cần backend/API:

```text
POST /api/mcp-day/session-customer/add
```

Checklist:

```text
[ ] D3.1 Popup thêm khách phát sinh
[ ] D3.2 Nhập tên khách
[ ] D3.3 Nhập SĐT
[ ] D3.4 Nhập khu vực/địa chỉ
[ ] D3.5 Lưu vào session hiện tại
[ ] D3.6 source = added
[ ] D3.7 Không thay đổi tuyến master
```

Pass khi:

```text
[ ] Thêm xong xuất hiện ở tab Phát sinh
[ ] Reload vẫn còn
[ ] /routes master không bị thêm nhầm
```

## D4. Ghi kết quả / test / báo cáo / follow-up

Cần backend/API:

```text
POST /api/mcp-day/session-customer/result
POST /api/mcp-day/session-customer/followup
```

Checklist:

```text
[ ] D4.1 Ghi có đơn
[ ] D4.2 Ghi có test
[ ] D4.3 Ghi báo cáo
[ ] D4.4 Tạo follow-up
[ ] D4.5 Tab Kết quả cập nhật
[ ] D4.6 Tab Follow-up cập nhật
[ ] D4.7 Reload vẫn đúng
```

Pass khi:

```text
[ ] Action lưu được vào đúng session customer
[ ] Không tạo record mồ côi
```

---

# Gate E - Đơn hàng thật

Mục tiêu: tạo đơn thật, không chỉ ghi cờ có đơn.

## E1. Backend đơn hàng

Cần API:

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

Checklist:

```text
[ ] E1.1 Audit schema orders/order_items
[ ] E1.2 Xác định cần session_customer_id hay visit_id
[ ] E1.3 Bổ sung API tạo đơn
[ ] E1.4 Bổ sung API item đơn
[ ] E1.5 Bổ sung API trạng thái đơn
```

Pass khi:

```text
[ ] Tạo order + order_items bằng API thật
[ ] Order trace được về MCP session/customer
```

## E2. UI tạo đơn từ MCP

Checklist:

```text
[ ] E2.1 Popup tạo đơn từ khách trong /visits
[ ] E2.2 Chọn/nhập sản phẩm
[ ] E2.3 Số lượng
[ ] E2.4 Đơn giá
[ ] E2.5 Thành tiền tự tính
[ ] E2.6 Lưu nháp
[ ] E2.7 Chốt đơn
[ ] E2.8 Tạo xong /orders thấy đơn
```

Pass khi:

```text
[ ] Tạo đơn từ /visits xong /orders thấy đơn
[ ] Doanh thu tăng đúng
```

## E3. /orders theo dõi đơn/doanh thu

Checklist:

```text
[ ] E3.1 Danh sách đơn
[ ] E3.2 Xem chi tiết đơn
[ ] E3.3 Sửa trạng thái đơn
[ ] E3.4 Lọc theo ngày
[ ] E3.5 Lọc theo tuyến
[ ] E3.6 Lọc theo sale
[ ] E3.7 KPI doanh thu
```

Pass khi:

```text
[ ] Đơn tạo từ MCP được lọc đúng tuyến/ngày/sale
```

---

# Gate F - Dashboard / Doanh thu thật

Mục tiêu: dashboard lấy dữ liệu thật, không mock.

Checklist:

```text
[ ] F1. Doanh thu hôm nay
[ ] F2. Đơn hôm nay
[ ] F3. Lượt ghé hôm nay
[ ] F4. Tỷ lệ ghé
[ ] F5. Tỷ lệ có đơn
[ ] F6. Việc cần xử lý
[ ] F7. Tạo đơn mới dashboard đổi
[ ] F8. Check-in khách dashboard đổi
[ ] F9. Follow-up mới dashboard đổi
```

Pass khi:

```text
[ ] Dashboard thay đổi theo dữ liệu thật sau thao tác MCP/order
```

---

# Nhật ký test

## Lần test 1

```text
Ngày test:
Thiết bị:
Gate:
Kết quả:
Lỗi cần sửa:
Ảnh/video kèm theo:
```

## Lần test 2

```text
Ngày test:
Thiết bị:
Gate:
Kết quả:
Lỗi cần sửa:
Ảnh/video kèm theo:
```
