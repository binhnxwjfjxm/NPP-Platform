# A5.5 — Persisted idempotency + append-only audit

> Cập nhật: **2026-07-17**  
> Trạng thái: **AUDIT COMPLETE — IMPLEMENTATION NOT STARTED**  
> Code change: **NONE**  
> Migration: **NONE**

## 1. Kết luận ngắn

MCP-Plan hiện có **request correlation**, chưa có persisted idempotency.

```text
Có:
- x-request-id normalize/generate
- Idempotency-Key validate + forward
- Foundation context truyền vào một số RPC
- uniqueness / row lock / upsert ở từng nghiệp vụ

Chưa có:
- bảng idempotency
- request hash
- claim/lease
- replay response
- same-key/different-payload conflict
- append-only audit table
- audit trigger/event history
- mutation success audit cùng transaction
```

Các hành vi hiện tại như `ON CONFLICT`, unique constraint, reuse row hoặc PATCH lặp lại chỉ là **idempotent-ish**. Chúng không đáp ứng guarantee “cùng key + cùng payload trả lại cùng business result mà không chạy mutation lần hai”.

## 2. Luồng header hiện tại

### Next server proxy

`src/lib/api/backend-proxy.ts`:

- tự tạo/normalize `X-Request-Id`;
- chỉ forward `Idempotency-Key` khi request đầu vào đã có;
- không tự tạo mutation key;
- không lưu key;
- không replay response.

Vì vậy browser caller phải tự gửi một key ổn định cho cùng user intent. Các caller hiện tại không có helper chung bảo đảm việc này.

### Foundation Gateway

`apps/backend/foundation/request-context.js`:

- validate format `Idempotency-Key`;
- nhận key rỗng thành `null`;
- đưa key vào `context.idempotencyKey`;
- forward key xuống legacy internal runtime.

`apps/backend/foundation/gateway.js`:

- không claim key;
- không compute payload hash;
- không lock request;
- không lưu response;
- không replay;
- không thêm replay metadata.

Kết luận: Gateway hiện là transport/correlation boundary, chưa phải idempotency owner.

## 3. Mutation surface hiện tại

### 3.1 Foundation-owned — 9 route cases

```text
POST  /api/mcp-day/session-customer/result
POST  /api/mcp-day/session-customer/add
POST  /api/mcp-session-report
POST  /api/mcp-session-report/ai-result
POST  /api/field-checks/result
POST  /api/mcp-report-setting-groups
PATCH /api/mcp-report-setting-groups
POST  /api/mcp-report-settings
PATCH /api/mcp-report-settings
```

Có 8 RPC production nhận `p_context jsonb`:

```text
mcp_add_session_customer
mcp_record_session_customer_result
mcp_save_session_report_ai_result
mcp_update_field_check_result
mcp_create_report_setting_group
mcp_update_report_setting_group
mcp_create_report_setting_item
mcp_update_report_setting_item
```

Khoảng trống trong cùng aggregate:

```text
mcp_create_session_report_snapshot
```

RPC snapshot không nhận Foundation context. Nó upsert theo `session_id` và thay snapshot hiện tại, nên không có request trace của lần tạo snapshot.

### 3.2 Legacy-proxied — 21 route cases

PATCH/DELETE:

```text
PATCH  /api/mcp-sessions/:id
DELETE /api/mcp-sessions/:id
PATCH  /api/routes/:id
PATCH  /api/route-customers/:id
```

POST:

```text
/api/routes
/api/routes/:id/archive
/api/route-customers
/api/route-customers/:id/archive
/api/mcp-day/open-session
/api/mcp-day/session-customer/status
/api/mcp-day/session-customer/order
/api/mcp-day/session-customer/test
/api/mcp-day/session-customer/report
/api/mcp-day/session-customer/followup
/api/mcp-settings/order-template
/api/mcp-settings/test-template
/api/mcp-settings/report-template
/api/mcp-settings/followup-template
/api/mcp-settings/skip-reason-template
/api/mcp-settings/customer-add-rule
/api/mcp-settings/session-status
```

Gateway có forward context headers xuống internal port `3102`, nhưng `apps/backend/server.js` không đọc chúng để tạo trusted mutation context. Các RPC tương ứng không có context argument, không check idempotency và không ghi Foundation context.

Đã kiểm tra production RPC inventory cho các owner route/session/customer/order/test/report/follow-up/template: tất cả đều `hasContextArg=false`, `checksIdempotency=false`, `writesFoundationContext=false`.

## 4. Hành vi lặp hiện tại theo nhóm

### Create có uniqueness

Report setting group/item có unique constraint. Request lặp thường trở thành conflict/duplicate, không replay response đầu tiên.

