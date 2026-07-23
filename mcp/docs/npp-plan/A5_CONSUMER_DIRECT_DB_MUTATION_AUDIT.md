# A5 — Consumer Direct DB Mutation Audit

> Trạng thái: **COMPLETE / READ-ONLY AUDIT / LOCKDOWN NO-GO**  
> Ngày audit: **2026-07-15**  
> Repository: `minhmannguyengdp-sketch/MCP-Plan`  
> Source baseline: `f8d7db3a0b95bf09fd81e36181feb44feaa0f121`  
> Production đối chiếu: Supabase project `noiadkpkvdohljgopgfb`, chỉ metadata, aggregate activity và deployment source; không đọc PII, không mutation dữ liệu  
> Phạm vi thay đổi của branch: **documentation only; không sửa frontend/backend/function/migration/database/runtime và không deploy**

## 1. Mục tiêu

A5 trả lời bốn câu hỏi trước khi khóa direct database mutation:

```text
1. Consumer nào có thể mutation Supabase/PostgreSQL?
2. Consumer nào đang nằm đúng backend boundary, consumer nào bypass?
3. Mutation nào atomic, retry-safe, có actor/requestId/idempotency/audit?
4. Phải cutover theo thứ tự nào trước khi revoke table/function permission?
```

A5 không thực hiện:

```text
- runtime fix;
- Edge Function redeploy;
- migration;
- policy/grant revoke;
- production data change;
- VPS/Vercel deploy;
- Order Core implementation.
```

## 2. Phương pháp và bằng chứng

### 2.1 Source

Đã đối chiếu trực tiếp các boundary và consumer chính:

```text
package.json
src/app/api/**
src/lib/api/backend-proxy.ts
src/lib/export/supabase-rest.ts
src/lib/mcp/session-report-source.ts
apps/backend/server.js
apps/backend/foundation/gateway.js
apps/backend/foundation/transitional-api.js
apps/backend/foundation/supabase-adapter.js
supabase/functions/mcp-day-8b3/index.ts
supabase/functions/mcp-day-followup/index.ts
scripts/smoke-mcp-v1-api.mjs
scripts/smoke-f0-2-boundary.mjs
scripts/audit-runtime-hardcodes.mjs
.github/workflows/foundation-f0-2.yml
vercel.json
agent-backend/main.py
agent-backend/deploy-cloud-run.ps1
```

Đã dùng current-file inspection, package dependency, route re-export, dispatch table, commit history và production function source để phân biệt code hiện hành với fallback lịch sử.

GitHub code-search index của repository không khả dụng tại thời điểm audit. Vì vậy A5 khóa thêm một pre-lockdown gate bắt buộc: chạy literal static scan tại local/CI trước migration. Hạn chế này không được dùng để suy luận “không có consumer”; mọi đường chưa chứng minh phải fail gate.

### 2.2 Production metadata read-only

Đã truy vấn:

```text
- RLS enabled/forced;
- table grants;
- RLS policies;
- function EXECUTE grants;
- SECURITY DEFINER;
- triggers;
- view/materialized view/sequence inventory;
- storage bucket/object aggregate;
- cron/supabase_functions schema surface;
- Edge Function deployment status + verify_jwt;
- API/Edge logs gần nhất;
- aggregate row count + latest activity timestamp.
```

Không đọc row payload, tên khách, số điện thoại, địa chỉ hoặc dữ liệu PII.

## 3. Executive conclusion

### 3.1 Quyết định

```text
Thiết kế cutover/lockdown: CONDITIONAL GO
Áp dụng lockdown migration ngay: NO-GO
A5 audit: COMPLETE
```

Không được revoke nóng ở trạng thái hiện tại.

### 3.2 Lý do NO-GO

Có bốn nhóm blocker:

1. **Public Edge mutation bypass**  
   Production có các Edge Function mutation đang `ACTIVE`, `verify_jwt=false`, CORS `*`, dùng service role bên trong. Internet client có thể bỏ qua Next/Gateway và gọi thẳng function.

2. **Anon write policy legacy còn mở**  
   `anon` đang có permissive `INSERT/UPDATE` policy với điều kiện `true` trên bảy bảng nghiệp vụ legacy.

3. **Trusted backend vẫn direct provider write**  
   Gateway transitional API và legacy backend còn direct REST mutation, chưa qua application use case/repository/idempotency/audit contract.

4. **Consumer replacement chưa hoàn tất**  
   Một số public Edge function hiện là orphan/compatibility surface hoặc không có internal caller hiện hành; không được revoke/disable trước khi contract test và external-caller verification hoàn tất.

### 3.3 Điểm tốt đã xác minh

