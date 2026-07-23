# Route master -> active session explicit sync release

> Cập nhật: **2026-07-17**  
> Scope: **NPP-F05 behavior hotfix**  
> PR: **#29 — MERGED**  
> Trạng thái source/DB: **IMPLEMENTED + FINAL CI PASS + PRODUCTION DB VERIFIED**  
> Trạng thái runtime: **VERCEL / VPS / UI SMOKE PENDING**

## Root cause

`McpMasterView` tạo khách tuyến bằng raw `POST /api/route-customers`. Backend cũ chỉ ghi `mcp_route_customers`; phiên đang chạy giữ snapshot cũ nên sales không thấy khách cho tới phiên sau.

## Fix đúng logic

- UI kiểm tra session status của đúng route trước khi tạo.
- Không có active session: ghi route master, không prompt.
- Đúng một active session: hỏi hai lựa chọn rõ ràng.
- Nút mặc định: `Thêm vào tuyến và phiên`.
- Nút phụ: `Chỉ thêm vào tuyến`.
- UI giữ một `Idempotency-Key` cho một user intent qua prompt và retry.
- Foundation sở hữu typed mutation `route-customer.add` tại `POST /api/route-customers`.
- PostgreSQL RPC `mcp_idempotent_add_route_customer` thực hiện route row + optional exact session snapshot trong cùng transaction.
- Lock order khi include session là session trước, route sau, đồng nhất với luồng Thêm khách trong Phiên.
- Duplicate route customer và session snapshot được resolve, không tạo lại.
- Existing `visit_status`, check-in và operational links không bị ghi lại.
- Session done/completed/cancelled/closed bị từ chối.
- Không background/render/reload sync và không resnapshot toàn tuyến.

## Source verification

```text
Branch head:   d5cda4aab4be655717f03560a7d985177bce41be
Merge SHA:     5276abc8abe1c860b9b13d83cc567a2483a47f60
Final CI:      Foundation F0.2 #315
Run ID:        29586644169
Scanner:       PASS
Contracts:     PASS
Backend:       PASS
TypeScript:    PASS
Next build:    PASS
```

Test mới:

```text
apps/backend/foundation/route-customer-active-session-migration.test.js
apps/backend/foundation/route-customer-mutations.test.js
apps/backend/foundation/route-customer-transitional-api.test.js
test/route-active-session-ui-contract.test.mjs
```

## Production DB

Project: `noiadkpkvdohljgopgfb`.

Applied migrations:

```text
route_active_session_explicit_sync
route_active_session_explicit_context_fix
```

Quyền function đã verify:

```text
security definer:       true
service_role execute:   true
anon execute:           false
authenticated execute:  false
```

DB rollback smoke:

```text
ROUTE_ACTIVE_SESSION_DB_SMOKE=PASS
fixtureCleanup=true
```

Covered:

```text
route không active session
route + active session include=true
same-key replay
same-key/different-payload conflict
duplicate route customer reuse
duplicate session snapshot reuse
visit_status/check-in preservation
closed-session rejection
```

Smoke đầu tiên phát hiện snapshot `source=added` thiếu explicit `session_id` trong `raw_payload`; trigger hiện hữu từ chối đúng. Không hạ trigger. RPC được sửa để ghi exact session context, thêm regression test và forward migration, sau đó CI và DB smoke đều pass.

## Production data observation

Preflight không thấy duplicate `(session_id, route_customer_id)`. Tuy nhiên tại thời điểm kiểm tra, mọi route có session `active` đều có nhiều hơn một row active; không có route nào đúng một active session. UI cố ý từ chối prompt khi active session bị mơ hồ. Hotfix không tự đóng hoặc sửa các session lịch sử.

## Còn lại trước khi đóng hotfix

```text
Merge PR #29                              PASS
Vercel production deployment             BLOCKED — build-rate-limit
VPS pullmcp / Gateway smoke               PENDING
UI smoke route không active session       PENDING
UI smoke hai lựa chọn trên đúng 1 active  PENDING — cần fixture/trạng thái hợp lệ
Regression Thêm khách trong Phiên thật    PENDING
```

Không đụng `milktea-backend` port `3002`.