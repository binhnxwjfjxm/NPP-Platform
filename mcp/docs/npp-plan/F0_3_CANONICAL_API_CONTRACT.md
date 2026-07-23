# F0.3 — Canonical success/error API contract

> Trạng thái: **CODE IMPLEMENTATION**  
> Base: `f0-2-installation-context-config`  
> Branch: `f0-3-canonical-api-dto`

## Mục tiêu

Khóa một contract trung tính tại public API boundary, không phụ thuộc Supabase, PostgreSQL, VPS, Next.js hay Report Agent.

Success:

```json
{
  "data": {},
  "receivedAt": "2026-07-14T00:00:00.000Z",
  "requestId": "req_..."
}
```

Error:

```json
{
  "error": {
    "code": "SESSION_CLOSED",
    "message": "Dữ liệu đang xung đột với trạng thái hiện tại.",
    "details": {},
    "retryable": false
  },
  "receivedAt": "2026-07-14T00:00:00.000Z",
  "requestId": "req_..."
}
```

## Boundary được khóa

```text
Browser
  -> Next API canonicalizer
    -> Foundation Gateway canonicalizer
      -> transitional adapters hoặc MCP legacy
        -> provider
```

Hai lớp canonicalizer là chủ ý:

1. Foundation Gateway là nguồn contract chính và chặn lỗi provider/legacy lọt ra ngoài VPS.
2. Next proxy là defense-in-depth, chặn response không phải JSON hoặc response sai contract trước khi trả về browser.

## Quy tắc success

- Chỉ có ba transport field: `data`, `receivedAt`, `requestId`.
- Legacy payload dạng `{ data, receivedAt }` được unwrap, không tạo `data.data`.
- Legacy payload chưa wrap được đặt nguyên vào `data`.
- `requestId` được giữ xuyên suốt từ Next sang VPS và response header `X-Request-Id`.
- Business response `204` được chuyển thành canonical `200` có body; `204` chỉ dùng cho CORS preflight.

## Quy tắc error

- `error.code` dùng uppercase snake case ổn định.
- Lỗi provider được map thành `PROVIDER_UNAVAILABLE`.
- Timeout upstream được map thành `UPSTREAM_TIMEOUT`.
- Lỗi server không xác định được map thành `INTERNAL_ERROR`; không dùng raw exception message làm public message.
- `details` chỉ chứa dữ liệu public đã sanitize.
- Các key liên quan credential, URL, provider, table, column, schema, query, SQL và stack bị loại bỏ đệ quy.
- `retryable=true` mặc định chỉ cho HTTP 502/503/504.

## Các thay đổi chính

- Thêm backend contract module `apps/backend/foundation/api-contract.js`.
- Foundation Gateway buffer và chuẩn hóa mọi JSON response từ MCP legacy.
- Response không phải JSON từ business upstream fail-closed với `UPSTREAM_RESPONSE_INVALID`.
- Gateway health, auth, CORS và transitional response dùng cùng canonical envelope.
- Thêm Next server contract module `src/lib/api/api-contract.ts`.
- Next backend proxy canonicalize cả success, error và network/config failure.
- Route MCP Report Agent chuyển sang canonical success/error, không trả raw agent/provider payload.

## Không thuộc F0.3

- Không đổi schema hoặc dữ liệu database.
- Không thêm quyền người dùng/RBAC.
- Không triển khai repository/transaction/idempotency/audit ports; đó là F0.4.
- Không merge/deploy F0.2 hoặc F0.3.
- Không chạy `pullmcp`.

## Verification

```text
npm --prefix apps/backend run verify
npm run typecheck
npm run build
```

Regression tests phải chứng minh:

```text
canonical success exact shape
canonical error exact shape
legacy success không double-wrap data
provider diagnostics không lọt ra public API
CORS/auth errors canonical
non-JSON upstream fail-closed
requestId được giữ xuyên boundary
```

## Deployment dependency

F0.3 được xếp chồng lên F0.2. Trình tự deploy sau này:

```text
1. F0.2 preview/env/smoke pass
2. merge F0.2 vào main
3. rebase/retarget F0.3 vào main
4. F0.3 CI + preview pass
5. merge F0.3
6. VPS chạy pullmcp
7. smoke canonical contract và MCP v1
```