```text
- Browser bundle không có dependency @supabase/supabase-js.
- Các Next mutation route đã biết đều proxy qua backend.
- Next proxy bắt buộc backend token và forward requestId/Authorization/Idempotency-Key.
- Foundation Gateway authenticate trước business API.
- MCP core mutation chủ yếu gọi service-role-only PostgreSQL RPC.
- Core mutation RPC không cấp EXECUTE cho anon/authenticated.
- Multi-table work nằm trong một RPC được atomic theo PostgreSQL transaction.
- Trigger chặn child mutation khi session đóng.
- Smoke script chỉ gọi backend API, có prefix fixture và cleanup.
- Vercel config không khai báo cron.
- Production không có public view/materialized view/sequence.
- Storage hiện có 0 bucket và 0 object.
- Không phát hiện pg_cron job hoặc supabase_functions hook surface trong metadata đã truy vấn.
```

## 4. Kiến trúc mutation hiện tại

### 4.1 Canonical backend path

```text
Browser/PWA
  -> Next route handler
  -> backendApiRequestHeaders
     - X-Backend-Token
     - X-Request-Id
     - X-Actor-Id / Type / Authentication
     - Authorization nếu có
     - Idempotency-Key nếu có
  -> Foundation Gateway
     - CORS allowlist
     - proxy authentication
     - server-owned InstallationContext
     - canonical response/error
  -> Transitional API hoặc legacy backend
  -> REST / RPC / Edge Function
  -> PostgreSQL
```

Đường này có HTTP boundary đúng, nhưng Foundation context hiện bị mất trước persistence ở phần lớn core mutation.

### 4.2 Public bypass path

```text
Internet/browser/external client
  -> Supabase Edge Function verify_jwt=false
  -> service-role REST/RPC
  -> PostgreSQL
```

Đây là P0 vì client không cần đi qua:

```text
Next server
Foundation Gateway
backend token
actor validation
installation context
canonical audit/idempotency boundary
```

### 4.3 Direct PostgREST path

```text
Internet/browser/external client
  -> Supabase PostgREST + anon key
  -> permissive RLS write policy
  -> legacy business table
```

Đường này hiện có hiệu lực trên nhóm order/test/market report legacy.

## 5. Consumer inventory

Status:

```text
PASS
PARTIAL
MISSING
WRONG_LAYER
APPROVED_EXCEPTION
UNKNOWN
```

### 5.1 Matrix

