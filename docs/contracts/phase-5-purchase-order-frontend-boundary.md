# Provisional frontend boundary — Phase 5 Purchase Order (P5.1)

> Provisional frontend boundary for Codex/backend implementation. Not a final database contract.

## Route

- Frontend route: `/purchasing/purchase-orders`

## UI states

- List: loading, empty, error, data
- Detail: view-only, edit (draft), submission pending, error
- Form: validation errors, saving, saved, submit error

## PO state machine (frontend view)

Supported states in UI:

- `draft`
- `pending_approval`
- `approved`
- `partially_received` (read-only display)
- `fully_received` (read-only display)
- `closed`
- `cancelled`

Notes:
- P5.1 must fully support `draft`, `pending_approval`, `approved`, `cancelled` for actions.
- Receipt states are only displayed and not driven by frontend.

## Action matrix (summary)

- `draft`: view, edit, submit, cancel
- `pending_approval`: view, approve (if permission), reject (if contract), cancel (if allowed)
- `approved`: view, (no direct edit), optionally show disabled "Create receipt" until P5.2
- `cancelled`: view only

## Permission requirements (frontend keys)

Frontend expects the following permission keys to be available in canonical permission catalog. The naming must be verified against actual permission registry before use.

- `purchasing.purchase_order.read`
- `purchasing.purchase_order.create`
- `purchasing.purchase_order.update`
- `purchasing.purchase_order.submit`
- `purchasing.purchase_order.approve`
- `purchasing.purchase_order.cancel`

UI must be fail-closed when permission info is missing.

## API endpoints (frontend expectations)

All endpoints are same-origin Core API routes under configured `CORE_API_INTERNAL_URL` with server token.

- GET `/api/purchase-orders?limit&offset&status&supplierId&warehouseId&search` — list
- GET `/api/purchase-orders/:id` — get detail
- POST `/api/purchase-orders` — create draft (idempotency header supported)
- PATCH `/api/purchase-orders/:id` — update draft (optimistic concurrency via revision)
- POST `/api/purchase-orders/:id/submit` — submit for approval (idempotent)
- POST `/api/purchase-orders/:id/approve` — approve (permission guarded)
- POST `/api/purchase-orders/:id/cancel` — cancel

API envelope expectations:
- Response envelope: { data?: T, error?: { code?, message?, retryable?, details? }, requestId? }
- Non-2xx responses include error object.

## Request/response types (high level)

- Quantities and money: decimal string at domain boundary (no JS float)
- Dates: ISO date strings
- Ids: UUID strings
- Lines: include `conversionToBase` snapshot string and `unitId`/`skuId` references
- Mutations: accept `idempotency-key` header; responses include `revision` when supported

## Decimal string rules

- All user-entered numeric fields sent as decimal strings (e.g., "12.345")
- Frontend will format values for display using `vi-VN` locale but send raw decimal strings

## Idempotency & concurrency

- Client should send `Idempotency-Key` header for create actions. Key must be stable for retries of same logical attempt.
- Backend should support optimistic concurrency with `revision`/`version` field on patch. Frontend will include current revision when saving.

## Error codes UI should distinguish

- CONFIGURATION / NOT_CONFIGURED (503) — show user-friendly "backend not ready" message
- VALIDATION (400) — show field-level messages
- CONFLICT (409) — optimistic concurrency; surface retry option
- PERMISSION (403) — fail-closed; hide actions
- NOT_FOUND (404) — show not-found placeholder

## Lookups

- Supplier list endpoint and supplier detail (existing `/api/suppliers` contract)
- Warehouse list endpoint scoped to installation/actor
- SKU search endpoint and product-unit/conversion snapshot endpoint

## Assumptions & open questions (to be verified by Codex/backend)

- Exact permission key names must be confirmed and seeded by migration.
- Purchase order numbering sequencing and document numbering contract.
- Whether approval returns `approvedBy` and approval timestamp in response.
- Whether cancel/approve endpoints are idempotent and return a new revision.
- Exact error code strings.

## Things frontend requires Codex to implement

- Same-origin Core API endpoints listed above
- Request/response envelope and error shape
- Decimal string canonical handling at API surface
- Reservation of permission keys and their behavior
- Idempotency header support for create
- Revision/version support on patch for optimistic concurrency

---

This is a provisional frontend boundary. Backend implementations may adjust contract but must notify frontend and update this document.
