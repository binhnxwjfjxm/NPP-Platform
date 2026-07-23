# A5.4 — Migrate remaining direct REST mutations

> Trạng thái: **A5.4.1 SOURCE VERIFIED / DEPLOY PENDING**
> Ngày audit: **2026-07-15**
> Phụ thuộc đã đạt: A5 audit, A5.1 scanner, A5.2 atomic result/add, A5.3 Edge retirement and strict production smoke

## 1. Mục tiêu

Loại bỏ toàn bộ mutation nghiệp vụ còn gọi trực tiếp Supabase/PostgREST từ transitional API, legacy backend hoặc Next server code.

Kiến trúc đích:

```text
Browser/PWA
-> Next.js proxy
-> authenticated Foundation Gateway
-> application use case
-> repository/transaction port
-> Supabase/PostgreSQL adapter hoặc service-role-only RPC
```

A5.4 không mở Order Core, không thay contract MCP v1 và không gộp persisted idempotency/audit của A5.5.

## 2. Bằng chứng đầu vào

Scanner artifact của Foundation CI run `29422083699`:

```text
findings=65
approved=48
legacy_debt=17
forbidden=0
unclassified=0
completed_phases=A5.2,A5.3
```

Production A5.3 đã xác minh trên commit `7b68742`:

```text
result=404 SESSION_CUSTOMER_NOT_FOUND
add=404 SESSION_NOT_FOUND
followup=404 SESSION_CUSTOMER_NOT_FOUND
LEGACY_EDGE_CALLER=PASS
A5_3_STRICT_SMOKE=PASS
```

## 3. Inventory theo reachability

### 3.1 Dead legacy code — xóa trước

Hai implementation direct-table cũ vẫn tồn tại trong `apps/backend/server.js` nhưng không còn được `handlePost` gọi:

```text
openMcpDaySession
updateMcpSessionCustomerStatus
```

Production routes hiện gọi implementation RPC:

```text
POST /api/mcp-day/open-session
-> openMcpDaySessionV1
-> mcp_open_route_session

POST /api/mcp-day/session-customer/status
-> updateMcpSessionCustomerStatusV1
-> mcp_set_session_customer_status
```

Bảy fingerprint dead code cần retire:

```text
1dc555d44cc89f4bfaa50180  mcp_route_sessions
abf55ef270a7e39894bf265d  mcp_session_customers
89edbaea655813b7ea00bc40  mcp_route_sessions
7b35ad1f6bb6f4a506761a51  mcp_visits
4c9adfa1c08d263a002e5cde  mcp_session_customers
2dfa3c8e754823d8ce845e11  mcp_route_sessions
6e5f15d9cd15ee8e012e151d  mcp_visits
```

Không tạo RPC mới cho nhóm này. Exit đúng là xóa implementation chết, giữ route RPC V1 và thêm regression test chống direct implementation quay lại.

### 3.2 Reachable transitional API mutations

`apps/backend/foundation/transitional-api.js` còn năm direct REST findings:

| Endpoint | Function | Provider target | Fingerprint |
|---|---|---|---|
| `POST /api/field-checks/result` | `saveFieldCheckResult` | insert/patch `test_customer_results` | `474001fbfa0d1de1ed003364` / `f70d562b03f15f08cae868e8` |
| `POST /api/mcp-market-reports` | `saveMarketReport` | insert `market_reports` | `ffb1c503e59aa8fcf8f0344f` |
| `POST /api/mcp-report-setting-groups` | `createSettingGroup` | insert `mcp_setting_groups` | `6ae585a158e2fd800062fb45` |
| `PATCH /api/mcp-report-setting-groups` | `updateSettingGroup` | patch `mcp_setting_groups` | `500b241ecd80ff8d74047e27` |

Required replacement:

```text
transport parser
-> use case
-> repository/RPC
-> canonical DTO/error
```

Provider table names and PostgREST query strings must disappear from transitional handlers.

### 3.3 Reachable legacy backend mutations

`apps/backend/server.js` còn ba direct-table findings trên live routes:

| Endpoint | Function | Provider target | Fingerprint |
|---|---|---|---|
| `POST /api/mcp-session-report/ai-result` | `persistMcpSessionAiResultV1` | patch `mcp_session_reports` | `6a660d7d414afe70cd88cc4d` |
| `POST /api/mcp-report-settings` | `createMcpReportSettingV1` | insert `mcp_setting_items` | `ea3fdd0cec40084d8ba06c1f` |
| `PATCH /api/mcp-report-settings` | `updateMcpReportSettingV1` | patch `mcp_setting_items` | `204c2501e1755878fd26bf36` |

`POST /api/mcp-session-report` đã dùng `mcp_create_session_report_snapshot`; AI-result phải theo cùng aggregate owner thay vì direct patch.

