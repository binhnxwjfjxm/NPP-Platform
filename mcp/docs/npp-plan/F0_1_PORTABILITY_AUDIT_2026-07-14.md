# F0.1 — Audit khả năng clone source và thay DB/backend

> Trạng thái: **COMPLETE / FINDINGS LOCKED**  
> Ngày audit: **2026-07-14**  
> Mô hình: **một NPP mỗi source clone/deployment, backend và database riêng**  
> Readiness: **PORTABILITY NOT READY**  
> Phạm vi thay đổi: chỉ tài liệu; không sửa code, DB hoặc deploy

## 1. Mục tiêu

F0.1 trả lời các câu hỏi:

```text
- Source còn khóa vào URL/IP/project/path của installation hiện tại không?
- Environment contract có đủ và fail-fast không?
- Production DB có thể dựng lại từ repository không?
- Có bootstrap/seed chuẩn cho NPP mới không?
- Clone source có thể đổi DB/backend mà không sửa business code không?
```

## 2. Phạm vi đã audit

- `src/lib/api/backend-proxy.ts`
- `src/lib/mcp/report-agent-config.ts`
- `apps/backend/server.js`
- root và backend `.env.example`
- frontend/backend `package.json`
- `vercel.json`
- MCP API smoke script
- README và VPS handoff hiện tại
- production migration metadata
- production schema metadata
- các migration MCP gần nhất đã xác minh trong repository
- canonical Supabase config/seed path

Giới hạn:

- GitHub code-search index không khả dụng tại thời điểm audit;
- môi trường audit không clone được repository để chạy literal grep toàn cây;
- F0.2 phải bổ sung hardcode/config scan tự động cho local và CI;
- F0.1 không chạy migration trên DB trắng và không tạo installation thứ hai.

## 3. Kết luận điều hành

F0.1 audit đã hoàn thành, nhưng source chưa đủ điều kiện clone bán cho NPP mới.

```text
P0-01 Backend proxy fallback về backend installation hiện tại.
P0-02 Report Agent fallback về endpoint installation hiện tại.
P0-03 Chưa chứng minh production DB dựng lại được từ repository.
P0-04 Chưa có bootstrap/seed chuẩn cho NPP mới.
P1-01 Environment contract phân tán và thiếu fail-fast.
P1-02 Proxy chưa chuyển auth/requestId/idempotency headers.
P1-03 CORS backend fail-open khi thiếu cấu hình.
P1-04 Chưa tách rõ schema/default/demo/current-NPP data.
P1-05 Runbook template chưa tách khỏi runbook installation gốc.
```

Nguy cơ lớn nhất là source clone thiếu environment nhưng vẫn gọi nhầm backend hoặc agent của NPP gốc.

## 4. Hardcode và config findings

### P0-01 — Backend proxy fail-open

File:

```text
src/lib/api/backend-proxy.ts
```

Resolver hiện dùng:

```text
BACKEND_API_BASE_URL
-> NEXT_PUBLIC_API_BASE_URL
-> endpoint backend installation hiện tại
```

Đây là blocker. Production thiếu env phải fail build/start, không được âm thầm dùng installation cũ. Localhost chỉ được phép khi development mode được khai báo rõ.

### P0-02 — Report Agent fail-open

File:

```text
src/lib/mcp/report-agent-config.ts
```

Code có endpoint mặc định của agent hiện tại. Clone thiếu env vẫn gọi tài nguyên cũ.

F0.2 phải xóa production fallback. Khi không cấu hình agent, hệ thống phải disable capability có chủ đích hoặc fail readiness theo contract.

### P1-01 — Root env template trộn trust boundary

Root `.env.example` hiện trộn:

```text
app display config
Supabase URL/key variables
backend-only credential placeholder
report-agent URL/token
```

Vấn đề:

- còn giá trị endpoint installation gốc;
- thiếu `BACKEND_API_BASE_URL` dù proxy cần biến này;
- public/server/backend variables chưa được tách rõ;
- dễ đặt backend credential sai môi trường.

Không kết luận secret thật đã bị commit. Đây là lỗi thiết kế template và quy trình triển khai.

### P1-02 — Backend env contract chưa đủ

Backend hiện đọc hoặc khai báo:

```text
HOST
PORT
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_ANON_KEY
DATABASE_URL
CORS_ORIGINS
```

Điểm tốt: host, port và DB/provider endpoint đã qua environment; backend kiểm tra Supabase config trước khi gọi provider.

Thiếu contract mục tiêu:

```text
INSTALLATION_ID
NPP_CODE
APP_NAME
APP_DOMAIN
AUTH_CONFIG
STORAGE_CONFIG
LOG_LEVEL
feature/capability config
```

Chưa khóa rõ `DATABASE_URL` và anon key có tham gia runtime backend hiện tại hay chỉ là biến dự phòng.

### P1-03 — CORS fail-open

Backend hiện fallback origin về `*` và chỉ allow `Content-Type, Accept`.

F0.2 phải:

```text
- production thiếu allowlist thì fail-start;
- parse nhiều origin đúng chuẩn;
- bổ sung header contract cho auth/requestId/idempotency;
- không dùng wildcard cho mutation production.
```

### P1-04 — Proxy bỏ security/context headers

Next proxy chỉ tạo `Accept` và `Content-Type`, chưa chuyển tiếp rõ:

```text
Authorization/session credential
request/correlation ID
Idempotency-Key
```

Đây là blocker cho InstallationContext, actor/auth và retry-safe mutation.

### P2-01 — MCP smoke target

MCP smoke nhận `MCP_API_BASE_URL` và mặc định localhost. Default này phù hợp khi chạy trên VPS/local.

Cần bổ sung:

- package command chuẩn;
- preflight xác nhận target;
- cleanup/reconciliation khi test dừng giữa chừng;
- chặn chạy nhầm vào installation gốc từ source clone.

### P2-02 — Runbook installation-specific

README, MCP freeze và VPS handoff có thông tin runtime installation hiện tại. Đây là dữ liệu hợp lệ trong runbook vận hành hiện tại, nhưng không được dùng làm template clone.

Cần tách:

```text
generic installation template
current-production runbook
```

## 5. Environment contract cần khóa ở F0.2

### Browser public

```text
NEXT_PUBLIC_APP_NAME
public feature/branding config nếu thật sự cần
```

Browser không nhận DB credential hoặc backend secret.

### Next server/proxy

```text
BACKEND_API_BASE_URL
MCP_REPORT_AGENT_URL
MCP_REPORT_AGENT_TOKEN nếu agent yêu cầu
```

Không dùng aliases và production fallback không kiểm soát.

### VPS backend

```text
NODE_ENV
HOST
PORT
INSTALLATION_ID
NPP_CODE
SUPABASE_URL hoặc DATABASE_URL theo adapter đang dùng
SUPABASE_SERVICE_ROLE_KEY
CORS_ORIGINS
AUTH_CONFIG
STORAGE_CONFIG
LOG_LEVEL
```

Mỗi biến phải được đánh dấu:

```text
required | optional | development-only
public | server-only | secret
validation rule
component sử dụng
```

## 6. Migration và production DB

SQL production xác nhận:

```text
migration count: 55
first version: 20260629170050
latest version: 20260712060846
```

Inventory production tại thời điểm audit:

```text
public base tables: 33
public routines: 58
public RLS policies: 35
public non-internal triggers: 9
storage buckets: 0
```

Repository có nhiều migration SQL và các migration MCP gần nhất đã được đưa vào source. Đây là điểm tốt.

Tuy nhiên chưa thể chứng minh toàn bộ production được tái tạo vì:

```text
- chưa có migration manifest/parity report;
- chưa có clean-DB rehearsal;
- không có supabase/config.toml tại canonical path;
- không có supabase/seed.sql tại canonical path;
- root package.json không có DB reset/migrate/seed/bootstrap scripts;
- chưa map đầy đủ production version sang source files;
- chưa đối chiếu mọi table/function/trigger/policy/grant/extension.
```

Kết luận khóa:

```text
Migrations tồn tại không đồng nghĩa database tái tạo được.
```

Portability chỉ pass sau khi chạy thật trên DB trắng.

## 7. Bootstrap/seed audit

Chưa có bootstrap contract duy nhất cho NPP mới.

Tối thiểu phải bootstrap:

```text
installation/distributor profile
owner/admin ban đầu
roles/permissions mặc định
branch và warehouse ban đầu
business settings
number sequences
timezone/currency
feature settings
MCP configuration bắt buộc
```

Phải tách dữ liệu thành:

```text
1. schema migration
2. versioned reference/default data
3. installation bootstrap nhận input NPP mới
4. optional demo data
5. current-NPP business data
6. smoke fixtures
```

Commit history có seed catalog/unit rules trong migration. F0.7 phải phân loại lại để tránh source clone mang nhầm sản phẩm, tuyến, khách hoặc cấu hình thật của NPP gốc.

## 8. Build/deploy readiness

### Frontend

Có build/start và Vercel config cơ bản.