| ID | Consumer | Runtime / source | Public endpoint / trigger | Credential | Provider access | Mutation target | Actor/requestId | Idempotency | Atomic | Audit | Bypass | Production | Replacement | Priority | Status |
|---|---|---|---|---|---|---|---|---|---:|---|---:|---|---|---|---|
| C01 | Browser/PWA UI | `src/**` client components | Same-origin `/api/**` | Không giữ service role | HTTP tới Next | Indirect | Client identity chưa phải owner | Client có thể gửi key | Theo downstream | Không | Không ở path đã biết | Active | Giữ browser provider-neutral | P1 | PARTIAL |
| C02 | Next catch-all proxy | `src/app/api/backend/[...path]/route.ts` | `/api/backend/**` | `BACKEND_API_TOKEN`, service actor | HTTP Gateway | Tất cả backend route | Có requestId + service actor | Forward key | Theo downstream | Không persist | Không | Active | Giữ | P1 | PASS boundary |
| C03 | Next specific mutation proxies | field-check, market-report, setting-group, MCP routes | `/api/...` | Backend token | HTTP Gateway | Transitional/core | Có requestId + service actor | Forward key | Theo downstream | Không persist | Không | Active | Giữ transport; thay downstream owner | P1 | PASS boundary / PARTIAL end-to-end |
| C04 | Session report analyze route | `src/app/api/mcp-session-report/analyze/route.ts` | POST analyze | Backend token; agent token optional | Cloud Run + backend | PATCH AI result qua backend | requestId có | Không claim/replay | Agent call + DB write không cùng transaction | Không | Không DB bypass | Active | ReportAnalysis use case; versioned persist | P1 | PARTIAL |
| C05 | Server-side report/export reader | `src/lib/export/supabase-rest.ts`, report source | Internal server execution | `SUPABASE_ANON_KEY` | Direct REST GET | Read `mcp_session_reports` và export tables | Không | N/A | N/A | N/A | Read-only provider coupling | Active | Giữ tạm read-only hoặc chuyển query adapter | P2 | APPROVED_EXCEPTION tạm |
| C06 | Foundation Gateway | `apps/backend/foundation/gateway.js` | Public backend API | Backend token boundary | Proxy | Indirect | Có installation/actor/requestId | Validate + forward, chưa persist | Theo downstream | Không persist | Không | Active | Giữ boundary | P1 | PASS boundary |
| C07 | Transitional field-check | `foundation/transitional-api.js` | POST `/api/field-checks/result` | Service role | Direct REST POST/PATCH | `test_customer_results` | Chỉ nhét context vào `raw_payload` | Không replay; POST có thể duplicate | Một row/request | Không append-only | Không qua repo/use case | Active path | FieldCheck use case + repository/RPC | P1 | WRONG_LAYER |
| C08 | Transitional market report | same | POST `/api/mcp-market-reports` | Service role | Direct REST POST | `market_reports` | Context trong `raw_payload` | Retry tạo row mới | Một row | Không | Không qua repo/use case | Active path | MarketReport use case + idempotency | P1 | WRONG_LAYER |
| C09 | Transitional setting group | same | POST/PATCH `/api/mcp-report-setting-groups` | Service role | Direct REST | `mcp_setting_groups` | Một phần context | POST duplicate/conflict; PATCH last-write-wins | Một row | Không | Không qua repo/use case | Active path | Settings use case + repository | P1 | WRONG_LAYER |
| C10 | Legacy MCP core RPC adapter | `apps/backend/server.js` | MCP route/session/order/test/report/followup/template APIs | Service role | PostgREST RPC | MCP core + orders/test/report/followup tables | Foundation headers chưa persist | Chưa có store/replay | Có, trong từng RPC | Không | Trusted boundary | Active; API logs thấy RPC | Application ports + RPC adapter | P0/P1 theo use case | PARTIAL |
| C11 | Legacy AI result writer | `persistMcpSessionAiResultV1` | POST `/api/mcp-session-report/ai-result` | Service role | Direct REST PATCH | `mcp_session_reports` | Không persist | Last-write-wins | Một row | Không | Trusted direct provider | Active path | Report repository + version/expected-state | P1 | WRONG_LAYER |
| C12 | Legacy setting item writer | create/update setting V1 | POST/PATCH `/api/mcp-report-settings` | Service role | GET + REST INSERT/PATCH | `mcp_setting_items` | Không persist | Retry create duplicate/conflict | Không phải multi-table; validation/read race | Không | Trusted direct provider | Active path | Settings repository/RPC | P1 | WRONG_LAYER |
| C13 | Legacy Edge proxy | server dispatch | result/add routes | Service role forwarded by function env | Invoke Edge | `mcp-day-8b3` | Gateway context không truyền vào Edge payload | Không | Không | Không | Edge hop | Active internal caller | Thay bằng backend use case + atomic RPC | P0 | WRONG_LAYER |
| C14 | Edge `mcp-day-8b3` | repo + production ACTIVE | Public POST, `verify_jwt=false`, CORS `*` | Service role inside function | Direct REST multi-write | `mcp_visits`, `mcp_session_customers`, `mcp_route_sessions` | Không | Add/result retry có thể duplicate/race | **Không** | Không | **Có** | Active deployment; result/add internal caller | Backend use case + RPC; rồi disable | P0 | MISSING |
| C15 | Edge `mcp-day-followup` | repo + production ACTIVE | Public POST, `verify_jwt=false`, CORS `*` | Service role | Direct REST multi-write | `mcp_followups`, `mcp_session_customers` | Không | Retry tạo follow-up mới | **Không** | Không | **Có** | Active deployment; current server route không gọi | Core follow-up RPC path; verify external caller; disable | P0 | MISSING |
| C16 | Edge `mcp-order-save` | production ACTIVE; source không có ở expected repo path | Public POST, `verify_jwt=false` | Service role/anon fallback trong deployed source | RPC | `mcp_create_order_from_session_customer` | Không | Retry tạo order mới | Có trong RPC | Không | **Có** | Active deployment; current Next route đã proxy backend | Verify external caller; disable public function | P0 | MISSING |
| C17 | Edge `mcp-products` | production ACTIVE; source không có ở expected repo path | Public read endpoint, `verify_jwt=false` | Service role/anon | Read RPC | product search/variants | Không | N/A | N/A | N/A | Có, read-only | Active deployment; no recent Edge log | Backend/read API or authenticated read exception | P2/P1 drift | PARTIAL |
| C18 | Legacy direct REST implementations không còn dispatch | older `openMcpDaySession`, status helper trong `server.js` | Không có current route owner | Service role nếu bị gọi | Direct REST multi-write | session/customer/visit/counter | Không | Không | Không | Không | Dead code risk | Không chứng minh active | Xóa sau tests hoặc move fixture | P1 | MISSING cleanup |
| C19 | MCP API smoke | `scripts/smoke-mcp-v1-api.mjs` | Manual/ops command | Backend token | Backend HTTP only | Test fixtures | RequestId smoke | Chỉ test business idempotency open session | Theo production API | Không | Không | Test-only | Giữ; thêm target preflight | P2 | APPROVED_EXCEPTION |
| C20 | Foundation boundary smoke | `scripts/smoke-f0-2-boundary.mjs` | Manual/ops | Backend token | Backend HTTP | Read/auth/CORS checks | Có | Random key | N/A | N/A | Không | Test-only | Giữ | P2 | PASS |
| C21 | GitHub Actions | `.github/workflows/foundation-f0-2.yml` | PR/push | CI dummy env | Build/test only | Không production mutation | N/A | N/A | N/A | N/A | Không | Active CI | Thêm A5 static scan | P1 | PARTIAL |
| C22 | Vercel deployment | `vercel.json` | Build/deploy | Vercel env | Next runtime | Theo route | Theo Next | Theo Next | Theo downstream | Theo downstream | Không trực tiếp | Active | Không có Vercel cron | P2 | PASS surface |
| C23 | Cloud Run report agent | `agent-backend/main.py` | Public analyze; deploy script default allow unauthenticated | Google runtime; không DB key | AI only | Không DB write | Không backend actor | N/A | N/A | Không | Không DB bypass; data exposure concern riêng | External integration | Require agent auth; keep DB persist in backend | P1 | PARTIAL |
| C24 | Direct anon PostgREST client | External/browser/unknown | Supabase REST | anon key | Direct table REST | 7 legacy tables | Không | Không | Một row/request | Không | **Có** | Capability active | Replace every UI/import; revoke policy | P0 | MISSING |
| C25 | Authenticated PostgREST client | External/unknown | Supabase REST | authenticated JWT | Direct table REST | Table grants rộng; write policy not observed | User id có thể có, app context không | Không | Một row | Không | Potential | No confirmed consumer | Permission test before revoke | P1 | PARTIAL |
| C26 | Admin/migration tooling | Supabase/GitHub ops | Explicit operator action | Admin/service role | SQL/deploy | Schema/config/test data | Operator outside app contract | Migration versioning | Transaction depends script | Migration log | Approved only | Deployment-only | Keep documented exception | P2 | APPROVED_EXCEPTION |

