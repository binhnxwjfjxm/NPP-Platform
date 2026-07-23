# Backend DB Alignment Audit

Ngày tạo: 2026-07-04

Nguyên tắc mới:

```text
Một phần chỉ được coi là xong khi khớp đủ 3 lớp:
1. Frontend UI
2. Backend API
3. Supabase DB
```

Không sửa tiếp kiểu vá UI lẻ. Mỗi phần phải có contract rõ trước khi code.

---

## 1. Hiện trạng DB Supabase

### 1.1 MCP tuyến / phiên ngày

Đã kiểm tra DB có dữ liệu thật:

```text
mcp_routes: 9
mcp_route_customers: 92
mcp_route_sessions: 10
mcp_session_customers: 42
orders: 10
order_items: 24
```

Các bảng chính:

```text
mcp_routes
mcp_route_customers
mcp_route_sessions
mcp_session_customers
mcp_visits
orders
order_items
```

### 1.2 Test sản phẩm

DB có nhóm bảng test thật:

```text
test_files: 8
test_file_products: 33
test_customers: 65
test_customer_results: 299
```

Các bảng chính:

```text
test_files
test_file_products
test_customers
test_customer_results
```

---

## 2. Hiện trạng backend VPS

Backend chính nằm ở:

```text
apps/backend/server.js
```

Backend hiện có các endpoint đọc/ghi chính:

```text
GET  /api/health
GET  /api/dashboard/summary
GET  /api/dashboard/overview
GET  /api/routes
GET  /api/routes/data
GET  /api/routes/customers/data
GET  /api/mcp-day/current
GET  /api/mcp-day/data
GET  /api/orders
GET  /api/tests
GET  /api/market-checks
GET  /api/market-checks/data
GET  /api/actions
GET  /api/actions/data

POST /api/mcp-day/open-session
POST /api/mcp-day/session-customer/status
POST /api/mcp-day/session-customer/result
POST /api/mcp-day/session-customer/add
POST /api/mcp-day/session-customer/followup
```

### Nhận xét

Backend đã có nền tốt cho MCP tuyến/phiên ngày:

```text
- đọc tuyến gốc từ mcp_routes
- đọc khách tuyến từ mcp_route_customers
- mở phiên ngày bằng mcp_route_sessions
- copy khách active sang mcp_session_customers
- không duplicate snapshot theo route_customer_id
- đọc phiên ngày từ mcp_session_customers + mcp_visits
- ghi status khách phiên
- proxy ghi result/add/followup qua Supabase Edge Function
```

Nhưng backend vẫn còn lệch tên nghiệp vụ ở Test:

```text
UI/API đang gọi market-checks
DB thật đang là test_files/test_customers/test_customer_results
```

---

## 3. Hiện trạng frontend API client

Frontend gọi backend qua:

```text
src/lib/api/api-client.ts
```

Các API đang dùng:

```text
getRoutesData()              -> GET /api/routes/data
getRouteCustomersData()      -> GET /api/routes/customers/data
getMcpDayData()              -> GET /api/mcp-day/data
createMcpDayResult()         -> POST /api/mcp-day/session-customer/result
addMcpDayCustomer()          -> POST /api/mcp-day/session-customer/add
createMcpDayFollowup()       -> POST /api/mcp-day/session-customer/followup
getMarketChecksData()        -> GET /api/market-checks/data
listOrders()                 -> GET /api/orders
```

### Vấn đề lớn

Nhiều GET API có `withMockFallback`. Nếu backend lỗi, UI vẫn rớt về mock.

Điều này làm app dễ bị ảo giác:

```text
UI thấy có dữ liệu nhưng không chắc backend thật chạy đúng
```

Khi bắt đầu làm từng phần khớp backend/DB, cần hạn chế hoặc hiển thị rõ trạng thái source:

```text
source = api
source = mock
```

---

## 4. Chọn phần đầu tiên để làm chuẩn

Phần đầu tiên nên là:

```text
P1 - Tuyến MCP gốc và mở phiên ngày
```

Lý do:

```text
1. Đây là gốc của quy trình MCP.
2. DB đã có bảng đầy đủ.
3. Backend đã có API gần đủ.
4. Frontend hiện đang rối tên nhưng có component sẵn.
5. Làm xong phần này mới có nền đúng cho /visits, đơn, test, báo cáo.
```

Không làm Test trước vì Test hiện lệch tên nhiều hơn:

```text
frontend: market-checks / field-checks
backend: /api/market-checks/data và /api/tests
DB: test_files/test_customers/test_customer_results
```

---

# P1 - Tuyến MCP gốc và mở phiên ngày

## 5. Mục tiêu nghiệp vụ P1

Người dùng cần hiểu và làm được 3 việc:

```text
1. Xem danh sách tuyến MCP gốc.
2. Xem khách thuộc từng tuyến.
3. Chọn tuyến + ngày để mở phiên đi tuyến.
```

Tên UI không dùng `/routes` hoặc `master`.

Tên hiển thị chuẩn:

```text
Tuyến MCP
Khách tuyến
Chuẩn bị phiên
Đi tuyến hôm nay
```

---

## 6. Contract DB cho P1

### 6.1 Tuyến MCP gốc

Bảng:

```text
mcp_routes
```

Field cần dùng:

```text
id
route_name
weekday
area
active
note
created_at
updated_at
```

### 6.2 Khách tuyến

Bảng:

```text
mcp_route_customers
```

Field cần dùng:

```text
id
route_id
customer_id
customer_name
phone
area
address
sort_order
active
note
geo_lat
geo_lng
geo_accuracy
geo_captured_at
google_maps_url
```

### 6.3 Phiên MCP ngày

Bảng:

```text
mcp_route_sessions
```

Field cần dùng:

```text
id
route_id
route_name
session_date
weekday
sales
area
status
planned_customers
visited_customers
order_count
test_count
report_count
created_at
updated_at
```

### 6.4 Khách trong phiên

Bảng:

```text
mcp_session_customers
```

Field cần dùng:

```text
id
session_id
route_id
route_customer_id
customer_id
customer_name
phone
area
address
sort_order
source
planned_status
visit_status
status_reason
visit_id
order_id
test_id
report_id
followup_count
note
created_at
updated_at
```

---

## 7. Contract backend cho P1

### 7.1 Xem tuyến MCP

Endpoint hiện có:

```text
GET /api/routes/data
```

Frontend nên dùng cho màn `Tuyến MCP`.

Response cần có:

```text
{
  data: {
    kpis: [...],
    routes: [
      {
        id,
        name,
        area,
        salesOwner,
        plannedCustomers,
        visitedCustomers,
        orderCount,
        lastVisitDate,
        status
      }
    ]
  },
  receivedAt
}
```

Trạng thái: có sẵn, cần test bằng API thật.

### 7.2 Xem khách tuyến

Endpoint hiện có:

```text
GET /api/routes/customers/data?routeId=...
```

Frontend nên lọc theo route đang chọn, không show 92 khách toàn hệ thống khi người dùng chỉ đang xem 1 tuyến.

Response cần có:

```text
{
  data: {
    kpis: [...],
    customers: [
      {
        id,
        routeId,
        routeName,
        accountId,
        accountName,
        contactName,
        area,
        sortOrder,
        status,
        gps,
        note
      }
    ]
  },
  receivedAt
}
```

Trạng thái: có sẵn, cần frontend dùng đúng routeId.

### 7.3 Mở phiên MCP ngày

Endpoint hiện có:

```text
POST /api/mcp-day/open-session
```

Payload chuẩn:

```json
{
  "routeId": "...",
  "sessionDate": "YYYY-MM-DD",
  "owner": "Sale"
}
```

Backend logic hiện có:

```text
1. Kiểm tra route tồn tại.
2. Route inactive thì chặn.
3. Tìm session theo route_id + session_date.
4. Có rồi thì dùng lại.
5. Chưa có thì tạo mcp_route_sessions.
6. Copy khách active từ mcp_route_customers sang mcp_session_customers.
7. Chống duplicate snapshot theo route_customer_id.
8. Return session + insertedSnapshotCount + snapshotCount.
```