### 3.4 Next server session-report mutations

Hai implementation Next server trực tiếp upsert `mcp_session_reports` bằng service-role REST:

```text
src/lib/mcp/session-report-snapshot.ts
  saveMcpSessionReportSnapshot
  fingerprint ea324aaa3d01a7941bf3aa3f

src/lib/mcp/session-report.ts
  saveMcpSessionReportSnapshot
  fingerprint 1502e64fc75da4598b208f1a
```

Đây còn là duplicate owner. Canonical snapshot write đã có backend endpoint/RPC:

```text
POST /api/mcp-session-report
-> mcp_create_session_report_snapshot
```

A5.4 phải audit toàn bộ caller trước khi xóa hai helper; mọi caller cần chuyển sang backend proxy/use case. Không giữ fallback direct Supabase tại Vercel.

## 4. Thứ tự implementation bắt buộc

### A5.4.1 — Remove unreachable A5.2 direct-table implementations

```text
- chứng minh route chỉ gọi RPC V1;
- xóa openMcpDaySession direct implementation;
- xóa updateMcpSessionCustomerStatus direct implementation;
- retire 7 fingerprints;
- scanner legacy debt: 17 -> 10;
- backend tests/build/smoke giữ nguyên.
```

Không migration DB và không deploy Supabase cho slice này.

### A5.4.2 — Consolidate session-report write ownership

```text
- inventory caller của hai Next snapshot helpers;
- chuyển caller sang /api/mcp-session-report;
- thêm backend use case/RPC cho AI result;
- xóa direct Next upserts và direct legacy patch;
- một transaction/aggregate owner cho snapshot + AI state;
- canonical 404/409/provider errors;
- scanner legacy debt: 10 -> 7.
```

Migration/RPC phải service-role-only và có production transaction smoke với rollback hoặc fixture cleanup.

### A5.4.3 — Move report settings mutations behind application boundary

```text
- setting group create/update;
- setting item create/update;
- validate group/item existence and uniqueness;
- repository/RPC contract;
- actor/requestId context;
- scanner legacy debt: 7 -> 3.
```

Không dùng một generic direct-table endpoint cho mọi settings.

### A5.4.4 — Move field-check and market-report writes

```text
- field-check result create/update use case;
- market-report create use case;
- preserve current public DTO;
- normalize business/provider errors;
- remove final transitional direct REST mutation;
- scanner legacy debt: 3 -> 0.
```

A5.4 chỉ đóng khi scanner không còn `known-legacy-debt` thuộc direct REST mutation.

## 5. Transaction and idempotency boundary

A5.4 phải bảo đảm:

```text
- multi-write nghiệp vụ nằm trong một transaction/RPC;
- no success when zero rows were applied;
- retry không tạo duplicate theo natural/source key hiện có;
- requestId/actor/installation context được lưu ở audit/raw payload phù hợp;
- unknown provider failure vẫn fail closed;
- public API không lộ table/RPC/provider diagnostics.
```

Persisted idempotency store và append-only audit chuẩn hóa toàn hệ thống vẫn thuộc A5.5. A5.4 không được tạo giải pháp tạm mâu thuẫn với A5.5.

## 6. Test gates mỗi slice

```text
[ ] Scanner baseline/policy pass
[ ] Không thêm unclassified/forbidden finding
[ ] Repository/use-case tests pass
[ ] Canonical Gateway tests pass
[ ] Unknown provider errors remain 502/503 neutral errors
[ ] Build/typecheck pass
[ ] Migration source contract test pass nếu có migration
[ ] Production deploy atomic + health pass
[ ] Non-mutating or rollback smoke pass
[ ] Logs prove no retired/direct path invocation
[ ] Retirement ledger records removed fingerprints
```

## 7. Không được làm

```text
- không gom toàn bộ 17 findings vào một PR;
- không đổi public DTO để né migration;
- không copy service-role logic sang Next/Vercel;
- không giữ dead direct-table function làm fallback;
- không sửa production DB mà thiếu migration;
- không đánh dấu pass chỉ vì HTTP status đúng;
- không mở Order Core trước khi A5.4/A5.5 và Foundation gate kế tiếp đạt.
```

## 8. Exit gate

A5.4 chỉ được đánh dấu `DEPLOYED / VERIFIED` khi:

```text
- 17 debt đầu kỳ đã được phân loại và xử lý;
- 7 dead fingerprints đã retire;
- 10 reachable direct REST fingerprints đã thay bằng backend use case/repository/RPC;
- scanner legacyDebt=0 cho phạm vi A5 direct mutation;
- canonical API tests và production smoke pass;
- Next/Vercel không còn service-role direct mutation;
- MCP v1 không regression;
- A5.5 scope vẫn tách riêng và có dependency rõ ràng.
```