## 6. Direct mutation map

### 6.1 MCP core — preferred current direction

```text
Browser
  -> Next API proxy
  -> Foundation Gateway
  -> legacy MCP handler
  -> service-role-only PostgreSQL RPC
  -> affected MCP/order/test/report/followup tables
```

Kết luận:

```text
HTTP boundary: PASS
DB atomicity: PASS cho work nằm trong một RPC
Actor/requestId/audit/idempotency persistence: MISSING
Provider-neutral application ownership: PARTIAL
```

### 6.2 Transitional direct REST

```text
Browser
  -> Next proxy
  -> Foundation Gateway
  -> Transitional API
  -> service-role PostgREST table write
```

Targets:

```text
test_customer_results
market_reports
mcp_setting_groups
```

Kết luận: trusted boundary nhưng `WRONG_LAYER`.

### 6.3 Legacy direct REST

```text
Browser
  -> Next proxy
  -> Foundation Gateway
  -> legacy server.js
  -> service-role PostgREST PATCH/INSERT
```

Targets:

```text
mcp_session_reports
mcp_setting_items
```

Kết luận: trusted boundary nhưng `WRONG_LAYER`.

### 6.4 Legacy -> Edge -> direct REST

```text
Browser
  -> Next proxy
  -> Foundation Gateway
  -> legacy server
  -> mcp-day-8b3
  -> service-role direct REST sequence
```

Targets:

```text
mcp_visits
mcp_session_customers
mcp_route_sessions
```

Kết luận: extra network hop, non-atomic, context lost, public bypass exists.

### 6.5 Public Edge direct

```text
Internet
  -> mcp-day-8b3 / mcp-day-followup / mcp-order-save
  -> service role
  -> REST/RPC
```

Kết luận: P0 bypass.

### 6.6 Public anon table write

```text
Internet
  -> Supabase REST + anon key
  -> permissive RLS
  -> orders/order_items/market_reports/test_*
```

Kết luận: P0 bypass.

## 7. Production database security surface

### 7.1 RLS

Các mutation table đã kiểm tra đều bật RLS. RLS không đủ an toàn nếu policy write là `true`.

### 7.2 Anon effective write policies

Production đang có permissive policy:

```text
orders:
  anon INSERT WITH CHECK true
  anon UPDATE USING true WITH CHECK true

order_items:
  anon INSERT WITH CHECK true
  anon UPDATE USING true WITH CHECK true

market_reports:
  anon INSERT WITH CHECK true
  anon UPDATE USING true WITH CHECK true

test_files:
  anon INSERT WITH CHECK true
  anon UPDATE USING true WITH CHECK true

test_file_products:
  anon INSERT WITH CHECK true
  anon UPDATE USING true WITH CHECK true

test_customers:
  anon INSERT WITH CHECK true
  anon UPDATE USING true WITH CHECK true

test_customer_results:
  anon INSERT WITH CHECK true
  anon UPDATE USING true WITH CHECK true
```

Table grants của `anon` và `authenticated` còn rộng hơn, gồm `INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER`. RLS hiện không có anon DELETE policy trong tập đã truy vấn, nhưng không được giữ grants thừa chỉ vì policy đang chặn.

`authenticated` có table privileges rộng, nhưng không thấy matching write policy trên nhóm trên trong query hiện tại. Phải có permission-denied test thực tế trước migration; không suy luận dựa vào grants riêng lẻ.

### 7.3 MCP table policies

Nhóm MCP core chủ yếu chỉ public/anon SELECT:

```text
mcp_routes
mcp_route_customers
mcp_route_sessions
mcp_session_customers
mcp_visits
mcp_followups
mcp_session_reports
mcp_setting_groups
mcp_setting_items
```

