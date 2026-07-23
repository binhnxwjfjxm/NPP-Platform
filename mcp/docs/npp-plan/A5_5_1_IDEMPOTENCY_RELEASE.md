# A5.5.1 — Persisted idempotency core + Foundation mutation onboarding

> Cập nhật: **2026-07-17**  
> Phạm vi: **9/30 mutation route cases — Foundation-owned routes**  
> Trạng thái release: **FULL RELEASE VERIFIED — CODE / CI / DB / VERCEL / VPS / GATEWAY PASS**

## 1. Trạng thái chính thức

```text
AUDIT:                    COMPLETE
IMPLEMENTATION:           COMPLETE
SOURCE:                   VERIFIED
SCANNER:                  debt 0 / unclassified 0 / forbidden 0
CALLER CONTRACT:          9 Foundation routes covered; legacy negative guards present
CI:                       PASS — Foundation F0.2 #237
PR:                       #25 — MERGED
MERGE SHA:                504c2e18453ad068fd2640a97d21154050602b81
SUPABASE:                 APPLIED + VERIFIED
DB REPLAY/CONFLICT:       PASS
APPEND-ONLY AUDIT:        PASS
TYPED WRAPPER SMOKE:      PASS
BUSINESS ROW RESTORE:     rollbackEqual=true
VERCEL PRODUCTION:        READY + root HTTP 200
VPS RUNTIME:              PASS — F0.2_VPS_SMOKE=PASS
GATEWAY REPLAY SMOKE:     PASS
FIXTURE CLEANUP:          PASS
FULL RELEASE:             VERIFIED
```

A5.5.1 đã có runtime evidence thật qua authenticated Foundation Gateway. Việc còn lại trong master milestone là UI functional smoke của NPP-F05, không còn là blocker của persisted idempotency core.

## 2. Source và CI

### PR / merge

```text
PR:        #25
Head SHA:  484b1f655c9383495e93bcd04637a773b3a09e67
Merge SHA: 504c2e18453ad068fd2640a97d21154050602b81
```

### Final CI

```text
Workflow:    Foundation F0.2
Run:         #237
Run ID:      29557444713
Conclusion:  success
```

Các gate đều PASS:

- runtime hardcode audit;
- direct mutation scanner + retirement policy;
- A5.5.1 caller contract;
- production hygiene;
- direct DB mutation audit;
- deploy/frontend Gateway auth contracts;
- backend Foundation verify;
- TypeScript;
- Next production build.

### Mutation scanner

```text
legacy debt:  0
unclassified: 0
forbidden:    0
```

## 3. Database ownership được triển khai

### Persisted state

```text
public.mcp_idempotency_records
```

Mutable state machine cho:

- claim;
- request hash;
- processing lease;
- completed response;
- attempt count;
- replay;
- conflict;
- expiry.

Unique boundary:

```text
(installation_id, operation, idempotency_key)
```

### Append-only ledger

```text
public.mcp_audit_events
```

Ledger lưu request/actor/operation/aggregate/outcome/hash/metadata đã redact. Trigger `mcp_audit_events_append_only` từ chối mọi `UPDATE` và `DELETE`.

### Internal helpers

```text
mcp_idempotency_request_hash
mcp_idempotency_begin
mcp_idempotency_complete
mcp_append_audit_event
```

Các helper generic bị revoke `EXECUTE` khỏi `public`, `anon`, `authenticated` và `service_role`; chỉ typed SECURITY DEFINER wrappers gọi nội bộ.

### Chín typed wrappers

```text
mcp_idempotent_record_session_customer_result
mcp_idempotent_add_session_customer
mcp_idempotent_create_session_report_snapshot
mcp_idempotent_save_session_report_ai_result
mcp_idempotent_update_field_check_result
mcp_idempotent_create_report_setting_group
mcp_idempotent_update_report_setting_group
mcp_idempotent_create_report_setting_item
mcp_idempotent_update_report_setting_item
```

Quyền production đã verify:

```text
wrapper count:               9
service_role executable:     true
anon executable:             false
authenticated executable:    false
```

## 4. Production migrations

Source files:

```text
supabase/migrations/20260717090000_idempotency_audit_core.sql
supabase/migrations/20260717091000_foundation_idempotent_mutations.sql
```

Production migration history:

```text
20260717052137  idempotency_audit_core
20260717052340  foundation_idempotent_mutations
```

### Root-cause correction khi apply

Lần apply core đầu tiên fail trước commit:

```text
ERROR 42883: function digest(bytea, unknown) does not exist
```

Nguyên nhân:

- production cài `pgcrypto` trong schema `extensions`;
- helper có `search_path=public`;
- source gọi `digest(...)` không schema-qualified.

Sửa đúng source và test:

```text
create extension if not exists pgcrypto with schema extensions;
extensions.digest(...)
```

Lần apply lỗi rollback sạch; source sửa chạy CI lại trước khi apply production lần hai.

## 5. Supabase verification

```text
mcp_idempotency_records exists: true
mcp_audit_events exists:        true
RLS idempotency:                true
RLS audit:                      true
helper count:                   4
append-only trigger:            true
service_role SELECT:            true
authenticated SELECT denied:    true
```

