# A5.4.4 — Field-check + market-report write ownership

> Cập nhật: **2026-07-17**  
> Trạng thái: **FULL RELEASE VERIFIED**  
> PR: **#24**  
> Merge SHA: **7eed7a69ff7efd386971b7a820561b0cb1660848**  
> Audit đầu vào: `docs/npp-plan/A5_4_4_FIELD_CHECK_MARKET_REPORT_AUDIT.md`

## 1. Kết quả triển khai

Field-check update hiện có một application owner duy nhất:

```text
Browser
-> POST /api/field-checks/result
-> authenticated Foundation Gateway
-> apps/backend/foundation/field-check-mutations.js
-> mcp_update_field_check_result
-> locked test_customer_results row
```

Không tạo RPC field-check create mới. Request thiếu `resultId` fail trước provider. Duplicate route `/api/mcp-market-reports` và direct market-report handler đã bị xóa; luồng market report chuẩn vẫn là:

```text
/api/backend/mcp-day/session-customer/report
-> mcp_create_report_from_session_customer
```

## 2. Logic field-check đã sửa

Write mapping:

```text
normal      -> ok
opportunity -> interested
risk        -> bad
```

Read mapping bao phủ vocabulary cũ:

```text
opportunity: ok, interested, sample
risk:        bad, retry, follow
normal:      pending, tested và giá trị còn lại
```

RPC mới:

- yêu cầu `resultId` và `productName`;
- lock row `FOR UPDATE`;
- bỏ qua row đã soft-delete;
- trả `field_check_result_not_found` khi không có row;
- kiểm tra `sessionCustomerId` khi caller gửi lên;
- merge `raw_payload` cũ với metadata whitelisted và Foundation context;
- không overwrite JSON mù;
- chỉ cho `service_role` EXECUTE.

## 3. Database cutover

Migration source:

```text
supabase/migrations/20260716234500_field_check_mutation_owner.sql
supabase/migrations/20260716234600_close_field_check_public_writes.sql
```

Production records:

```text
20260716171112  field_check_mutation_owner
20260716171124  close_field_check_public_writes
```

Production permission verification:

```text
mcp_update_field_check_result:
  SECURITY DEFINER: true
  search_path: public
  service_role EXECUTE: true
  anon EXECUTE: false
  authenticated EXECUTE: false

browser INSERT/UPDATE/TRUNCATE grants:
  test_customer_results: 0
  market_reports:         0

mutation policies on both tables: 0
SELECT policies: retained
```

## 4. Scanner retirement

Retired fingerprints:

```text
474001fbfa0d1de1ed003364  field-check direct PATCH
f70d562b03f15f08cae868e8  field-check direct POST
ffb1c503e59aa8fcf8f0344f  market-report direct POST
```

Result:

```text
direct mutation debt: 3 -> 0
unclassified:         0
forbidden:            0
```

Approved boundary fingerprint:

```text
9c0c82bc255db9f5e5285357  mcp_update_field_check_result RPC owner
```

## 5. Tests and CI

Final Foundation CI:

```text
workflow: Foundation F0.2
run:      29518939926
number:   179
result:   SUCCESS
```

Đã pass:

```text
runtime hardcode audit
scanner + retirement policy
production hygiene
backend build/tests
field-check use-case tests
migration locking/permission/context tests
Gateway/caller/dead-route regressions
TypeScript typecheck
Next production build
```

## 6. Production verification

Database smoke dùng một result thật trong PostgreSQL subtransaction và chủ động rollback:

```text
RPC update:                  PASS
status mapping:              PASS
raw_payload preserved:       PASS
Foundation context:          PASS
session-customer validation: PASS
rollback byte-equal:         true
```

VPS deployment:

```text
pullmcp:                  F0.2_VPS_SMOKE=PASS
backup:                   /var/www/mcp-plan-backend.backup.20260717-003144
PM2 mcp-plan-backend:     online
PM2 restart count:        0
Gateway listener:         127.0.0.1:3001
legacy internal listener: 127.0.0.1:3102
milktea-backend:          port 3002, process riêng, không đụng tới
health:                   HTTP 200, canonical envelope + requestId
error log:                không có lỗi mới
```

Authenticated Gateway smoke sau deploy:

```text
POST /api/field-checks/result: PASS
canonical envelope:           PASS
status mapping:               opportunity -> interested
persisted status:             interested
Foundation context:           PASS
installationId present:       true
actorId present:              true
restore rollbackEqual:        true
fixture remaining:            false
```

Không có fixture hoặc thay đổi dữ liệu còn lại sau smoke. Các dòng `foundation_gateway_shutdown SIGINT` trong PM2 out log là lịch sử deploy/restart có chủ đích; process hiện tại online, restart count 0.

## 7. Release state

```text
AUDIT:         COMPLETE
SOURCE:        VERIFIED
CI:            VERIFIED
SUPABASE:      APPLIED + VERIFIED
PR #24:        MERGED
MERGE SHA:     7eed7a69ff7efd386971b7a820561b0cb1660848
MAIN:          UPDATED
VPS:           DEPLOYED + VERIFIED
GATEWAY SMOKE: PASS
FULL RELEASE:  VERIFIED
```

Local pull/build mới không được cung cấp trong output cuối, nên không ghi nhận giả. Đây không phải release blocker vì merge-context CI production build, production database, VPS runtime và authenticated Gateway mutation đều đã verified.

## 8. Bước tiếp theo

Bắt đầu **A5.5 — persisted idempotency + append-only audit**, trước tiên audit, chưa sửa code.

Audit phải xác định:

1. `Idempotency-Key` hiện được đọc, truyền và lưu ở đâu.
2. Request lặp hiện có thực sự replay kết quả hay chỉ dựa vào uniqueness/upsert.
3. Mutation owner/RPC nào đã nhận Foundation context nhưng chưa có persisted idempotency record.
4. Audit event hiện có bảng/trigger/log nào và phần nào chỉ nằm trong mutable `raw_payload`.
5. Thiết kế transaction boundary, retention, payload hash, response snapshot, conflict semantics và cleanup.
6. Không mở Order Core trong A5.5.