```text
same key + same payload -> mutation chạy lại -> có thể 409
same key + khác payload -> cũng không có key conflict semantics riêng
```

### Update

Report setting update và field-check update lock row nhưng vẫn chạy lại:

- `updated_at` đổi;
- context lần mới thay context lần cũ;
- không trả snapshot response lần đầu.

### Session customer mutation

Các RPC có row lock và business conflict checks, nhưng không đọc `idempotencyKey`. Natural key/row state có thể ngăn một số duplicate, nhưng kết quả phụ thuộc trạng thái DB tại lần retry.

### Session report snapshot

`mcp_create_session_report_snapshot` dùng `ON CONFLICT (session_id) DO UPDATE` và thay toàn bộ snapshot mutable. Retry là rebuild/upsert lần nữa, không replay snapshot trước.

### AI result

`mcp_save_session_report_ai_result` update cùng report row và ghi context vào `raw_payload.aiResultContext`. Lần sau thay lần trước; đây là last-write metadata, không phải history.

## 5. Audit trail hiện tại

Production schema audit:

```text
idempotency tables/objects: 0
audit/event/history objects: 0
audit triggers:             0
pgcrypto:                   installed
database size:              16 MB
```

Không có append-only audit table. Không có trigger bảo vệ history.

`raw_payload.foundation_context` và `raw_payload.aiResultContext` là mutable metadata nằm cùng business row:

- update sau có thể overwrite context trước;
- snapshot upsert có thể thay toàn bộ raw payload;
- hard delete xóa luôn dấu vết;
- không lưu before/after hash;
- không lưu outcome của request thất bại;
- không thể query toàn bộ lịch sử theo actor/request/key một cách đáng tin cậy.

Coverage production hiện cũng không phải lịch sử:

```text
mcp_session_customers: 421 rows / 1 row có foundation_context
mcp_visits:            160 rows / 0
mcp_setting_groups:      7 rows / 0
mcp_setting_items:      52 rows / 0
test_customer_results: 304 rows / 0
```

PM2 stdout/stderr chỉ phù hợp vận hành tạm thời; không phải audit ledger vì có rotation/truncate, không atomic với DB và hiện không log structured event cho từng mutation.

## 6. Ownership đích

### 6.1 Bảng `mcp_idempotency_records`

Đây là state machine mutable, không phải audit ledger.

Đề xuất cột tối thiểu:

```text
id
installation_id
operation
idempotency_key
request_hash
status                processing | completed | failed
request_id
actor_id
actor_type
first_received_at
last_attempt_at
locked_until
attempt_count
response_status
response_payload       business payload, không chứa secret
completed_at
expires_at
error_code
created_at
updated_at
```

Constraint/index:

```text
UNIQUE (installation_id, operation, idempotency_key)
INDEX  (status, locked_until)
INDEX  (expires_at)
INDEX  (request_id)
```

Không dùng key toàn cục vì cùng key có thể hợp lệ cho hai operation khác nhau.

### 6.2 Bảng `mcp_audit_events`

Append-only ledger:

```text
id
occurred_at
schema_version
installation_id
npp_code
actor_id
actor_type
actor_authentication
request_id
idempotency_key
operation
http_method
route
aggregate_type
aggregate_id
action
outcome               succeeded | rejected | failed | replayed
status_code
request_hash
before_hash
after_hash
error_code
metadata               redacted JSON only
```

Bảo vệ:

- service role chỉ `INSERT` + đọc theo nhu cầu vận hành;
- anon/authenticated không có mutation grant;
- trigger từ chối `UPDATE` và `DELETE` kể cả khi gọi nhầm;
- không lưu backend token, Authorization, phone/address đầy đủ, AI prompt lớn hoặc raw request body;
- hard delete nghiệp vụ vẫn giữ audit event.

## 7. Transaction boundary bắt buộc

Không triển khai bằng cache memory hoặc Gateway-only finalize.

Luồng chuẩn cho typed mutation RPC:

```text
1. Gateway/Next nhận stable Idempotency-Key.
2. Backend normalize input thành operation payload canonical.
3. Tính SHA-256 từ operation + canonical normalized payload.
4. Typed RPC gọi helper claim trong cùng transaction.
5. UNIQUE + row lock quyết định:
   - key mới: tiếp tục mutation;
   - completed + cùng hash: return stored business response;
   - cùng key + khác hash: raise idempotency_key_conflict (409);
   - processing còn lease: raise idempotency_in_progress (409 + Retry-After);
   - processing hết lease: reclaim có kiểm soát.
6. Chạy business mutation.
7. Insert audit success event.
8. Lưu response_status/response_payload và mark completed.
9. Commit cả mutation + audit + completed record cùng lúc.
```

