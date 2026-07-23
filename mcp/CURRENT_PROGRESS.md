# MCP-Plan — Current Progress

> Đọc file này trước khi tiếp tục.  
> Cập nhật: **2026-07-20**  
> Phase: **A / NPP-F05 / A5.5.2**  
> Trạng thái: **SOURCE 30/30 — BACKEND DEPLOYED — SESSION CLOSE/EXPORT FIX DEPLOY TRIGGERED — GUARDED LIVE SMOKE PENDING**

## Quyết định hiện tại

- NPP-F05/A5.5.2 đã khép đủ original source inventory `30/30`.
- Chín migration production từ `20260719190000` đến `20260720224600` đã được áp dụng theo đúng version/tên file trong repository.
- Backend Foundation đã rollout bằng `pullmcp`; `178/178` tests PASS, environment validation PASS và `F0.2_VPS_SMOKE=PASS` trên port `3001`.
- PR #75 sửa đúng caller contract chốt phiên và lifecycle tải báo cáo mobile/PWA đã merge; commit này phê duyệt Vercel frontend-only rollout.
- Không ghi runtime `30/30` cho đến khi có guarded authenticated execute/replay/conflict/audit smoke và cleanup evidence.
- Không bắt đầu NPP-F06 hoặc Order Core trước khi chốt lượt production smoke Foundation đang nợ.
- Không đụng `milktea-backend` hoặc port `3002`.

## Issue #88 — guarded complete runtime-smoke tooling

Source tooling documents one guarded command for the pending NPP-F05 production owners:

```text
npm run smoke:f05-production-owners
runbook: docs/npp-plan/F05_PRODUCTION_OWNERS_RUNTIME_SMOKE.md
```

This is tooling only. It has not been executed against production and does not change formal runtime coverage from `14/30`. A real authenticated PASS, separate archive/R2 lifecycle evidence, and verified cleanup remain mandatory before recording `30/30` or starting NPP-F06.

## Coverage

Baseline cũ `13/30` thiếu `route-customer.add`; baseline đúng là `14/30`.

```text
PR #65 session lifecycle:          +4
PR #66 route create/update:        +2
PR #67 route-customer edit:        +1
PR #68 dead settings retirement:   +7
PR #70 archive intents:            +2
Source merged:                     30/30
Original routes remaining:          0
Runtime formally verified:         14/30
Backend source deployed:           30/30
Guarded runtime evidence pending:  16 operations
```

## PR #75 — session close and report download contract

```text
PR:                    #75 MERGED / CI PASS
Merge SHA:             67f6457796519fdf0851a66c07ac7f298527991b
Foundation F0.2:       #616 PASS
F05 browser smoke:     #161 PASS
Backend/schema change: NONE
VPS pullmcp:           NOT REQUIRED
Vercel deploy:         TRIGGERED BY THIS COMMIT
```

Production evidence that identified the root causes:

```text
PATCH /api/backend/mcp-session-actions/:id  400
GET   /api/mcp-session-report               200
GET   /api/pdf/session-day                  200 attachment
GET   /api/backend/exports/mcp-sessions.csv 200 attachment
```

Fixed boundary:

```text
raw close fetch without Idempotency-Key
-> canonical idempotentMutationFetch
-> exact operation route-session.update
-> immediate in-flight duplicate guard

passive anchor navigation + immediate popup unmount
-> owned fetch/response validation
-> blob + server filename preservation
-> browser download trigger
-> popup closes only after success
-> visible loading and error state
```

Pending customers are not an artificial close blocker. The canonical session lifecycle owner remains the sole source of close semantics.

## PR #74 — guarded mobile order review flow

```text
PR:                    #74 MERGED / CI PASS
Merge SHA:             7848ba8ad03e26d07f02b0b8b056735793ccff5b
Foundation F0.2:       #612 PASS
Backend/schema change: NONE
VPS pullmcp:           NOT REQUIRED
Previous Vercel deploy: READY
```

Production evidence that identified the regression:

```text
14:55:04 GET  /api/products/search   200
14:55:16 POST /api/backend/orders    201
14:55:17 GET  /orders                200
```

The workspace disappeared because an order POST succeeded; it was not a random close. The old primary action moved to cart and submitted in the same gesture.

Fixed boundary:

```text
customer prerequisite
-> product taps are add-only and stop propagation
-> catalog primary action only opens review
-> a separate click while already on the Đơn panel may POST
-> immediate in-flight submit guard
-> unfinished draft close confirmation
-> max-content catalog rows with mobile touch-height floor
-> overlay-height fallback and visible mobile footer
```

One unintended production order created at `14:55:16` may require owner review. Do not delete or mutate it without explicit approval.

## PR #73 — fullscreen mobile order flow

```text
PR:                    #73 MERGED / CI PASS
Merge SHA:             c3601db38b286c6171035062dd30bfa2a5793e1c
Foundation F0.2:       #603 PASS
Backend/schema change: NONE
VPS dependency:        SATISFIED BY APPROVED BACKEND ROLLOUT
Previous Vercel deploy: READY
```

