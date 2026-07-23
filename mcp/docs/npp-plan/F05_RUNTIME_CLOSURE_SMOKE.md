# NPP-F05 — Repeatable Gateway runtime closure smoke

> Cập nhật: **2026-07-17**  
> Trạng thái source: **PR #27 / #30 / #33 MERGED + CI PASS**  
> VPS boundary: **`F0.2_VPS_SMOKE=PASS`**  
> F05 runtime closure: **PASS**  
> Fixture cleanup: **PASS**

## 1. Mục tiêu

Đóng hai runtime gate còn thiếu bằng một script repeatable:

1. manual sales check-in qua authenticated Foundation Gateway;
2. persisted idempotency/audit của một mutation thuộc A5.5.1.

Script không phải application consumer. Đây là operational verification tooling và nằm tại:

```text
test/runtime/smoke-f05-runtime-closure.mjs
```

Lệnh chuẩn:

```bash
cd /var/www/mcp-plan-source
node --env-file=/var/www/mcp-plan-backend/.env test/runtime/smoke-f05-runtime-closure.mjs
```

Hoặc:

```bash
cd /var/www/mcp-plan-source
set -a
. /var/www/mcp-plan-backend/.env
set +a
npm run smoke:f05-runtime
```

## 2. Phạm vi kiểm tra

### Gateway boundary

- backend token;
- request ID;
- canonical `data / receivedAt / requestId` envelope;
- health `installationConfigured/providerConfigured/authBoundary`.

### Fixture route/customer/session

- route được tạo qua Gateway với guarded smoke metadata hiện hữu;
- `POST /api/route-customers` đi qua typed owner `route-customer.add`;
- một `Idempotency-Key` riêng cho intent tạo route customer;
- `routeCustomerId` response phải trùng `routeCustomerId` trong session snapshot;
- mở session và đọc snapshot qua Gateway.

### Session check-in

- check-in lần đầu với GPS tạm;
- replay cùng key/cùng payload;
- conflict cùng key/payload khác;
- lần bấm thứ hai bỏ check-in, không gửi tọa độ;
- trạng thái xử lý khách không đổi;
- GPS điểm bán không đổi;
- audit có `succeeded`, `replayed`, `remove_checkin succeeded`;
- idempotency record `completed`, `attempt_count=2`.

### A5.5.1 Foundation mutation

Route:

```text
POST /api/mcp-day/session-customer/result
```

Kiểm:

- first execute `replayed=false`;
- replay `replayed=true`;
- response cũ được giữ nguyên;
- cùng key/payload khác trả `409 idempotency_key_conflict`;
- audit `succeeded + replayed`;
- record `completed`, `attempt_count=2`.

### Cleanup

Route fixture dùng đúng guarded contract đã tồn tại:

```text
route_name: __MCP_V1_API_FULL__<13-digit timestamp>-<6-char suffix>
area:       API Smoke
note:       temporary MCP v1 API smoke
```

Sau mọi nhánh PASS/FAIL, script gọi guarded smoke cleanup và yêu cầu:

```text
smokeCleanup=true
fixtureCleanup=PASS
```

Không mở rộng hard-delete guard production cho một prefix test mới. Không dùng dữ liệu khách production hiện hữu và không để fixture nghiệp vụ.

## 3. Secret và boundary

Script đọc từ VPS environment:

