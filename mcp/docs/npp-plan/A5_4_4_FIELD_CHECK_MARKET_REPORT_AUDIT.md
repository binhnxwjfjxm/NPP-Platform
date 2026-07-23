# A5.4.4 — Field-check + market-report write ownership audit

> Cập nhật: **2026-07-16**  
> Trạng thái: **AUDIT COMPLETE — IMPLEMENTATION NOT STARTED**  
> Scanner đầu vào: **3 legacy mutation findings**  
> Mục tiêu: **3 -> 0**

## 1. Phạm vi

Ba fingerprints còn lại:

```text
474001fbfa0d1de1ed003364  field-check direct PATCH
f70d562b03f15f08cae868e8  field-check direct POST
ffb1c503e59aa8fcf8f0344f  market-report direct POST
```

Tất cả hiện nằm trong `apps/backend/foundation/transitional-api.js`.

## 2. Field-check caller và ownership hiện tại

Caller live:

```text
src/features/market-checks/MarketChecksClientPage.tsx
POST /api/field-checks/result
```

Next route:

```text
src/app/api/field-checks/result/route.ts
-> authenticated backend proxy
-> Foundation transitional handler
```

Handler hiện tại:

```text
saveFieldCheckResult()
-> PATCH test_customer_results khi có resultId
-> POST test_customer_results khi không có resultId
```

### Phân loại live/dead

- PATCH/update là luồng live: màn field-check chỉ mở các kết quả đã gắn với `mcp_session_customers.test_id`.
- POST/create là fallback không đúng logic và không reachable trong dữ liệu hợp lệ.
- Production có 4 session customer mang `test_id`; cả 4 đều match đúng một `test_customer_results`; missing result = 0.
- Data loader khi thiếu result cũng không có đủ `fileId/customerId` để tạo row hợp lệ, nên fallback create không thể cứu dữ liệu hỏng.

Kết luận: **không tạo RPC create field-check mới**. Bắt buộc require `resultId` và fail `404` nếu row không tồn tại.

## 3. Lỗi logic trong field-check hiện tại

### 3.1 Status domain bị lệch

UI dùng ba trạng thái trình bày:

```text
normal
opportunity
risk
```

DB hiện dùng domain nghiệp vụ:

```text
pending 184
ok 55
retry 18
follow 18
interested 13
bad 9
sample 5
```

Handler hiện ghi thẳng ba giá trị UI vào DB, tạo thêm vocabulary mới và làm dữ liệu phân mảnh.

Implementation phải tách presentation khỏi persistence. Mapping ghi đề xuất:

```text
normal      -> ok
opportunity -> interested
risk        -> bad
```

Mapping đọc phải bao phủ domain cũ:

```text
opportunity: ok, interested, sample
risk:        bad, retry, follow
normal:      pending, tested và giá trị còn lại
```

### 3.2 PATCH hiện fail-open

Direct PostgREST PATCH có thể trả `[]` khi `resultId` không tồn tại; handler lấy `firstRow()` và vẫn trả HTTP 200 với `data: null`.

RPC mới phải:

- lock row bằng `FOR UPDATE`;
- bỏ qua/không cho sửa row `deleted_at` khác null;
- trả `field_check_result_not_found` -> HTTP 404;
- validate `product_name`, status và metadata trước khi ghi.

### 3.3 raw_payload bị overwrite

Handler hiện thay toàn bộ `raw_payload` bằng body mới + Foundation context. Việc này có thể làm mất metadata cũ như `kind`, source hoặc liên kết khác.

RPC mới phải merge:

```text
existing raw_payload
+ whitelisted input metadata
+ foundation_context
```

Không được overwrite mù toàn bộ JSON.

## 4. Market-report route cũ

Route còn tồn tại:

```text
src/app/api/mcp-market-reports/route.ts
POST /api/mcp-market-reports
-> saveMarketReport()
-> direct POST market_reports
```

Nhưng active MCP UI dùng route khác:

```text
src/features/mcp/McpSessionCompactViewFinal2.tsx
POST /api/backend/mcp-day/session-customer/report
-> legacy internal application handler
-> mcp_create_report_from_session_customer RPC
```

Production evidence:

```text
market_reports total:                         5
source=mcp_create_report_from_session_customer: 3
source=mcp_market_report_api:                   0
session-customer linked:                        3
```

Route cũ còn có lỗi schema: `market_reports.id` là NOT NULL, không có default, nhưng `saveMarketReport()` không gửi `id`; nếu gọi thật sẽ fail insert.

Kết luận: `/api/mcp-market-reports` là **duplicate dead/broken write path**. Phải xóa Next route và Foundation handler, không tạo RPC thay thế.

## 5. Database audit

```text
test_customer_results rows: 302
market_reports rows:          5
orphan result file:           0
orphan result customer:       0
session customer test_id:     4
matched result:               4
missing result:               0
```

Existing canonical RPCs:

```text
mcp_create_test_from_session_customer
mcp_create_report_from_session_customer
```

Hai RPC trên là service-role-only và đang sở hữu create flow trong phiên MCP.

Không có typed RPC update field-check hiện tại.

### RLS debt cần đóng cùng cutover

Hai bảng vẫn có policy permissive cho anon:

```text
test_customer_results: anon INSERT + UPDATE WITH CHECK true
market_reports:         anon INSERT + UPDATE WITH CHECK true
```

Scanner không coi policy là source caller, nhưng đây vẫn là đường ghi công khai. Sau khi retire ba source findings phải drop/revoke các policy mutation anon này; SELECT policy có thể giữ nếu read contract còn cần.

## 6. Ownership đích

### Field-check

```text
Browser
-> Next proxy
-> authenticated Foundation Gateway
-> field-check application use case
-> mcp_update_field_check_result service-role-only RPC
-> locked test_customer_results row
```

Input bắt buộc:

```text
resultId
productName
status presentation value
note optional
productId optional
sessionCustomerId optional but verify when supplied
Foundation context
```

Output là row đã cập nhật trong canonical envelope.

### Market report

Không thêm owner mới. Giữ owner chuẩn hiện tại:

```text
/api/backend/mcp-day/session-customer/report
-> mcp_create_report_from_session_customer
```

Xóa duplicate route `/api/mcp-market-reports`.

## 7. Thứ tự implementation bắt buộc

1. Tạo branch/PR riêng cho A5.4.4.
2. Tạo `field-check-mutations.js` tại Foundation.
3. Tạo một RPC `mcp_update_field_check_result` service-role-only.
4. RPC lock row, validate, map status, merge raw payload/context và fail 404 đúng.
5. Chuyển `/api/field-checks/result` sang use case mới và require `resultId`.
6. Xóa direct PATCH và direct POST `test_customer_results`.
7. Xóa dead Next route `/api/mcp-market-reports` và `saveMarketReport()` handler.
8. Drop anon INSERT/UPDATE policies của `test_customer_results` và `market_reports`; giữ read policy nếu cần.
9. Sửa UI status read/write mapping để không tạo vocabulary mới.
10. Thêm migration/use-case/Gateway/caller/dead-route/RLS regression tests.
11. Retire đúng ba fingerprints; scanner phải `3 -> 0`, unclassified 0, forbidden 0.
12. Apply migration production, smoke update field-check có restore/cleanup, deploy VPS và ghi evidence.

## 8. Ngoài phạm vi

- Không sửa `mcp_create_test_from_session_customer` hoặc `mcp_create_report_from_session_customer` nếu không có lỗi regression trực tiếp.
- Không mở persisted idempotency/audit; phần đó thuộc A5.5.
- Chưa bắt đầu Order Core.
- Audit này không thay đổi code hoặc database.