Trạng thái: có sẵn, cần frontend gắn nút mở phiên thật.

### 7.4 Đọc phiên đang đi

Endpoint hiện có:

```text
GET /api/mcp-day/data
```

Vấn đề:

```text
Hiện backend loadLatestSession(), tức là lấy phiên mới nhất toàn hệ thống.
```

P1 chưa sửa endpoint này nếu chưa cần. Nhưng để đúng logic sau này, cần thêm query:

```text
GET /api/mcp-day/data?routeId=...&date=YYYY-MM-DD
```

Trạng thái: cần bổ sung ở phase sau P1 nếu muốn mở phiên xong đi đúng phiên.

---

## 8. Contract frontend cho P1

### 8.1 Màn Tuyến MCP

UI cần hiển thị:

```text
Title: Tuyến MCP
Subtitle: Quản lý tuyến gốc và chuẩn bị phiên đi tuyến.
```

Tabs:

```text
Tuyến
Khách tuyến
Cần GPS
Chuẩn bị phiên
```

Card tuyến:

```text
Tên tuyến
Khu vực · Sale phụ trách
Số khách
Lần ghé cuối
Trạng thái

[Xem khách] [Chuẩn bị phiên]
```

Không dùng chữ:

```text
/routes
master
session
snapshot
msc_...
```

### 8.2 Tab Khách tuyến

Chỉ show khách của tuyến đang chọn.

Nếu chưa chọn tuyến:

```text
Chọn một tuyến để xem khách trong tuyến.
```

Card khách:

```text
#STT Tên khách
Khu vực · SĐT
Địa chỉ/GPS
Trạng thái: Đang trong tuyến / Cần GPS / Đang ẩn

[Xem khách]
```

### 8.3 Tab Chuẩn bị phiên

Form/popup cần:

```text
Tuyến đã chọn
Ngày đi tuyến
Sale phụ trách
Nút: Mở phiên đi tuyến
```

Sau khi mở phiên:

```text
Hiển thị session đã tạo/dùng lại.
Hiển thị số khách trong phiên.
Có nút: Đi tuyến hôm nay.
```

---

## 9. P1 checklist pass/fail

### Backend pass

```text
[ ] GET /api/routes/data trả route thật từ mcp_routes
[ ] GET /api/routes/customers/data?routeId=... trả đúng khách của tuyến
[ ] POST /api/mcp-day/open-session tạo session nếu chưa có
[ ] POST /api/mcp-day/open-session gọi lại không duplicate khách
[ ] insertedSnapshotCount lần 2 = 0
[ ] snapshotCount đúng số khách active
```

### DB pass

```text
[ ] mcp_route_sessions có đúng 1 row cho route_id + session_date
[ ] mcp_session_customers có đúng số khách active của tuyến
[ ] Không tạo duplicate route_customer_id trong cùng session
```

### Frontend pass

```text
[ ] Màn hiển thị tên Tuyến MCP rõ
[ ] Chọn tuyến xong mới xem khách tuyến
[ ] Không hiện ID kỹ thuật
[ ] Nút Chuẩn bị phiên gọi POST thật
[ ] Lưu xong UI báo đã mở phiên
[ ] Reload vẫn thấy dữ liệu đúng từ API
```

---

## 10. Việc làm ngay sau audit này

Làm P1 theo thứ tự nhỏ:

```text
P1.1 Backend smoke test endpoint routes/customers/open-session.
P1.2 Sửa frontend Tuyến MCP chỉ đọc dữ liệu thật theo route đã chọn.
P1.3 Gắn nút mở phiên gọi POST /api/mcp-day/open-session.
P1.4 Test DB không duplicate.
P1.5 Chỉ khi P1 pass mới chuyển sang Đi tuyến hôm nay.
```

---

## 11. Không làm trong P1

```text
Không làm lại toàn bộ bottom nav.
Không làm Test sản phẩm.
Không làm Order create.
Không sửa safe-area/menu màu.
Không thêm banner test live.
Không đổi schema DB nếu backend hiện tại đủ.
```