```text
BACKEND_API_TOKEN
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Quy tắc:

- không in secret;
- service role chỉ dùng read-only để xác minh audit/idempotency/GPS;
- mutation nghiệp vụ vẫn đi qua authenticated Gateway;
- source app/backend không import runtime test;
- direct mutation scanner không thêm baseline hoặc exception.

## 4. Source / PR / CI

### Script gốc

```text
PR:           #27 — MERGED
Branch:       f05-runtime-smoke-closure
Merge SHA:    a59dfdc01c6755ef426753c3c8216cc460b747d2
Final CI:     Foundation F0.2 #286 — PASS
CI run ID:    29563734574
```

### Drift fix sau route-customer typed ownership

```text
PR:           #30 — MERGED
Branch:       fix/f05-runtime-smoke-route-owner
Final head:   3875aef1565134d7b38b395c720fa0ce97c2b6ca
Final CI:     Foundation F0.2 #320 — PASS
CI run ID:    29593856963
```

PR #30 sửa:

- thêm stable route-customer idempotency key;
- dùng lại guarded fixture contract hiện hữu;
- kiểm response/snapshot ownership;
- flatten nested cleanup errors;
- không đổi schema, business mutation hoặc hard-delete guard.

### JSON array parser fix

Lần rerun sau PR #30 vẫn báo:

```json
{
  "F05_RUNTIME_CLOSURE_SMOKE": "FAIL",
  "errors": [
    "outlet_before_missing"
  ]
}
```

Root cause không nằm ở route customer hoặc DB. Helper `readJson()` cũ ép mọi JSON qua object-only normalizer. Supabase PostgREST trả row array như `[{...}]`, nhưng parser biến array thành `{}`; `db()` sau đó trả `[]` và tạo false negative `outlet_before_missing`.

Fix:

```text
PR:           #33 — MERGED
Branch:       fix/f05-smoke-json-array-parser
Merge SHA:    6020c2f8b5783241ecbb2c3b1b28be577cbb941b
Final CI:     Foundation F0.2 #329 — PASS
CI run ID:    29596820247
```

PR #33:

- tách parser JSON giữ nguyên kiểu dữ liệu;
- chỉ Gateway canonical envelope mới normalize thành object;
- DB read bắt buộc array và fail rõ `response_not_array` nếu provider contract lệch;
- thêm regression test thực thi cho Supabase row array và Gateway object envelope;
- không đổi business mutation, schema, runtime backend hoặc cleanup guard.

CI #329 PASS:

- runtime hardcode audit;
- scanner + retirement policy;
- production hygiene;
- direct DB mutation audit;
- deploy/frontend auth contracts;
- backend Foundation verify;
- runtime smoke parser/syntax/contract tests;
- TypeScript;
- Next production build.

Vercel Preview của các branch bị `CANCELED` bởi `ignoreCommand`, đúng chủ đích; branch không chạy `npm install`/`next build` trên Vercel.

## 5. VPS evidence

`pullmcp` hoàn tất thành công sau merge PR #33:

```text
127.0.0.1:3001 LISTEN
127.0.0.1:3102 LISTEN
F0.2_VPS_SMOKE=PASS
Previous runtime backup: /var/www/mcp-plan-backend.backup.20260717-164200
```

Runtime process sau deploy lắng nghe đúng Foundation Gateway `3001` và legacy internal `3102`. Không đụng `milktea-backend` port `3002`.

## 6. F05 runtime closure — output thật

Output từ VPS:

```json
{
  "F05_RUNTIME_CLOSURE_SMOKE": "PASS",
  "gateway": "http://127.0.0.1:3001",
  "health": "PASS",
  "canonicalEnvelope": "PASS",
  "checkin": {
    "first": "PASS",
    "replay": "PASS",
    "conflict": "PASS",
    "secondClickUndo": "PASS",
    "audit": "PASS",
    "outletGpsUnchanged": true,
    "visitStatusUnchanged": true
  },
  "foundationResult": {
    "first": "PASS",
    "replay": "PASS",
    "conflict": "PASS",
    "audit": "PASS",
    "responsePreserved": true
  },
  "fixtureCleanup": "PASS"
}
```

Evidence đóng gate:

```text
Gateway health/auth/canonical envelope:             PASS
check-in first execute:                             PASS
check-in replay same key + payload:                 PASS
check-in conflict same key + changed payload:       PASS
second-click undo:                                  PASS
check-in audit:                                     PASS
outlet GPS unchanged:                               true
visit status unchanged:                             true
Foundation result first execute:                    PASS
Foundation result replay:                           PASS
Foundation result conflict:                         PASS
Foundation result audit:                            PASS
persisted replay response preserved:                true
fixture cleanup:                                    PASS
```

Không còn fixture nghiệp vụ sau smoke. Audit/idempotency assertions được đọc từ production provider qua service-role read-only boundary; mọi business mutation vẫn đi qua Gateway.

## 7. Release gate

```text
pullmcp => F0.2_VPS_SMOKE=PASS                    PASS
smoke-f05-runtime-closure => PASS                 PASS
fixtureCleanup => PASS                            PASS
Gateway replay/conflict/undo/audit                PASS
outlet GPS unchanged                              PASS
visit status unchanged                            PASS
```

NPP-F05 runtime closure và A5.5.1 VPS/Gateway runtime gate đã đóng. Phần còn lại trước khi chuyển milestone là UI functional smoke:

```text
route không active session
route có đúng một active session — cả hai lựa chọn
regression Thêm khách trong Phiên
```

Không bắt đầu A5.5.2, NPP-F06 hoặc Order Core trước khi UI smoke và handoff tương ứng được hoàn tất.