UX foundation:

```text
true 100vw × 100dvh order workspace
-> no drag handle / inherited outer padding
-> mobile panels: Khách / Sản phẩm / Đơn
-> one active business panel and one scroll owner
-> whole product row is a touch target
-> immediate add confirmation + visible selected quantity
-> desktop two-column catalog + live cart retained
```

## PR #72 — large searchable order workspace

```text
PR:                    #72 MERGED / CI PASS
Merge SHA:             757cab25c5348bf96a2cc1410ca0a0677c454970
Foundation F0.2:       #600 PASS
Backend/schema change: NONE
Previous Vercel deploy: READY
```

UX foundation:

```text
desktop two-column catalog + live cart
-> realtime product search after 250ms
-> category and brand filters
-> no 30-row UI cap
-> compact text with touchable controls
```

## Production migration/backend rollout — COMPLETE

Applied migration history:

```text
20260719190000_add_standalone_order_create
20260719200000_a5_5_2_session_lifecycle_idempotency
20260719210000_a5_5_2_route_master_write_idempotency
20260719220000_a5_5_2_route_customer_update_idempotency
20260720210000_allow_route_customer_profile_media
20260720223000_add_archive_intents
20260720223500_link_archive_intent_delete_job_terminal
20260720224500_lock_archive_intent_claims
20260720224600_preserve_archive_terminal_failure
```

Database verification:

```text
migration version/name alignment: PASS
required owner/RPC existence: PASS
service-role-only mutation grants: PASS
archive advisory lock order: key -> target PASS
archive terminal-failure guard: PASS
archive delete-job triggers: PASS
fixed-route outlet media nullable session boundary: PASS
```

VPS verification:

```text
backend tests:          178/178 PASS
runtime env:            public=127.0.0.1:3001 legacy=127.0.0.1:3102
mcp-plan-backend:       online / restart 0
health:                 200
without token:          401
with token:             200
blocked origin:         403
F0.2_VPS_SMOKE:         PASS
runtime backup:         /var/www/mcp-plan-backend.backup.20260720-143750
milktea-backend/3002:   untouched
```

## PR #70/#71 — S2c cross-system archive intents

```text
PR #70:                MERGED / SOURCE PASS
PR #70 merge SHA:      a0de1b15eeb84b12d1fcb5f7bc1f3ce789a40cc0
PR #71 concurrency:    MERGED / SOURCE PASS
PR #71 merge SHA:      ec355b7118aca66d086d68a0b3b0326b4f26ba06
Supabase migrations:   APPLIED
VPS pullmcp:           PASS
Guarded live smoke:    PENDING
```

Public operations closed:

```text
POST /api/routes/:id/archive           route.archive
POST /api/route-customers/:id/archive  route-customer.archive
```

Root boundary:

```text
persisted user intent
-> exact target/storage-delete-job linkage
-> existing resumable private R2 lifecycle
-> guarded parent hard-delete
-> cleanup-compatible terminal finalizer
-> persisted response + append-only Foundation audit
```

Guarantees:

- same key/same payload replays one persisted terminal result;
- same key with another target or payload conflicts;
- one target cannot create competing storage-delete jobs;
- claim races are serialized by idempotency key then target;
- intent and delete-job claims remain separate RPC transactions, with persisted re-read across the gap;
- the archive owner reuses `outlet-media.js`; it does not duplicate R2 deletion logic;
- R2 failure blocks parent hard-delete and leaves work reclaimable;
- a cleanup-completed job finalizes its linked intent and audit;
- failed terminal state remains stable until an explicit retry claim;
- browser roles cannot mutate intent/job persistence directly;
- no PostgreSQL/R2 fake transaction and no object key/provider detail in the public result.

Decision document:

```text
docs/npp-plan/A5_5_2_S2C_ARCHIVE_INTENTS.md
```

## Guarded production evidence still pending

Use temporary guarded fixtures only. Do not use real production route/customer/session data for destructive smoke.

Required evidence:

```text
standalone order create execute/replay/conflict
session lifecycle execute/replay/conflict
route create/update execute/replay/conflict
route-customer update execute/replay/conflict
trusted request/installation/actor context
append-only audit rows
business/lifecycle invariants
R2 archive retry/reclaim/finalizer
complete database and R2 fixture cleanup
```

## Point to continue

1. Verify the production Vercel deployment created by this `deploy:` commit.
2. On the affected mobile/PWA, open the active session and confirm PDF/CSV show loading then download with the server filename.
3. Chốt the real session only through the owner’s explicit action; confirm one PATCH succeeds and the session switches to readonly.
4. Do not run an automated destructive close against the owner’s real session.
5. Review the unintended order created at `14:55:16`; do not delete without owner approval.
6. Run the remaining guarded authenticated smoke inventory and archive lifecycle evidence.
7. Only after all evidence passes, update runtime coverage from `14/30` to `30/30`, then begin NPP-F06.
