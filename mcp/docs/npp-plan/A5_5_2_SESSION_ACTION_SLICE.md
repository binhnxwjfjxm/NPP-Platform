# A5.5.2 — Session action idempotency slice

> Cập nhật: **2026-07-18**  
> PR: **#41 — MERGED**  
> Phạm vi: **order / test / market report / follow-up từ khách trong phiên**  
> Trạng thái backend: **PRODUCTION RUNTIME PASS**  
> Frontend production: **REDEPLOY PENDING — Vercel build-rate-limit**

## Root cause

Bốn thao tác nghiệp vụ rủi ro cao từng đi qua legacy proxy và gọi business RPC trực tiếp. Caller dùng `fetch()` thường nên không có stable `Idempotency-Key`; retry có thể tạo thêm đơn, kết quả test hoặc follow-up, còn report có thể chạy update lại mà không có replay contract.

## Kiến trúc slice

```text
UI user intent
-> idempotentMutationFetch (một key giữ nguyên qua retry)
-> Next backend proxy
-> Foundation Gateway
-> transitional typed owner
-> typed idempotent wrapper RPC
-> existing business RPC
-> audit + response snapshot + completed record trong cùng transaction
```

Bốn route được intercept trước legacy proxy:

```text
POST /api/mcp-day/session-customer/order
POST /api/mcp-day/session-customer/test
POST /api/mcp-day/session-customer/report
POST /api/mcp-day/session-customer/followup
```

Không thêm generic table-write endpoint. Existing business RPC tiếp tục sở hữu invariant và table mutation.

## Operation inventory

```text
session-customer.order.create
session-customer.test.create
session-customer.report.create
session-customer.followup.create
```

Mỗi wrapper:

- canonicalize payload đã validate;
- claim bằng `(installation_id, operation, idempotency_key)`;
- replay cùng key/cùng payload;
- trả 409 khi cùng key/khác payload;
- delegate existing business RPC;
- lưu trusted `foundation_context` vào aggregate row;
- complete idempotency record và append audit trong cùng transaction.

Bốn provider call site được đăng ký bằng fingerprint cụ thể trong direct-DB mutation baseline với owner `foundation-adapter`. Không có wildcard exemption; literal provider URL trong test đã được loại khỏi source test thay vì whitelist.

## Coverage

```text
A5.5.1 verified: 9/30
PR #41 verified:  +4
Current backend:  13/30
Legacy remaining: 17
```

Coverage 13/30 được ghi sau khi migration production, VPS deploy và authenticated Gateway smoke execute/replay/conflict/audit/context/cleanup đều PASS.

## Code và CI

```text
PR #41:              MERGED
Final head:          709fdc8e1ea1d2d21594f8ba55d6eba7e49b2c8c
Merge SHA:           73d26b95d74b51627449d3bddb169114c097358e
Foundation F0.2:     #379 PASS
F05 browser smoke:   #31 PASS
Migration:           a5_5_2_session_action_idempotency — APPLIED
```

## Production runtime gate

```text
Runtime backup: /var/www/mcp-plan-backend.backup.20260718-121507
Gateway:        http://127.0.0.1:3001
Health:         PASS
Envelope:       PASS
Fixture cleanup PASS
```

```text
order     execute PASS / replay PASS / conflict PASS / audit PASS / context PASS
test      execute PASS / replay PASS / conflict PASS / audit PASS / context PASS
report    execute PASS / replay PASS / conflict PASS / audit PASS / context PASS
follow-up execute PASS / replay PASS / conflict PASS / audit PASS / context PASS
```

Chi tiết evidence: `docs/npp-plan/A5_5_2_SESSION_ACTION_RUNTIME_PASS.md`.

## Frontend production gate còn lại

Caller stable-key đã nằm trong `main`, nhưng Vercel status của merge SHA PR #41 thất bại do `build-rate-limit`. Backend mới bắt buộc key, vì vậy không chạy live UI bốn thao tác trên bản frontend cũ. Commit evidence sau runtime được dùng để kích lại production deploy đúng một lần; chỉ khi deployment READY mới chạy live UI smoke rồi chuyển sang slice tiếp theo.

Không đụng `milktea-backend` port `3002`.