Thiếu:

```text
env schema validation
hardcode audit CI
installation config manifest
post-deploy readiness/smoke command
```

### Backend

Backend là Node >=20, chạy trực tiếp `server.js`, không cần compile. Runtime đơn giản là điểm tốt.

Thiếu:

```text
central config validation
installation identity
auth/request context
migration/bootstrap orchestration
generic process-manager/deploy definition
backup/restore/forward-fix template
```

## 9. Clone readiness matrix

| Hạng mục | Trạng thái | Kết luận |
|---|---|---|
| Clone source | Có thể | Còn tham chiếu installation gốc |
| Frontend build | Có | Chưa fail-fast env |
| Backend start | Có điều kiện | Cần provider env; thiếu installation/auth context |
| Đổi backend URL | Không an toàn | Thiếu env sẽ dùng backend gốc |
| Đổi report agent | Không an toàn | Thiếu env sẽ dùng agent gốc |
| Tạo DB trắng | Chưa chứng minh | Chưa rehearsal |
| Migration parity | Chưa chứng minh | Chưa manifest/checker |
| Bootstrap NPP | Chưa có | Chưa có input/schema/command |
| Seed idempotent | Chưa chứng minh | Chưa tách các loại data |
| MCP smoke | Có một phần | Có target env; cần preflight/cleanup contract |
| Auth/actor context | Chưa có | Proxy chưa chuyển auth/context headers |
| Provider-neutral domain | Chưa đủ | Backend chính còn gọi table/RPC trực tiếp |
| Generic deploy runbook | Chưa có | Runbook hiện tại cho VPS gốc |
| Installation thứ hai | Chưa thử | Portability gate chưa pass |

## 10. Remediation đã khóa

### F0.2 — Config + InstallationContext

```text
- xóa backend/agent production fallback;
- central env schema và fail-fast;
- tách public/Next-server/backend env examples;
- chuẩn hóa installation identity;
- CORS deny-by-default;
- proxy auth/requestId/idempotency headers;
- hardcode/config scan cho local và CI.
```

### F0.3-F0.5 — Boundary

```text
- application/use case/ports/adapters;
- canonical success/error DTO;
- audit consumer và khóa direct DB mutation.
```

### F0.6-F0.7 — Database portability

```text
- production/source migration manifest;
- parity checker;
- bootstrap input/schema/command;
- seed idempotent;
- tách default/demo/current-NPP/smoke data.
```

### F0.9-F0.10 — Chứng minh thực tế

```text
DB trắng -> migrations -> bootstrap -> backend -> health -> MCP smoke
-> clone source -> DB/backend mới -> deploy -> xác nhận không gọi installation gốc
```

## 11. Gate sau remediation

```text
[ ] Production thiếu backend URL phải fail
[ ] Không còn production fallback endpoint
[ ] Env examples không chứa endpoint installation gốc
[ ] Backend credential chỉ ở server/backend template
[ ] Proxy chuyển auth/requestId/idempotency đúng contract
[ ] Production CORS không wildcard
[ ] Hardcode/config scan chạy local và CI
[ ] Có migration manifest và parity report
[ ] DB trắng chạy toàn bộ migration
[ ] Bootstrap chạy lặp không duplicate
[ ] Seed không mang dữ liệu NPP gốc
[ ] Backend/frontend mới chạy chỉ bằng config mới
[ ] MCP smoke pass trên installation mới
[ ] Clone không gọi backend/agent installation gốc
```

## 12. Checklist F0.1

```text
[x] Audit backend proxy resolution
[x] Audit report-agent resolution
[x] Audit env examples
[x] Audit backend config/CORS/provider access
[x] Audit proxy header forwarding
[x] Audit build/start/Vercel config
[x] Audit current deployment runbook
[x] Audit MCP smoke target
[x] Audit production migration metadata
[x] Audit production schema inventory
[x] Kiểm tra canonical config/seed path
[x] Xác định migration/bootstrap gap
[x] Khóa risk register và remediation

[ ] Sửa code/config — ngoài F0.1
[ ] Clean-DB rehearsal — F0.9
[ ] Clone/deploy installation thứ hai — F0.10
```

## 13. Quyết định cuối

```text
F0.1 AUDIT = COMPLETE
PORTABILITY = NOT READY
```

Không bắt đầu full Order Core và chưa copy source cho NPP mới ở trạng thái hiện tại.

Bước tiếp theo: **F0.2 — chuẩn hóa environment/config, loại bỏ fail-open và tạo InstallationContext + actor/requestId/auth boundary.**