Direct anon MCP table mutation hiện bị RLS chặn, nhưng Edge Function service role bypass RLS.

### 7.4 Function grants

Core mutation RPC đã đúng hướng:

```text
anon EXECUTE: false
authenticated EXECUTE: false
service_role EXECUTE: true
```

Áp dụng cho:

```text
mcp_open_route_session
mcp_set_session_customer_status
mcp_create_order_from_session_customer
mcp_create_test_from_session_customer
mcp_create_report_from_session_customer
mcp_create_followup_from_session_customer
mcp_create_session_report_snapshot
mcp_create_route
mcp_update_route
mcp_create_route_customer
mcp_update_route_customer
mcp_update_route_session
mcp_delete_empty_route_session
mcp_delete_route_hard
mcp_delete_route_customer_hard
mcp_save_route_* template/rule RPC
```

Read RPC đang mở cho anon/authenticated:

```text
mcp_search_products
mcp_get_product_variants
mcp_get_report_context
mcp_get_report_templates
mcp_get_session_report_source
một số catalog helper
```

Read RPC phải review data exposure riêng; không revoke chung với mutation RPC.

### 7.5 Trigger

Production có trigger:

```text
- block INSERT/UPDATE/DELETE child khi session đóng;
- recalc counters sau mcp_session_customers/mcp_visits/mcp_followups;
- set visit session_date;
- validate added-session customer context.
```

Trigger bảo vệ invariant nhưng không tạo actor/audit/idempotency.

### 7.6 Views, sequence, storage, scheduler

```text
public view: 0
public materialized view: 0
public sequence: 0
storage bucket: 0
storage object: 0
cron.job surface: không phát hiện
supabase_functions hook surface: không phát hiện
Vercel cron: không khai báo
```

## 8. Production activity evidence

Aggregate metadata cho thấy các table có activity gần đây, gồm:

```text
orders / order_items
market_reports
test_files / test_customers / test_customer_results
mcp_route_sessions / mcp_session_customers / mcp_visits
mcp_session_reports
mcp_setting_groups / mcp_setting_items
mcp_followups
```

API logs ngày `2026-07-14` xác nhận Node runtime đã gọi thành công core RPC:

```text
mcp_open_route_session
mcp_set_session_customer_status
mcp_create_order_from_session_customer
mcp_create_test_from_session_customer
mcp_create_report_from_session_customer
mcp_create_followup_from_session_customer
mcp_update_route_session
mcp_delete_empty_route_session
mcp_delete_route_hard
```

Log pattern trùng MCP smoke và cleanup. Nó chứng minh RPC path hoạt động, không đủ để quy kết là traffic người dùng.

Edge Function logs trong cửa sổ truy vấn không có invocation. Điều này không chứng minh function không được dùng; deployment vẫn `ACTIVE` và public.

Phân loại production:

```text
Confirmed active internal path:
- Next -> Gateway -> legacy core RPC
- legacy -> mcp-day-8b3 cho result/add theo dispatch hiện tại
- server-side direct read path

Deployed active attack/capability surface:
- mcp-day-8b3
- mcp-day-followup
- mcp-order-save
- mcp-products

Active capability, caller not attributed:
- anon direct writes vào 7 legacy tables
- orphan/compatibility Edge endpoints
```

## 9. Mutation ownership

| Use case | Owner hiện tại | Provider implementation hiện tại | Owner mục tiêu |
|---|---|---|---|
| Open session | legacy handler + RPC | `mcp_open_route_session` | `OpenRouteSessionUseCase` + RPC repository adapter |
| Update session customer status | legacy handler + RPC | `mcp_set_session_customer_status` | `SetSessionCustomerStatusUseCase` |
| Add ad-hoc session customer | Edge function | direct REST sequence | `AddSessionCustomerUseCase` + atomic RPC |
| Record generic result | Edge function | direct REST sequence | domain-specific order/test/report/status use case; bỏ generic write fan-out |
| Create order | legacy handler + RPC | `mcp_create_order_from_session_customer` | `CreateOrderUseCase` + idempotency/audit |
| Create test | legacy handler + RPC | `mcp_create_test_from_session_customer` | `CreateTestUseCase` + idempotency/audit |
| Create market report for session customer | legacy handler + RPC | `mcp_create_report_from_session_customer` | `CreateOrUpdateMarketReportUseCase` |
| Create follow-up | legacy handler + RPC; orphan Edge duplicate | core RPC + public Edge REST | `CreateFollowupUseCase`; một canonical path |
| Snapshot/close session | legacy handler + RPC | snapshot/update RPC | `CloseRouteSessionUseCase` |
| Save field check | Transitional API | direct REST | `SaveFieldCheckResultUseCase` + repository |
| Save standalone market report | Transitional API | direct REST | `SaveMarketReportUseCase` + repository |
| Manage report setting groups/items | transitional + legacy | direct REST | `ManageReportSettingsUseCase` + repository/RPC |
| Persist AI analysis | Next + legacy direct PATCH | PostgREST PATCH | `PersistSessionAnalysisUseCase` + versioned repository |
| Product search/variants | transitional/read Edge | read RPC | query service; authenticated/read-only exception |
| Legacy order/test table direct write | RLS policy, no app owner | PostgREST anon | No direct owner; backend-only mutation |

