# Provisional frontend boundary — Phase 5 Purchase Order (P5.1)

> Provisional frontend boundary for the NPP Platform implementation. This is not the final database contract and does not assign database/backend coding to Codex by default.

## Ownership and workflow

- Agent creates the first local rough implementation and runs fast local checks.
- The primary reviewer audits the real diff, corrects defects, writes missing frontend/backend/database code in the repository, and verifies CI before merge.
- Codex is only used for work that is blocked by the current environment, requires provider access, production migration rehearsal, backup/restore evidence, or an unusually long external operation.
- Production deployment, provider mutation and production database changes are separate operator-approved steps.

## Route

- Frontend route: `/purchasing/purchase-orders`

## P5.1 boundary

P5.1 owns purchase-order draft and approval foundations only.

Included:

- purchase order header and lines;
- draft lifecycle;
- submit for approval;
- approval;
- cancellation policy before receiving;
- document numbering boundary;
- permissions;
- idempotency;
- optimistic concurrency;
- audit/outbox requirements;
- Core API and Core web UI.

Excluded from P5.1:

- goods receipt;
- inventory posting;
- quantity or quality variance;
- supplier return;
- payable posting;
- supplier payment/allocation.

## UI states

- List: loading, empty, error and data.
- Detail: read-only summary and future receipt placeholders.
- Form: validation, saving, conflict and permission states once mutation APIs are implemented.
- When permission context is missing, all mutation actions are hidden or disabled by default.

## PO state machine

Supported states:

- `draft` — Nháp;
- `pending_approval` — Chờ duyệt;
- `approved` — Đã duyệt;
- `partially_received` — Đã nhận một phần, read-only until P5.2;
- `fully_received` — Đã nhận đủ, read-only until P5.2;
- `closed` — Đã đóng;
- `cancelled` — Đã hủy.

Action summary:

- `draft`: view, edit, submit and cancel when authorized;
- `pending_approval`: view, approve and cancel when authorized and allowed by backend policy;
- `approved`: view only in P5.1; no direct edit;
- receipt states: display only in P5.1;
- `cancelled` and `closed`: view only.

Technical enum values must never be displayed directly in the default UI.

## Permission requirements

Provisional keys, pending confirmation against the canonical permission registry:

- `purchasing.purchase_order.read`
- `purchasing.purchase_order.create`
- `purchasing.purchase_order.update`
- `purchasing.purchase_order.submit`
- `purchasing.purchase_order.approve`
- `purchasing.purchase_order.cancel`

The frontend is not the security boundary. Backend authorization must deny by default and validate installation and warehouse scope from server-owned request context.

## API endpoints

Expected same-origin Core web API routes proxying the Core API:

- GET `/api/purchase-orders?limit&offset&status&supplierId&warehouseId&search`
- GET `/api/purchase-orders/:id`
- POST `/api/purchase-orders`
- PATCH `/api/purchase-orders/:id`
- POST `/api/purchase-orders/:id/submit`
- POST `/api/purchase-orders/:id/approve`
- POST `/api/purchase-orders/:id/cancel`

Expected envelope:

```text
{ data?: T, error?: { code?, message?, retryable?, details? }, requestId? }
```

Non-2xx responses must contain a safe public error. Raw PostgreSQL or provider errors must not reach the browser.

## Request and response rules

- IDs are UUID strings and are validated before path or query construction.
- Quantity and money are decimal strings at every domain boundary.
- JavaScript float is not a source of truth for quantity or money.
- Dates use the repository ISO-date convention.
- Lines snapshot SKU, purchase unit, conversion-to-base and base quantity.
- Responses include a revision/version value once optimistic concurrency is implemented.
- Supplier, warehouse, user and SKU display names are supplied separately from IDs; raw IDs are not the normal UI fallback.

## Idempotency and concurrency

- Every mutation accepts `Idempotency-Key`, not only create.
- The caller owns the key and must keep it stable when retrying the same logical mutation.
- The gateway must not generate a different replacement key on every retry.
- Same key plus same payload returns the original result.
- Same key plus a different payload returns conflict.
- Draft update, submit, approve and cancel include expected revision/version once the backend contract is implemented.

## Error states the UI distinguishes

- configuration/not configured — feature unavailable without fake success;
- validation — field-level feedback;
- conflict — stale revision or idempotency payload mismatch;
- permission — mutation actions remain unavailable;
- not found — document no longer exists or is outside scope;
- unavailable — retryable service failure with a safe message.

## Lookups

- active supplier lookup using the existing supplier contract;
- warehouse lookup restricted by server-owned warehouse scope;
- SKU search;
- purchase-unit and conversion snapshot lookup;
- document-numbering configuration for PO documents.

Production components must not import test fixtures or silently fall back to mock data.

## Decisions still required before backend/database mutation

- exact canonical permission keys;
- PO number allocation timing: draft creation or approval;
- approved-order amendment/version policy;
- rejection/return-to-draft behavior;
- cancellation policy after approval but before receipt;
- approval actor/timestamp response fields;
- revision format and conflict payload;
- document-numbering document type;
- discount and tax snapshot semantics;
- purchase currency policy.

## Current frontend rough status

Implemented on the draft branch:

- server-only typed gateway boundary;
- UUID and query validation;
- caller-owned idempotency requirement;
- decimal-string-safe display formatting;
- centralized status labels and action policy;
- AppShell list workspace, controlled search/status filters and read-only detail modal;
- fail-closed mutation actions when permission context is absent;
- source-contract tests preventing regression to float conversion, technical enum display and unstable idempotency.

Still required before P5.1 is mergeable:

- canonical backend/database contract and decision document;
- migration and repository/service implementation;
- same-origin web API routes;
- permission catalog alignment;
- real create/edit form with supplier, warehouse, SKU and unit lookups;
- submit/approve/cancel flows;
- unit, API, PostgreSQL, concurrency and browser E2E tests;
- CI green on the final head SHA.

---

Any backend/database implementation that changes this provisional boundary must update the document and frontend types in the same slice. No production deployment or migration is implied by merging source code.