`RLS enabled, no policy` là deny-all có chủ đích cho browser roles. Không tạo policy `USING (true)` để làm im advisor.

## 6. Core production smoke

Fixture namespace:

```text
installation: release-smoke
operation:    release-smoke.core
key:          a551.core.smoke.20260717
```

Kết quả:

```text
first request:                  execute
first replayed:                 false
same key + same payload:        replay
replayed response equal:        true
originalRequestId preserved:    true
same key + different payload:   idempotency_key_conflict
record status:                  completed
attempt count:                  2
audit event 1:                  succeeded
audit event 2:                  replayed
append-only UPDATE blocked:     true
```

## 7. Typed wrapper production smoke

Wrapper:

```text
mcp_idempotent_update_report_setting_group
```

Safe existing row:

```text
mcp_setting_groups.id = msg_0687516286014cc5b77cf667b6c9f349
```

Kết quả:

```text
first request:                  replayed=false
same key + same payload:        replayed=true
same response preserved:        true
same key + different payload:   idempotency_key_conflict
aggregate id persisted:         true
audit succeeded event:          true
audit replayed event:           true
business row restore:           rollbackEqual=true
```

Không còn fixture nghiệp vụ sau restore. Idempotency/audit smoke records được giữ làm release evidence.

## 8. Client/runtime contract

Stable-key helper sinh một key cho một user intent và giữ nguyên key qua retry mạng. Proxy không tự sinh random key.

Đã onboard đúng 9 Foundation route cases:

```text
POST  /api/mcp-day/session-customer/result
POST  /api/mcp-day/session-customer/add
POST  /api/mcp-session-report
POST  /api/mcp-session-report/ai-result
POST  /api/field-checks/result
POST  /api/mcp-report-setting-groups
PATCH /api/mcp-report-setting-groups
POST  /api/mcp-report-settings
PATCH /api/mcp-report-settings
```

Legacy follow-up, session edit/delete và 18 legacy cases còn lại không bị helper retry bọc nhầm. Toàn bộ 21 legacy-proxied route cases thuộc A5.5.2.

## 9. Vercel production

```text
Project:        mcp-plan
Project ID:     prj_jbe4PGuBPwVZa71UNfra6wssc3gJ
Deployment ID:  dpl_6XpaVDosdXwrPk8cr6EtmNGaM76U
Target:         production
State:          READY
Git SHA:        504c2e18453ad068fd2640a97d21154050602b81
Domain:         https://mcp-plan.vercel.app
Root smoke:     HTTP 200
```

Gateway health nằm ở VPS port `3001`; Next app không sở hữu `/api/health`.

## 10. VPS/Gateway runtime evidence

Parser tooling false-negative được sửa tại:

```text
PR:           #33 — MERGED
Merge SHA:    6020c2f8b5783241ecbb2c3b1b28be577cbb941b
Final CI:     Foundation F0.2 #329 — PASS
```

VPS boundary:

```text
127.0.0.1:3001 LISTEN
127.0.0.1:3102 LISTEN
F0.2_VPS_SMOKE=PASS
Previous runtime backup: /var/www/mcp-plan-backend.backup.20260717-164200
```

Authenticated Gateway idempotency smoke trên Foundation route `POST /api/mcp-day/session-customer/result`:

```text
first request:                    PASS — replayed=false
same key + same payload:          PASS — replayed=true
same key + changed payload:       PASS — conflict
persisted response preserved:     true
audit succeeded:                  PASS
audit replayed:                   PASS
idempotency record completed:     PASS
fixture cleanup:                  PASS
```

Cùng smoke cũng chứng minh check-in execute/replay/conflict/undo, bảo toàn outlet GPS và `visit_status`.

Output tổng:

```text
F05_RUNTIME_CLOSURE_SMOKE=PASS
fixtureCleanup=PASS
```

Evidence đầy đủ: `docs/npp-plan/F05_RUNTIME_CLOSURE_SMOKE.md`.

## 11. Rollback

### Runtime

`pullmcp` tạo backup runtime và tự restore nếu verify/start/smoke fail. Không đụng `milktea-backend` port `3002`.

### Database

Hai bảng/core wrappers đã có production evidence và runtime phụ thuộc chúng. Không drop bảng hoặc wrapper để rollback nóng. Nếu runtime mới lỗi, rollback runtime về backup trước; DB objects giữ tương thích và không ảnh hưởng browser roles.

## 12. Handoff chính xác

```text
A5.5.1 code/CI/DB/Vercel: COMPLETE
A5.5.1 VPS/Gateway:       PASS
A5.5.1 FULL RELEASE:      VERIFIED
A5.5.2 legacy routes:     NOT STARTED — 21 cases
NPP-F05 UI smoke:         PENDING
Order Core:               BLOCKED
```

Không bắt đầu A5.5.2 cho đến khi NPP-F05 UI functional smoke được hoàn tất và `CURRENT_PROGRESS.md` chuyển gate tương ứng sang PASS.