Decision:

```text
Không có table nào là business owner.
Table/RPC/Edge Function chỉ là provider implementation.
Mỗi mutation chỉ được có một canonical application owner.
```

## 10. Atomicity và retry analysis

### 10.1 Atomic

```text
PASS:
- MCP core multi-table RPC.
- Order/test/report/followup work bên trong một PostgreSQL RPC.
- Close session + snapshot khi nằm trong cùng RPC.
- Open session unique route_id + session_date.
- Snapshot unique session_id/upsert.
```

### 10.2 Non-atomic

```text
- mcp-day-8b3 result:
  ensure/create visit
  -> update visit
  -> update session customer
  -> count
  -> update route session

- mcp-day-8b3 add:
  read session
  -> read max sort
  -> insert session customer
  -> multiple counts
  -> update session

- mcp-day-followup:
  read session customer
  -> insert followup
  -> count
  -> update session customer
```

Failure giữa chuỗi để lại partial state. Trigger counter có thể giảm hậu quả, nhưng không biến chuỗi HTTP thành transaction.

### 10.3 Retry duplicate / last-write-wins

High-risk:

```text
- create order: retry tạo order mới;
- create test: retry tạo result mới;
- create follow-up: retry tạo follow-up mới;
- Edge add customer: retry tạo snapshot customer mới;
- Edge result concurrent: có thể tạo visit trùng khi visit_id chưa có;
- standalone market report POST: retry tạo row mới;
- setting group/item create: retry duplicate hoặc conflict;
- field-check POST không resultId: retry tạo row mới;
- AI result PATCH: last-write-wins, không expected version.
```

Business-idempotent một phần:

```text
- open session: unique(route_id, session_date);
- session report snapshot: unique(session_id) + upsert;
- market report theo session customer: reuse/update logic, concurrent race vẫn cần contract.
```

`Idempotency-Key` hiện chỉ validate/forward, chưa claim, persist, hash payload, replay hoặc conflict.

## 11. Replacement plan

### P0 implementation wave

1. **Create atomic RPC/use case cho add/result**
   - `AddSessionCustomerUseCase`
   - `RecordSessionCustomerResultUseCase` hoặc bỏ generic result để gọi use case cụ thể
   - context + idempotency + audit contract
   - concurrency tests

2. **Cut internal caller khỏi `mcp-day-8b3`**
   - legacy route gọi application adapter trực tiếp
   - test result/add parity
   - no Edge hop

3. **Consolidate follow-up**
   - giữ core follow-up RPC path
   - xác minh không external consumer của Edge
   - disable/delete `mcp-day-followup`

4. **Remove public order Edge**
   - current Next order route đã đi backend
   - xác minh external consumer
   - disable/delete `mcp-order-save`
   - idempotency cho core create order trước khi tuyên bố retry-safe

5. **Move seven anon-write table consumers**
   - inventory UI/import/admin client theo endpoint
   - thêm backend API replacement
   - contract/UI smoke
   - permission-denied test
   - sau đó drop policy/revoke grants

### P1 implementation wave

```text
- FieldCheck repository/use case.
- Standalone MarketReport repository/use case.
- Report settings repository/use case.
- Session AI result repository với expected version.
- Parse Foundation mutation context trong legacy/application adapter.
- IdempotencyStore + AuditEventStore.
- Remove dead direct REST functions khỏi server.js.
- Version production source của mcp-order-save/mcp-products hoặc retire.
- Add local/CI static direct-mutation scan.
- Require auth cho Cloud Run agent.
```

### Approved exceptions

```text
- service_role cho migration/deploy/admin có runbook riêng;
- smoke script qua backend API với prefix + cleanup;
- server-side anon read helper tạm thời, chỉ GET, không browser key exposure;
- read RPC đã review data exposure.
```

Không approved exception cho public service-role mutation Edge Function.

## 12. Lockdown migration design — chưa chạy

### 12.1 Preconditions

```text
[ ] Static scan pass.
[ ] Replacement backend path deployed.
[ ] UI/API/Edge smoke pass.
[ ] External caller verification complete.
[ ] Permission tests captured before/after.
[ ] Backup/forward-fix plan ready.
[ ] No P0 UNKNOWN consumer.
```

### 12.2 Legacy table lockdown set

Candidate tables:

```text
orders
order_items
market_reports
test_files
test_file_products
test_customers
test_customer_results
```

Design:

