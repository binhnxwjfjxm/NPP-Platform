# Phase 6C.1B — MCP customer verification sync from order intent

> Status: **SOURCE IMPLEMENTATION — NO PRODUCTION DEPLOYMENT OR MIGRATION**
> Issue: `#172`
> Draft PR: `#185`
> Branch: `agent/phase-6c1b-mcp-onboarding-sync`
> Audited baseline: `main@188165fe9c8de84291015a1fa4564c15180399ee`
> Date: `2026-08-03`

## 1. User-facing behavior

The existing MCP `Thêm khách` flow remains field-only. It creates or adds a route/session outlet for visits, check-in, photos, reports, tests and follow-up. It does not call Core and does not create an official company customer.

Customer verification begins only from the existing purchase-demand flow:

```text
Employee records a purchase demand in MCP
-> MCP creates one local order-intent reference
-> nothing is sent to Core automatically
-> employee explicitly taps “Gửi đề nghị xác minh / mở mã”
-> MCP backend submits the immutable outlet snapshot to Core
-> MCP stores and displays the Core request status
-> approved / linked_existing stores Core customer and address IDs
-> official Core Sales Order remains a later Phase 6C.2 action
```

The local MCP demand remains usable while Core reviews the request. `need_more_info`, `rejected` and `cancelled` remain blocked for a later official-order submission.

## 2. Backend boundary

The browser calls only MCP-owned routes:

```text
GET  /api/backend/mcp-day/session-customer/customer-onboarding
POST /api/backend/mcp-day/session-customer/customer-onboarding/submit
POST /api/backend/mcp-day/session-customer/customer-onboarding/sync
```

The MCP backend owns the canonical Core calls:

```text
POST /api/customer-onboarding-requests
GET  /api/customer-onboarding-requests/:id
```

The MCP Core client has no review, approve, link-existing or reject operation.

Core uses a dedicated service token and principal with only:

```text
core.customer-onboarding.read
core.customer-onboarding.submit
```

The dedicated token must differ from both applications' general backend tokens. Tokens and URLs remain server-only.

## 3. Stable demand and idempotency

The existing `mcp.orders.id` is the stable demand/order-intent reference.

Submission uses:

```text
sourceSystem          = MCP
sourceDemandReference = MCP order ID
Idempotency-Key       = mcp-customer-onboarding-<MCP order ID>
```

MCP stores a SHA-256 fingerprint of the submitted outlet snapshot. A retry with the same demand and unchanged snapshot synchronizes the existing Core request instead of creating another request. A changed snapshot with the same demand reference returns a conflict before another Core call.

Core remains the canonical protection against concurrent duplicate submission and idempotency payload mismatch.

## 4. Structured MCP persistence

Migration `mcp_006_customer_onboarding_sync` extends the existing MCP order intent with structured columns for:

- Core request ID and lifecycle status;
- Core request version;
- immutable submission fingerprint;
- approved/linked Core customer ID;
- approved/linked Core customer-address ID;
- review reason;
- submission and last-sync timestamps.

The migration includes status, shape and Core-reference constraints plus unique/request-status indexes. Integration state is not hidden in generic JSON metadata.

No production migration is performed by this source task.

## 5. Status projection

MCP projects all canonical Core statuses:

```text
submitted
under_review
need_more_info
approved
linked_existing
rejected
cancelled
```

Only `approved` and `linked_existing` project `officialOrderAllowed=true`, and both require Core customer and address references. This flag prepares the later Phase 6C.2 adapter; Phase 6C.1B does not create an official Sales Order, reserve stock or create receivables.

## 6. MCP app identity

The MCP sidebar, mobile top bar, application metadata and PWA manifest now use the NPP/Hùng Phát logo asset at:

```text
mcp/public/npp-app-icon.png
```

## 7. Configuration names

MCP backend:

```text
CORE_ONBOARDING_API_BASE_URL
CORE_ONBOARDING_API_TOKEN
CORE_ONBOARDING_TIMEOUT_MS
```

Core backend:

```text
MCP_ONBOARDING_API_TOKEN
MCP_ONBOARDING_ACTOR_ID
```

The MCP base URL/token pair is fail-closed: both are configured together or the integration stays unavailable. Production requires HTTPS.

## 8. Verification scope

Source verification covers:

- `Thêm khách` contains no Core onboarding call;
- explicit submission exists only after an MCP order intent exists;
- browser-to-MCP and MCP-to-Core boundaries;
- limited Core service permissions;
- all seven statuses and blocked/allowed behavior;
- stable demand reference and deterministic idempotency key;
- retry without duplicate Core submission;
- changed snapshot conflict;
- structured migration registration, canonical/package SQL equality and rerun-safe DDL;
- Core customer/address reference projection;
- NPP logo/PWA contract;
- MCP backend syntax/build, source contracts and regression CI.

## 9. Deliberate non-scope

This phase does not:

- auto-send route/session outlets to Core;
- rebuild the existing MCP field workflow;
- let MCP review, approve, link or reject requests;
- create an official Core Sales Order;
- merge or deploy automatically;
- run a production migration;
- change provider attachment, database plan or production credentials;
- resolve the separate Essential-tier deployment-gate decision.
