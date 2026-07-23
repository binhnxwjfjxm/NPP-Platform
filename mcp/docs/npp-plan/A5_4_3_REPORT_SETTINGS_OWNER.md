# A5.4.3 — Report Settings mutation ownership

> Cập nhật: **2026-07-16**  
> Trạng thái: **FULL RELEASE VERIFIED**  
> PR: **#23**  
> Merge SHA: **a7a26cafd03e37695407b4b73ed6485f5c5215bb**  
> Audit đầu vào: `docs/npp-plan/A5_4_3_REPORT_SETTINGS_AUDIT.md`

## Kết quả triển khai

Foundation là owner duy nhất của bốn write route:

```text
POST  /api/mcp-report-setting-groups
PATCH /api/mcp-report-setting-groups
POST  /api/mcp-report-settings
PATCH /api/mcp-report-settings
```

Luồng production:

```text
Browser
-> Next proxy
-> authenticated Foundation Gateway
-> report-setting use case
-> typed service-role-only RPC
-> PostgreSQL
```

Application owner: `apps/backend/foundation/report-setting-mutations.js`

Direct PostgREST group writes đã bị xóa khỏi `transitional-api.js`. Legacy item create/update owner và routes đã bị xóa khỏi `apps/backend/server.js`. GET read contract vẫn giữ nguyên.

## Database contract

Migration source: `supabase/migrations/20260716213000_report_setting_mutations.sql`

Production migration:

```text
version: 20260716152911
name:    report_setting_mutations
```

RPCs:

```text
mcp_create_report_setting_group
mcp_update_report_setting_group
mcp_create_report_setting_item
mcp_update_report_setting_item
```

Tất cả RPC dùng `SECURITY DEFINER`, `search_path=public`, chỉ `service_role` có EXECUTE; `anon` và `authenticated` không có EXECUTE. Update lock row, validate patch whitelist, chuẩn hóa duplicate/not-found và lưu Foundation context trong `raw_payload`.

## Scanner retirement

```text
6ae585a158e2fd800062fb45  direct group insert
500b241ecd80ff8d74047e27  direct group patch
ea3fdd0cec40084d8ba06c1f  legacy item insert
204c2501e1755878fd26bf36  legacy item patch
```

Result:

```text
direct mutation debt: 7 -> 3
unclassified:         0
forbidden:            0
```

## Tests and CI

```text
Final Foundation CI: 29511603749
run number:          160
result:              SUCCESS
local Next build:    PASS
backend VPS tests:   60/60 PASS
```

Đã pass migration contract/permission/locking/context tests, bốn Gateway interception tests, caller retirement regression tests, scanner, production hygiene, TypeScript typecheck và Next production build.

## Supabase production smoke

```text
create group:                PASS
update group:                PASS
create item:                 PASS
update item:                 PASS
Foundation context persisted:PASS
optional field clear:        PASS
cleanup final:               group 0 / item 0
```

Không còn fixture smoke trong production.

## VPS deployment verification

```text
pullmcp:                 PASS
F0.2_VPS_SMOKE:          PASS
mcp-plan-backend:        online
PM2 restarts:            0
health:                  200 + requestId
without token:           401
with token:              200 + requestId
forbidden origin:        403
Gateway listener:        127.0.0.1:3001
legacy internal listener:127.0.0.1:3102
milktea-backend:         port 3002, PID/process riêng
runtime backup:          /var/www/mcp-plan-backend.backup.20260716-161255
```

Không có lỗi mới trong `mcp-plan-backend-error.log`. Các dòng shutdown cũ là lịch sử restart/deploy.

## Authenticated Gateway mutation smoke

```text
group create:             PASS
group update:             PASS
item create:              PASS
item update:              PASS
canonical envelope:       PASS
requestId/receivedAt/data:PASS
actor context:            PASS
installation context:     PASS
optional category clear:  PASS
cleanup final:            groups 0 / items 0
```

## Release state

```text
SOURCE:        VERIFIED
CI:            VERIFIED
SUPABASE:      APPLIED + VERIFIED
PR #23:        MERGED
MAIN:          UPDATED
LOCAL BUILD:   PASS
VPS:           DEPLOYED + VERIFIED
GATEWAY SMOKE: VERIFIED
FULL RELEASE:  VERIFIED
```

## Bước tiếp theo

A5.4.3 đã đóng. Bắt đầu **A5.4.4 — field-check + market-report writes** bằng audit trước, chưa sửa code. Mục tiêu retire ba findings còn lại và đưa direct mutation debt `3 -> 0`. Sau A5.4.4 mới làm A5.5 persisted idempotency + append-only audit. Chưa bắt đầu Order Core.