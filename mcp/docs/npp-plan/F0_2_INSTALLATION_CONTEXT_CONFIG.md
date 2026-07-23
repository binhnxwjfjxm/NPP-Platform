# F0.2 — Environment, InstallationContext, actor, requestId và auth boundary

> Trạng thái code: **IMPLEMENTED ON BRANCH**  
> Branch: `f0-2-installation-context-config`  
> Phạm vi: foundation/runtime boundary; không migration, không đổi dữ liệu, không deploy production

## 1. Mục tiêu

F0.2 xử lý trực tiếp các blocker của F0.1:

```text
- bỏ fallback về VPS, Supabase project và Report Agent installation gốc;
- cấu hình production thiếu hoặc sai phải fail-fast;
- CORS production deny-by-default;
- frontend không gọi thẳng external rewrite bỏ qua auth;
- mọi request nghiệp vụ qua một backend auth boundary;
- InstallationContext và actor lấy từ server config, không lấy từ body/client;
- requestId và Idempotency-Key được chuẩn hóa và truyền xuyên suốt.
```

## 2. Kiến trúc sau F0.2

```text
Browser
  -> Next.js same-origin API routes
    -> X-Backend-Token + X-Request-Id + Idempotency-Key
      -> VPS Foundation Gateway :3001
        -> validate token / CORS / context
          -> MCP v1 legacy runtime 127.0.0.1:3002
            -> Supabase REST/RPC bằng service role
```

MCP v1 không đổi route, payload hoặc behavior nghiệp vụ. Runtime cũ chỉ còn nghe loopback và không còn là cổng public.

Foundation Gateway là public front controller của backend. F0.3/F0.4 có thể chuyển dần handler nghiệp vụ ra khỏi file legacy mà không đổi public boundary.

## 3. Environment contract

### 3.1 Next.js server

Bắt buộc khi build production:

```text
BACKEND_API_BASE_URL
BACKEND_API_TOKEN
MCP_LEGACY_ACTOR_ID
SUPABASE_URL
SUPABASE_ANON_KEY
```

Tùy chọn:

```text
MCP_REPORT_AGENT_URL
MCP_REPORT_AGENT_TOKEN
```

Quy tắc:

- không dùng `NEXT_PUBLIC_API_BASE_URL` làm backend fallback;
- không hardcode IP/domain/project/key production;
- Report Agent không cấu hình thì trả trạng thái capability unavailable;
- service role không được đưa vào Next/Vercel;
- Supabase anon read hiện chỉ giữ cho các read path chuyển tiếp; F0.5 sẽ đưa chúng sau backend ports.

### 3.2 VPS backend

Bắt buộc:

```text
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
LEGACY_INTERNAL_PORT=3002
INSTALLATION_ID
NPP_CODE
MCP_LEGACY_ACTOR_ID
AUTH_MODE=proxy-service
BACKEND_API_TOKEN
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
CORS_ORIGINS
```

Tùy chọn:

```text
SUPABASE_ANON_KEY
DATABASE_URL
UPSTREAM_TIMEOUT_MS
SERVICE_NAME
```

Production từ chối:

```text
missing installation/NPP/actor/token
short hoặc placeholder token
CORS rỗng
CORS wildcard
invalid origin/port/auth mode
public và internal port trùng nhau
```

## 4. InstallationContext

Context được tạo duy nhất tại VPS Foundation Gateway:

```ts
{
  requestId,
  installation: {
    id: INSTALLATION_ID,
    nppCode: NPP_CODE
  },
  actor: {
    id: MCP_LEGACY_ACTOR_ID,
    type: "service",
    authentication: "backend-token"
  },
  auth: {
    mode: "proxy-service",
    authenticated: true
  },
  idempotencyKey,
  receivedAt
}
```

Client gửi `x-installation-id`, `x-npp-code` hoặc `x-actor-id` sẽ bị bỏ. Gateway luôn ghi đè bằng server config.

Đây là mô hình một NPP mỗi deployment, không phải tenant switch.

## 5. Auth boundary

Public không cần token:

```text
/
/health
/api/health
OPTIONS từ origin được allow
```

Mọi route nghiệp vụ khác bắt buộc:

```text
X-Backend-Token: <BACKEND_API_TOKEN>
```

Token:

- chỉ nằm trong Next server và VPS backend;
- không đưa vào browser bundle;
- so sánh constant-time;
- bị xóa trước khi request chuyển vào MCP legacy runtime;
- không xuất hiện trong response/log công khai.

