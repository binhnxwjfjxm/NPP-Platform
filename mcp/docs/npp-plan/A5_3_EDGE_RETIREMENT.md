# A5.3 — Retire public MCP mutation Edge Functions

> Trạng thái: **SOURCE COMPLETE / EDGE DEPLOYED / VPS PULL PENDING**  
> Ngày thực hiện: **2026-07-15**  
> Phụ thuộc đã đạt: A5 audit, A5.1 scanner, A5.2 atomic session-customer result/add, production Gateway cutover

## 1. Mục tiêu

Loại bỏ hai public Edge Function đang giữ service-role credential và mutation trực tiếp PostgreSQL/PostgREST:

```text
mcp-day-8b3
mcp-day-followup
```

Hai endpoint cũ không còn là owner nghiệp vụ. Canonical owner hiện tại:

```text
POST /api/mcp-day/session-customer/result
POST /api/mcp-day/session-customer/add
POST /api/mcp-day/session-customer/followup

Browser/PWA
-> Next.js/Vercel proxy
-> authenticated Foundation Gateway
-> backend use case / service-role-only RPC
-> PostgreSQL
```

A5.3 không thay contract MCP v1 và không mở Order Core.

## 2. Nguyên nhân phải retire

Source và production deployment cũ của hai function có các đặc điểm không được phép giữ trong sản phẩm bán thật:

```text
verify_jwt=false
Access-Control-Allow-Origin: *
SUPABASE_SERVICE_ROLE_KEY trong runtime Edge
public internet -> direct mutation
không actor/requestId/idempotency/audit boundary đầy đủ
multi-write không atomic ở Edge cũ
```

Chỉ bật `verify_jwt=true` trên implementation mutation cũ không sửa đúng nguyên nhân. Service-role mutation code phải bị loại khỏi public Edge surface.

## 3. Bằng chứng trước cutover

### 3.1 Source

A5.2 đã chuyển internal result/add caller sang hai RPC atomic service-role-only:

```text
mcp_record_session_customer_result
mcp_add_session_customer
```

Gateway intercept trực tiếp:

```text
POST /api/mcp-day/session-customer/result
POST /api/mcp-day/session-customer/add
```

Follow-up canonical path đã tồn tại trong MCP backend core:

```text
POST /api/mcp-day/session-customer/followup
```

Không có backend caller hiện hành cần gọi `mcp-day-followup`.

### 3.2 Production activity window

Supabase Edge logs trong cửa sổ 24 giờ tại thời điểm triển khai source ghi nhận:

```text
mcp-day-8b3: 2 request POST, đều HTTP 400, lúc khoảng 13:55 ngày 2026-07-15 (Asia/Ho_Chi_Minh)
mcp-day-followup: không có request trong kết quả log
```

Hai request `mcp-day-8b3` xảy ra trước khi cutover production ổn định. Sau cutover, frontend production result/add đã đi qua Gateway/RPC và smoke thành công.

Không dùng riêng việc “không có log” để kết luận an toàn. Quyết định retire còn dựa trên source caller inventory, Gateway interception, regression tests và canonical backend smoke.

## 4. Implementation

Mỗi function được thay bằng retirement stub:

```text
- không đọc SUPABASE_URL;
- không đọc SUPABASE_SERVICE_ROLE_KEY;
- không gọi /rest/v1/ hoặc /functions/v1/;
- không CORS wildcard;
- không mutation;
- mọi request trả HTTP 410;
- trả canonical error code EDGE_FUNCTION_RETIRED;
- phát sinh/forward X-Request-Id;
- Cache-Control: no-store.
```

Production deployment bắt buộc:

```text
verify_jwt=true
```

Kết quả mong đợi:

```text
request không có JWT hợp lệ -> platform chặn 401
request có JWT hợp lệ -> function trả 410 EDGE_FUNCTION_RETIRED
```

Không giữ backward-compatible mutation fallback trong Edge.

## 5. Audit retirement ledger

