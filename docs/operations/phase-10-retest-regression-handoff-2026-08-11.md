# Phase 10 production retest — regression handoff

> Date: 2026-08-11  
> Tracking issue: #478  
> Parent audit: #453  
> Audited source baseline: `main@6d89f055776206d1f3914dcadd21c2607f4c16ea`  
> Purpose: hand off **small, production-verifiable defects**, not reopen large parallel lanes.

## 1. Operating rule

The old Lane A–G PRs were merged, but Owner production retest is now the acceptance source for these defects.

Do not close a defect because an old PR was green. For every reopened item:

```text
reproduce exact production failure
-> capture requestId / error code / exact deployed SHA when relevant
-> identify root cause
-> fix only that defect
-> add regression at the failing boundary
-> exact-head CI green
-> merge one PR
-> deploy only affected runtime(s)
-> Owner production retest
-> mark PASS only after Owner confirms
```

No force-push, rerun spam, speculative SHA churn, provider/DB hand edits, or unrelated refactor.

## 2. Historical lane audit

| Lane | Prior PR | Historical scope | Current Owner acceptance |
| --- | --- | --- | --- |
| A | #456 | Warehouse + Logistics | **REOPENED** |
| B | #457 | Sales stabilization | **REOPENED** |
| C | #459 | Core Shell / Navigation / Modal | **REOPENED** |
| D | #458 | Customer filters | **PASS / leave alone** |
| E | #455 | MCP order UX + Core bridge refresh | **REOPENED** |
| F | `binhnxwjfjxm/nguyenlieuhungphat#64` | Customer Ordering | **PASS / leave alone** |
| G | #460 | Admin/Delivery PWA icons | **PASS / leave alone** |

## 3. Lane A — Warehouse + Logistics

### Owner retest

- Create Vehicle -> HTTP 400.
- Create Driver -> HTTP 400.
- Create Route -> HTTP 400.
- Trip cannot be accepted as tested while required master data creation is failing.

### Source audit

Current `trip-planning-workspace.tsx` submits:

```text
Vehicle: { code, licensePlate, vehicleType }
Driver:  { code, name, phone }
Route:   { code, name, description, defaultWarehouseId }
Trip:    { warehouseId, deliveryRouteId, vehicleId, primaryDriverId, plannedStartAt, note }
```

Current Core `logistics-trip-planning.js` validates the same field shapes. Therefore there is no justified source-only payload guess yet. The next implementation chat must capture the production web/API response and Core error code/requestId before changing the contract.

### Small defects

- **A1 Vehicle 400** — fix and production-test vehicle only.
- **A2 Driver 400** — fix and production-test driver only.
- **A3 Route 400** — fix and production-test route only.
- **A4 Trip create** — only after A1–A3 pass; test with the newly created canonical masters.

Do not combine these unless logs prove one shared root cause.

## 4. Lane B — Sales

### Owner retest

- Sales Order item rows are still too tall.
- `Dùng giá ngoại lệ` placement is visually heavy/awkward.
- Confirm / document-number assignment still returns 503.

### Historical audit

PR #457 explicitly did **not** implement a new confirm fix because it had no fresh runtime log and relied on older #437/#442 recovery work. Owner retest is new evidence, so the 503 is reopened.

### Small defects

- **B1 Sales form density** — only row height/layout and override-price control placement. No backend work.
- **B2 Confirm/cấp số 503** — before code capture exact frontend/backend deployed SHA, requestId, response error code, Core log, revision and idempotency state. Gate is successful confirm plus safe same-intent retry.

## 5. Lane C — Core Shell

### Owner retest

- `Nhân Sự & Phân Quyền` submenu/tab switching still visibly jumps.
- No usable logout surface.

### Source audit

PR #459 changed subnav to grid-row/opacity animation and added a 150 ms route transition, but the production symptom remains. Current shell has `/api/auth/me` and an account footer; the audit did not find a logout/sign-out surface in the Core shell.

### Small defects

- **C1 Access submenu jump** — isolate `/access/*` scroll/height/transition behavior; preserve `prefers-reduced-motion`.
- **C2 Logout** — implement through canonical workforce session/auth boundary; clear/revoke the actual session and redirect to login. A UI-only fake logout is not accepted.

## 6. Lane D — Customer filters

Owner says stable. Prior PR #458 is merged. Do not touch unless a new concrete defect is reported.

## 7. Lane E — MCP -> Core chain

### Owner retest

- Core BASE price exists, but MCP still shows no Core price.
- MCP-created order does not appear in Core.
- Product card in route order flow is oversized.
- Create purchase demand fails HTTP 400.
- Submit open/link customer request fails HTTP 400.
- Core receives no onboarding request.
- Official Core Sales Order path is blocked by onboarding failure.
- Owner wants `Yêu cầu mở mã khách hàng` discoverable from Customer context as well.

### Source audit

Phase 6C.1B contract requires an MCP order intent / purchase demand before explicit customer-onboarding submission.

`submitCustomerOnboarding()` validates the local order intent and may return 400 for missing session customer, stable outlet, customer name or address. Core 4xx codes are also forwarded by the MCP Core client.

PR #455 added catalog behavior and automatic **sync when a `coreRequestId` already exists**. That does not prove that a brand-new production onboarding submission creates a Core request.

Therefore the chain must be closed in dependency order.

### Small defects / dependency order

- **E0 Purchase demand 400** — first blocker. Create/read one valid MCP order-intent in production.
- **E1 Product-card density** — visual-only; keep selection/cart quantity behavior.
- **E2 Core price -> MCP** — choose one known SKU with canonical BASE price and trace Core request/response through MCP. No legacy-price fallback and no fake `0đ`.
- **E3 MCP onboarding submit 400** — capture MCP and Core error code/requestId. Gate: one Core request created, `coreRequestId` persisted, retry deduplicated.
- **E4 Core review/link -> MCP sync** — request visible in NPP Operations; approve/link; MCP receives Core customer/address IDs.
- **E5 MCP -> Core Sales Order** — only after E3/E4 pass. Gate: exactly one `source=MCP` Sales Order, canonical Core id/number/status stored back in MCP, visible in NPP Operations, idempotent retry.
- **E6 Customer-context discoverability** — add a link/CTA into the existing canonical onboarding lifecycle; do not build a second request lifecycle.

## 8. Lane F — Customer Ordering

Owner says stable. Prior cross-repo PR `binhnxwjfjxm/nguyenlieuhungphat#64` is merged. Do not touch without a new defect.

## 9. Lane G — Admin/Delivery PWA icons

Owner says stable. Prior PR #460 is merged. Do not touch without a new defect.

## 10. Chat handoff template

Start a new chat with exactly one item, for example:

```text
Continue Issue #478. Work only A1 — Vehicle create HTTP 400.
Audit current main/open PR/deploy state first. Reproduce production failure and get requestId/error code before coding.
One branch, one small PR, exact-head CI green, merge, deploy affected Core runtime only, then give me the exact production test steps. Do not touch A2/A3/A4 or other lanes.
```

For E items, preserve the dependency order E0 -> E3 -> E4 -> E5; E1/E2 can be tested independently only if they do not hide the bridge blocker.

## 11. Merge/deploy boundary

This document PR is audit/handoff only. It must not deploy application runtimes. Future defect PRs must follow runtime boundaries:

- `npp-core/**` -> Core backend and/or NPP Operations only as actually changed.
- `mcp/**` -> MCP backend/frontend only as actually changed.
- frontend-only change must not trigger unrelated backend deployment.
- production DB/migration is a separate explicit gate.