Actor F0.2 là service actor cố định cho MCP v1. User actor/session validation sẽ được thêm trên cùng boundary, không cho client tự khai actor.

## 6. RequestId và idempotency

`X-Request-Id` hợp lệ được giữ lại; thiếu hoặc sai format sẽ tạo `req_<uuid>`.

Gateway trả `X-Request-Id` trên health, success và error. Context header được truyền nội bộ:

```text
X-Request-Id
X-Installation-Id
X-Npp-Code
X-Actor-Id
X-Actor-Type
X-Actor-Authentication
Idempotency-Key nếu có
```

F0.2 chỉ thiết lập contract và truyền key. Idempotency store/unique business enforcement thuộc F0.4/F0.8.

## 7. CORS deny-by-default

Production yêu cầu exact origin allowlist, phân tách bằng dấu phẩy.

```text
CORS_ORIGINS=https://app-a.example.com,https://admin-a.example.com
```

Không chấp nhận:

```text
*
path trong origin
protocol khác http/https
origin không nằm allowlist
```

Server-to-server request không có `Origin` vẫn phải qua backend token.

## 8. Next proxy boundary

Đã xóa external rewrite trong `next.config.mjs` vì rewrite không thể gắn secret boundary đáng tin cậy.

Catch-all mới:

```text
/api/backend/[...path]
```

và các API route hiện có đều dùng `proxyBackendRequest`, nơi:

- thêm backend token;
- thêm requestId và actor contract;
- chỉ forward Authorization/Idempotency-Key cần thiết;
- không forward actor/installation do browser cung cấp;
- không lộ backend detail khi network fail.

Đường persist kết quả Report Agent cũng dùng cùng backend headers, không còn gọi tắt.

## 9. Hardcode audit

Script:

```text
npm run audit:runtime-config
```

Scan runtime/config source và fail nếu xuất hiện lại:

```text
VPS IP installation gốc
Supabase project URL/ID installation gốc
Report Agent domain installation gốc
```

Docs vận hành production cũ không nằm trong runtime scan.

## 10. Test và CI

Backend dùng Node built-in test runner:

```text
config fail-fast
CORS wildcard/missing bị chặn
backend token bắt buộc
client không giả installation/actor được
requestId normalize
invalid idempotency key bị chặn
health public
business API 401 khi thiếu token
gateway truyền fixed context
origin lạ trả 403
backend token không bị forward vào legacy runtime
```

Lệnh:

```text
npm --prefix apps/backend run verify
npm run audit:runtime-config
npm run typecheck
```

Workflow `.github/workflows/foundation-f0-2.yml` khóa các gate trên cho PR/push.

## 11. Deployment order bắt buộc

Không merge/deploy trước khi tạo cùng một token mạnh ở cả hai phía.

```text
1. Sinh BACKEND_API_TOKEN >= 32 ký tự ngẫu nhiên.
2. Cập nhật VPS env: installation/NPP/actor/token/CORS/internal port.
3. Cập nhật Vercel env: backend URL/token/actor và Supabase anon read config.
4. Pull branch/release lên VPS.
5. npm --prefix apps/backend run verify.
6. Restart backend; kiểm tra gateway :3001 và legacy chỉ loopback :3002.
7. Deploy Vercel.
8. Chạy health + MCP smoke qua public API.
9. Kiểm tra direct VPS business request thiếu token trả 401.
10. Chỉ merge/release khi smoke pass.
```

Không đổi port ngẫu nhiên để né lỗi. Nếu startup fail phải sửa đúng env/contract.

## 12. Acceptance

```text
[x] Không còn fallback VPS hiện tại trong runtime proxy
[x] Không còn fallback Report Agent hiện tại
[x] Không còn fallback Supabase URL/key hiện tại trong server read helper
[x] Next production config fail-fast
[x] Backend production config fail-fast
[x] CORS wildcard bị cấm
[x] External rewrite bypass được xóa
[x] Backend token boundary tồn tại
[x] Installation/actor server-owned
[x] RequestId xuyên suốt
[x] Idempotency-Key được truyền và validate format
[x] MCP legacy nằm sau loopback gateway
[x] Unit/integration tests cho foundation
[x] CI hardcode/test/typecheck gate
[ ] Production env được cập nhật
[ ] VPS/Vercel deploy
[ ] Production MCP smoke
```

## 13. Kết luận

```text
F0.2 CODE = COMPLETE ON BRANCH
F0.2 DEPLOYMENT = PENDING ENV + SMOKE
```

Không đánh dấu `DEPLOYED/FROZEN` trước khi hoàn tất deployment order và production smoke.