Static baseline cũ là bằng chứng audit, không bị xóa âm thầm.

A5.3 thêm:

```text
scripts/direct-db-mutation-retirements.json
scripts/audit-direct-db-mutation-policy.mjs
```

Quy tắc CI:

```text
- stale baseline chỉ được chấp nhận khi fingerprint nằm trong retirement ledger;
- fingerprint retired còn live -> fail;
- fingerprint không có trong baseline -> fail;
- classification không phải known-legacy-debt -> fail;
- replacementPhase không khớp phase retire -> fail;
- mutation Edge mới/đổi fingerprint -> unclassified/public-edge gate fail.
```

Như vậy lịch sử debt vẫn truy vết được, đồng thời source không thể đưa mutation Edge trở lại mà không làm CI đỏ.

## 6. Test và acceptance criteria

### 6.1 Source/CI

```text
[ ] Hai Edge source chứa EDGE_FUNCTION_RETIRED và status 410
[ ] Không còn SUPABASE_SERVICE_ROLE_KEY/SUPABASE_URL
[ ] Không còn /rest/v1/ hoặc /functions/v1/
[ ] Không CORS wildcard
[ ] Không method POST/PATCH/PUT/DELETE outbound
[ ] Retirement policy tests pass
[ ] Direct DB mutation scanner pass
[ ] Backend Foundation tests pass
[ ] Typecheck pass
[ ] Production build pass
```

### 6.2 Production deployment

```text
[ ] Merge source A5.3 vào main
[ ] Deploy mcp-day-8b3 exact source với verify_jwt=true
[ ] Deploy mcp-day-followup exact source với verify_jwt=true
[ ] List functions xác nhận version mới ACTIVE + verify_jwt=true
[ ] Direct unauthenticated call bị 401
[ ] Canonical result/add backend smoke pass
[ ] Canonical follow-up backend smoke pass
[ ] Không có Edge mutation request thành công
[ ] Full MCP smoke không regression
```

## 7. Deploy order

```text
1. CI source + scanner + build xanh.
2. Merge PR A5.3.
3. Lấy exact source từ main.
4. Deploy mcp-day-8b3 với verify_jwt=true.
5. Verify function metadata và direct denial.
6. Smoke canonical result/add.
7. Deploy mcp-day-followup với verify_jwt=true.
8. Verify function metadata và direct denial.
9. Smoke canonical follow-up.
10. Chạy full MCP smoke và kiểm tra logs.
```

Không cần `pullmcp` cho slice này vì canonical VPS backend đã được deploy ở A5.2; A5.3 chỉ thay Supabase Edge deployment sau source merge.

## 8. Forward-fix / incident handling

Không rollback bằng cách khôi phục public service-role mutation source hoặc `verify_jwt=false`.

Khi có regression:

```text
1. Giữ Edge fail-closed.
2. Sửa canonical backend use case/RPC.
3. Redeploy retirement stub exact source nếu deployment lệch.
4. Chạy permission + canonical API smoke.
5. Đối chiếu requestId/log và dữ liệu bị ảnh hưởng.
```

Git history giữ implementation cũ để điều tra, nhưng implementation đó không được redeploy thành public mutation endpoint.

## 9. Ngoài phạm vi A5.3

```text
mcp-order-save retirement/authentication
mcp-products read exposure review
anon INSERT/UPDATE policies trên legacy tables
A5.4 transitional/direct REST migration
A5.5 persisted idempotency + append-only audit
Order Core
clean-DB rehearsal / installation thứ hai
```

Các phần này tiếp tục đúng thứ tự A5/Foundation plan, không gộp vào một migration hoặc deploy lớn.

## 10. Exit gate

A5.3 chỉ được đánh dấu `DEPLOYED / VERIFIED` khi:

```text
- source và production của hai function không còn service-role mutation;
- verify_jwt=true được xác minh từ production metadata;
- direct public invocation không thể mutation;
- canonical result/add/follow-up smoke pass;
- scanner và retirement policy pass;
- full MCP v1 không regression.
```