```sql
-- Design only; A5 không tạo/chạy migration.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.<table>
FROM anon, authenticated;

DROP POLICY IF EXISTS "<anon insert policy>" ON public.<table>;
DROP POLICY IF EXISTS "<anon update policy>" ON public.<table>;

-- Chỉ giữ khi UI còn read trực tiếp và data exposure đã review.
GRANT SELECT ON TABLE public.<table> TO anon, authenticated;
```

Không dùng tên policy suy đoán trong migration. A6/implementation phải đọc exact production/source parity rồi viết versioned migration.

### 12.3 MCP tables

MCP core anon write hiện đã bị RLS chặn. Design sau cutover:

```text
- REVOKE table mutation grants khỏi anon/authenticated nếu còn.
- Giữ SELECT tối thiểu chỉ cho read flow đã review.
- Mutation RPC: service_role only.
- REVOKE EXECUTE FROM PUBLIC, anon, authenticated.
- GRANT EXECUTE TO service_role cho canonical RPC.
```

### 12.4 Edge Function lockdown

Thứ tự:

```text
1. Cut internal caller.
2. Verify external caller.
3. Add authenticated backend-only contract hoặc retire function.
4. Redeploy verify_jwt/auth/CORS deny-by-default nếu còn giữ.
5. Remove service-role public mutation surface.
6. Smoke canonical backend path.
```

Chỉ bật `verify_jwt=true` không đủ nếu application dùng service-to-service backend token khác JWT; phải thiết kế auth contract đúng thay vì chắp vá.

### 12.5 Service role

Chưa revoke service-role table access trong wave đầu vì transitional/legacy adapter còn cần.

Target dài hạn:

```text
- application adapter gọi RPC/repository;
- service role có least privilege;
- direct table mutation chỉ migration/admin exception;
- audit mọi service mutation.
```

## 13. Test plan

### 13.1 Static scan

Bắt buộc chạy local và CI:

```text
rg -n --hidden \
  "@supabase/supabase-js|createClient|supabase\\.from|\\.insert\\(|\\.update\\(|\\.upsert\\(|\\.delete\\(|\\.rpc\\(|storage\\.from|functions\\.invoke|/rest/v1/|/functions/v1/" \
  src apps supabase scripts ops .github
```

Phân loại từng hit:

```text
browser
Next server
Gateway
legacy backend
Edge
test/admin/migration
read-only
mutation
```

CI phải fail nếu browser/client file có provider mutation signature hoặc public service-role endpoint mới.

### 13.2 Contract/smoke

```text
- Foundation auth/CORS/requestId smoke.
- Full MCP v1 smoke.
- Open session duplicate test.
- Retry same Idempotency-Key same payload -> replay.
- Same key different payload -> 409.
- Concurrent duplicate order/test/followup/add -> one effect.
- UI route/customer/session/order/test/report/followup smoke.
- Transitional field-check/market-report/settings smoke after cutover.
- Edge result/add parity before retirement.
- Report AI persist version conflict test.
```

### 13.3 Permission tests

```text
- anon direct INSERT orders -> denied;
- anon direct UPDATE order_items -> denied;
- anon direct INSERT market_reports -> denied;
- anon direct INSERT/UPDATE test_* -> denied;
- authenticated direct write -> denied;
- anon direct MCP mutation -> denied;
- anon mutation RPC EXECUTE -> denied;
- service-role canonical backend RPC -> pass;
- approved read-only GET/RPC -> pass.
```

### 13.4 Rollback/forward-fix

Không rollback bằng cách mở lại tất cả policy.

Preferred:

```text
- forward-fix replacement path;
- feature flag route về canonical backend;
- migration pair ghi rõ exact policy/grant restore chỉ khi incident;
- post-fix permission test;
- production smoke;
- audit log reconciliation.
```

## 14. Cutover order

```text
1. Chạy reproducible static scan và khóa inventory.
2. Gắn owner cho mọi mutation endpoint/table.
3. Implement context/idempotency/audit foundation adapters.
4. Implement atomic add/result use case; cut mcp-day-8b3 internal caller.
5. Consolidate follow-up; retire followup Edge.
6. Verify/retire order-save Edge.
7. Move transitional field-check/market-report/settings direct REST.
8. Move AI result direct PATCH.
9. Test all replacement paths.
10. Revoke anon write trên table ít phụ thuộc nhất, từng nhóm nhỏ.
11. Revoke orders/order_items và test core sau UI/import smoke.
12. Lock Edge auth/disable orphan functions.
13. Recheck function grants and table grants.
14. Production smoke + permission-denied tests.
15. Forward-fix any regression; do not reopen broad policy.
```

Không khóa tất cả bảng trong một migration không có checkpoint.

## 15. Gap matrix

### P0

