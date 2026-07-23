# MCP v1 Freeze

Ngày khóa core: 2026-07-12.

## Kiến trúc bắt buộc

```text
Browser
  -> Next.js/Vercel route proxy
  -> MCP VPS backend (165.22.109.61 / PM2 mcp-plan-backend)
  -> Supabase bằng service role trên VPS
```

Vercel và browser không giữ `SUPABASE_SERVICE_ROLE_KEY` và không tự thực hiện mutation MCP.

## Contract phiên

- Một tuyến chỉ có một phiên cho một ngày: unique `(route_id, session_date)`.
- Mở lại cùng tuyến/ngày dùng lại phiên cũ.
- Khách active trong route master chỉ được snapshot khi phiên được tạo lần đầu.
- Kể cả phiên được mở lần đầu khi tuyến chưa có khách, khách thêm vào route master sau đó không được chèn vào phiên cũ khi mở lại.
- Visit luôn dùng `mcp_route_sessions.session_date`, không dùng ngày hiện tại của server.
- `done`, `completed`, `cancelled` là read-only đối với checklist, visits và follow-up; insert/update/delete đều bị chặn ở DB.
- Chốt phiên tạo/upsert một `mcp_session_reports` snapshot.
- Phiên rỗng được xóa; phiên có visit/đơn/test/báo cáo/follow-up bị chặn bằng HTTP 409.
- Xóa route/khách dứt điểm chỉ đi qua RPC nội bộ có transaction-local bypass; không mở khóa phiên cho mutation thường.

## Mutation API qua VPS

```text
POST  /api/mcp-day/open-session
POST  /api/mcp-day/session-customer/status
POST  /api/mcp-day/session-customer/order
POST  /api/mcp-day/session-customer/test
POST  /api/mcp-day/session-customer/report
POST  /api/mcp-day/session-customer/followup
POST  /api/mcp-session-report
PATCH /api/mcp-sessions/:id
DELETE /api/mcp-sessions/:id

POST  /api/routes
PATCH /api/routes/:id
POST  /api/routes/:id/archive
POST  /api/route-customers
PATCH /api/route-customers/:id
POST  /api/route-customers/:id/archive

GET   /api/mcp-report-settings
POST  /api/mcp-report-settings
PATCH /api/mcp-report-settings
```

## Khóa ở tầng DB

- Các bảng `public.mcp_*` không cấp `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES` hoặc `TRIGGER` cho `PUBLIC`, `anon`, `authenticated`.
- Chỉ giữ quyền đọc theo các policy SELECT hiện có.
- Toàn bộ policy RLS ghi trên bảng `mcp_*` đã được gỡ.
- RPC mutation, RPC save template, import, recalc và trigger/helper không cho `anon/authenticated` gọi trực tiếp.
- `service_role` trên VPS là đường ghi duy nhất vào MCP.

## Contract nghiệp vụ

### Đơn

Input bắt buộc: `sessionCustomerId`, ít nhất một item, tên sản phẩm, số lượng > 0. Item giữ `productId`, `variantId`, SKU, đơn vị, đơn giá, chiết khấu và ghi chú.

Output thật:

```text
orders
order_items
mcp_visits.has_order / order_id
mcp_session_customers.order_id
mcp_route_sessions.order_count
```

### Test

Input bắt buộc: `sessionCustomerId`, ít nhất một kết quả có sản phẩm. Trạng thái hợp lệ:

```text
pending | tested | ok | interested | sample | follow | bad | retry
```

Output thật:

```text
test_files
test_customers
test_customer_results
mcp_visits.has_test / test_id
mcp_session_customers.test_id
mcp_route_sessions.test_count
```

### Báo cáo thị trường

Input giữ đầy đủ `fields`, `selected` và `context`. `reportType=market_report` được hỗ trợ cùng các loại `price`, `competitor`, `display`, `stock`, `demand`, `general`.

Output thật:

```text
market_reports
mcp_visits.has_report / report_id
mcp_session_customers.report_id
mcp_route_sessions.report_count
```

### Follow-up

Input gồm tiêu đề, ngày hẹn, owner, priority, loại follow-up và ghi chú. Priority hợp lệ: `low | medium | high | urgent`.

Output thật:

```text
mcp_followups
mcp_session_customers.followup_count
mcp_route_sessions.followup_count
```

## Error contract

```text
400: payload thiếu hoặc giá trị không hợp lệ
404: route/session/session customer không tồn tại
409: phiên đã khóa, phiên có hoạt động, hoặc conflict nghiệp vụ
500/502/503: lỗi backend, Supabase hoặc cấu hình VPS
```

Không được trả thành công giả khi DB không áp dụng mutation.

## Migration khóa cuối

```text
20260712025937_freeze_mcp_v1_contract_20260711.sql
20260712033916_fix_mcp_open_session_snapshot_once_20260712.sql
20260712034606_lock_mcp_v1_database_mutation_boundary_20260712.sql
```

Hai migration cuối bảo đảm snapshot khách chỉ chạy khi session thật sự vừa được tạo, thêm DELETE guard cho child rows của phiên đã khóa, cho phép RPC hard-delete nội bộ dọn đúng logic và khóa toàn bộ đường ghi trực tiếp từ `anon/authenticated`.

## Smoke test đã chạy trên production DB

Các route/khách/phiên tạm được tạo rồi dọn sạch. Kết quả:

- mở lần đầu `created=true`, lần hai `created=false`, cùng session;
- snapshot khách = 1, không duplicate;
- visit của phiên quá khứ ghi đúng ngày `2026-06-15`;
- đơn tạo 1 order item và liên kết đúng;
- test tạo 1 kết quả và liên kết đúng;
- báo cáo và follow-up tạo thật;
- bộ đếm phiên đều bằng 1;
- xóa phiên có hoạt động bị chặn;
- chốt phiên trả `done` và tạo snapshot `close_session`;
- mutation sau chốt bị chặn;
- DELETE trực tiếp child row của phiên đã chốt bị chặn;
- hard-delete nội bộ vẫn dọn sạch được phiên đã chốt;
- phiên mở lần đầu với 0 khách vẫn giữ snapshot 0 sau khi route master được thêm khách rồi mở lại;
- phiên `cancelled` rỗng vẫn xóa được đúng logic;
- `anon` bị chặn cả ghi bảng trực tiếp lẫn gọi RPC mutation;
- service-role smoke toàn phiên vẫn pass sau khi khóa ACL;
- dữ liệu smoke được hard-delete sạch.

## Phạm vi để update sau

Template nâng cao ngoài report chips, offline queue/mobile, AI, Warehouse, Transport, Accounting và dashboard mở rộng không thuộc MCP v1 core freeze.