Nếu transaction fail, claim trong transaction cũng rollback; request retry có thể chạy lại an toàn. Không để trạng thái `completed` tồn tại khi business mutation chưa commit.

Đối với validation/auth failure xảy ra trước typed RPC, Gateway có thể gọi một RPC audit-failure riêng sau khi redact. Không dùng failure event đó làm bằng chứng mutation đã commit.

## 8. Response semantics

### Cùng key + cùng payload + completed

- không chạy mutation lần hai;
- trả cùng business data/status đã lưu;
- canonical envelope dùng `requestId` của attempt hiện tại;
- thêm metadata:

```text
idempotency.replayed = true
idempotency.originalRequestId = <request đầu>
```

Không giả mạo requestId hiện tại thành requestId cũ.

### Cùng key + khác payload

```text
HTTP 409
code: IDEMPOTENCY_KEY_CONFLICT
retryable: false
```

### Request đang xử lý

```text
HTTP 409
code: IDEMPOTENCY_IN_PROGRESS
retryable: true
Retry-After: số giây còn lại của lease
```

### Không có key

Trong rollout đầu chưa được âm thầm sinh random key ở proxy vì retry sẽ sinh key khác.

Policy đích:

- mutation route đã onboard: bắt buộc key;
- GET/HEAD/OPTIONS: không dùng key;
- route chưa onboard: phải ghi rõ unsupported trong inventory, không tuyên bố guarantee toàn hệ thống.

## 9. Canonical hash và redaction

- dùng JSON canonical sau validation/normalization, không hash raw body có khác biệt whitespace;
- JSONB text + `pgcrypto.digest(..., 'sha256')` có thể dùng trong DB;
- array order giữ nguyên vì có thể mang nghĩa nghiệp vụ;
- không đưa `requestId`, `receivedAt` hoặc retry attempt vào hash;
- operation/path phải nằm trong hash để chống reuse cross-route;
- loại token/Authorization và field nhạy cảm khỏi audit metadata;
- response snapshot chỉ lưu business payload cần replay, giới hạn kích thước.

## 10. Retention

Đề xuất rollout:

```text
idempotency completed records: 30 ngày mặc định
idempotency processing/failed:  7 ngày sau khi hết lease
order/hard-delete operation:    có thể cấu hình 90 ngày
audit events:                   365 ngày tối thiểu
```

Cleanup phải chạy qua function service-role-only, batch nhỏ theo `expires_at`. Audit ledger không được DELETE tùy ý; retention dùng partition/batch function có quyền riêng và phải tạo event `audit_retention_purge`.

## 11. Thứ tự implementation bắt buộc

### A5.5.1 — Core + Foundation-owned routes

1. Tạo schema `mcp_idempotency_records` và `mcp_audit_events`.
2. Tạo helper SQL claim/replay/complete và audit append.
3. Thêm canonical payload hashing + replay contract trong backend.
4. Bổ sung context cho `mcp_create_session_report_snapshot`.
5. Onboard đủ 9 Foundation-owned mutation route cases.
6. Thêm stable-key client helper và cập nhật caller tương ứng.
7. Test concurrent same-key, same-key different payload, crash rollback, replay envelope, missing key và audit append-only.
8. Production migration + smoke có cleanup.

### A5.5.2 — Legacy context + 21 route cases

1. `server.js` phải đọc only trusted forwarded context headers từ Foundation internal boundary.
2. Thêm `p_context` và typed idempotency/audit integration cho 21 route cases.
3. Không tạo generic table-write endpoint.
4. Ưu tiên operation rủi ro: order/test/report/follow-up, open session, hard delete, route/customer create.
5. A5.5 chỉ hoàn tất khi inventory ghi 30/30 mutation route cases onboard hoặc route được retire.

### A5.5.3 — Operations

1. Cleanup/retention job.
2. Audit query API service-role/admin-only.
3. Metrics: replay, conflict, in-progress, lease reclaim, audit insert failure.
4. Backup/restore và append-only enforcement test.

## 12. Gates

```text
same key + same payload concurrent: one mutation, one business result
same key + same payload later:      replay
same key + different payload:       409 conflict
mutation rollback:                  no completed record, no success audit
success commit:                     mutation + audit + completed atomic
browser direct writes:              0
anon/auth audit mutation:           denied
audit UPDATE/DELETE:                rejected
route coverage:                     explicit X/30
```

## 13. Ngoài phạm vi

- Chưa bắt đầu Order Core.
- Không dùng Redis/in-memory cache làm source of truth.
- Không dùng `requestId` thay cho idempotency key.
- Không coi `updated_at`, unique constraint hoặc mutable `raw_payload` là audit history.
- Audit này chưa sửa code, chưa tạo migration và chưa mở PR implementation.