| ID | Gap | Risk | Exit criteria |
|---|---|---|---|
| P0-01 | `mcp-day-8b3` public, no JWT, service role, multi-write | Auth bypass + partial state | Internal caller cut; function disabled/authenticated; atomic replacement pass |
| P0-02 | `mcp-day-followup` public, no JWT, service role | Arbitrary duplicate follow-up | External caller cleared; function retired; core path pass |
| P0-03 | `mcp-order-save` public, no JWT, mutation RPC | Arbitrary order creation + retry duplicate | Function retired/authenticated; order idempotency pass |
| P0-04 | Anon INSERT/UPDATE policies on 7 legacy tables | Browser/external direct mutation | Every consumer replaced; policies dropped; permission tests pass |
| P0-05 | No persisted idempotency/audit on core mutation | Retry duplicate, no trace | IdempotencyStore/AuditEventStore implemented for critical use cases |
| P0-06 | Edge public caller attribution incomplete | Silent production break if disabled | Access log window + client inventory + staged disable |

### P1

| ID | Gap | Exit criteria |
|---|---|---|
| P1-01 | Transitional API direct REST | Use case/repository adapter |
| P1-02 | AI result direct PATCH | Versioned repository mutation |
| P1-03 | Setting item direct REST | Settings use case/RPC |
| P1-04 | Foundation context not persisted in core | MutationContext reaches repository/RPC/audit |
| P1-05 | Dead direct REST helpers remain | Removed or test-only isolated |
| P1-06 | `mcp-order-save`/`mcp-products` source drift | Versioned source parity or retirement |
| P1-07 | No reproducible A5 static scan in CI | Scan script + CI gate |
| P1-08 | Cloud Run agent default unauthenticated | Service auth/token required |
| P1-09 | Authenticated table grants overbroad | Least-privilege migration + tests |
| P1-10 | Read RPC/public SELECT exposure not data-scoped | Read exposure review |

### P2

| ID | Gap | Exit criteria |
|---|---|---|
| P2-01 | Server-side anon direct reads provider-coupled | Query adapter or documented exception |
| P2-02 | Smoke target guard can be stronger | Explicit target confirmation/preflight |
| P2-03 | Encoding mojibake in smoke fixture | Separate commit; do not mix A5 |
| P2-04 | Admin/migration exception runbook | Named operator, target, cleanup, evidence |

## 16. Decision log

```text
D1. A5 là audit-only; không sửa runtime/migration/deploy.
D2. Áp dụng lockdown ngay là NO-GO.
D3. HTTP backend boundary không đồng nghĩa repository boundary hoàn tất.
D4. Direct REST trong trusted backend vẫn là WRONG_LAYER, không phải browser bypass.
D5. Public Edge service-role mutation không được approved exception.
D6. Core PostgreSQL RPC là provider adapter hợp lệ nếu service-role-only, atomic và được application owner gọi.
D7. Business idempotency không thay thế Idempotency-Key replay contract.
D8. raw_payload foundation_context không thay thế append-only audit event.
D9. Không revoke dựa trên grants/policies cũ; migration phải lấy exact production/source parity tại thời điểm cutover.
D10. Không coi “không có Edge log trong cửa sổ” là consumer chết.
D11. Không coi table grant là effective permission nếu chưa xét RLS; permission test là source of truth cuối.
D12. Không mở lại broad anon policy để rollback; ưu tiên forward-fix.
D13. Source Edge Function phải versioned; deployed-only source drift là gap.
D14. Order Core không được bắt đầu trước khi foundation/A5 P0 gate đạt.
```

## 17. Definition of Done — A5 audit

```text
[x] Đã audit Browser/Next/Gateway/legacy/Edge/scripts/CI/external agent.
[x] Đã xác định direct REST, RPC và Edge mutation.
[x] Đã truy vấn production policies/grants/functions/triggers read-only.
[x] Đã xác định canonical owner mục tiêu cho từng mutation group.
[x] Mọi direct mutation có replacement hoặc approved exception.
[x] Có lockdown migration design, chưa chạy.
[x] Có test, cutover, rollback/forward-fix plan.
[x] Có P0/P1/P2 matrix.
[x] Không sửa runtime.
[x] Không tạo migration.
[x] Không deploy.
[x] Branch chỉ chứa tài liệu A5.
```

Pre-lockdown implementation gate còn fail:

```text
[ ] Không còn public service-role mutation Edge.
[ ] Không còn anon write policy nghiệp vụ.
[ ] Không còn production consumer chưa attribution.
[ ] Static scan CI pass.
[ ] Replacement path pass smoke.
[ ] Critical mutation có idempotency/audit.
```

## 18. Kết luận khóa

A5 đã hoàn tất inventory và thiết kế cutover, nhưng production **chưa sẵn sàng mutation lockdown**.

Kết luận ngắn:

```text
- Browser path hiện đã đi backend ở các mutation route đã biết.
- Core RPC atomic và service-role-only là nền tốt.
- P0 lớn nhất là public Edge service-role mutation và anon legacy table write.
- Trusted backend vẫn còn direct REST, cần chuyển về application use case/repository.
- Không revoke bất kỳ quyền nào trước khi replacement + permission test pass.
- Bước tiếp theo là A5 implementation wave: consumer cutover + Edge retirement/auth + idempotency/audit, không nhảy sang Order Core.
```
