# Phase 6 — Sales and MCP Customer Boundary Decisions

> Status: **ACTIVE — UPDATED 2026-08-15**  
> This revision supersedes the previous rule that Core customer verification required purchase demand/order intent and supersedes the legacy session/order-intent official-order flow.  
> Active boundaries are now **standalone customer verification** and **direct canonical Core Sales Order creation**.  
> This document does not authorize production migration, deployment, provider changes, merge or MCP cutover.

## 1. Locked product decision

MCP field outlets and Core canonical customers remain separate identities.

`Thêm khách` remains a field-operation action only:

```text
employee adds/keeps a field outlet
-> MCP stores route/session/GPS/media/notes
-> no hidden Core customer request
-> no official customer code is created automatically
```

A separate explicit action **Mở / liên kết mã** may be used at any time for a sufficiently complete field outlet. It is **not dependent on purchase demand, `Có mua`, order intent, or an order**.

```text
MCP employee explicitly requests verification
-> MCP verifies trusted employee ownership of the field outlet
-> MCP sends FIELD_PROFILE_VERIFICATION to Core
-> Core reviews duplicate/master-data completeness
-> Core approves a new customer/address or links an existing customer/address
-> Core customer responsible_employee_id is the trusted MCP employee
-> MCP stores only Core request/link references
```

`Có mua` / `Có đơn` in the field session are reporting facts only. They must not create a customer request, order intent, redirect, or official Sales Order as a side effect.

## 2. Ownership

### MCP owns

- field routes and field outlets;
- route/session execution, visits, GPS, media, tests, reports and follow-ups;
- the explicit customer-verification projection and Core reference IDs;
- employee-scoped MCP presentation/read flows;
- the browser/API boundary that submits direct official-order intent to Core after validating linked-customer ownership.

### NPP Core owns

- `shared.customers` and customer addresses;
- customer codes and canonical customer status;
- verification/review lifecycle;
- responsible employee on canonical customers;
- official products/prices/commercial rules and Sales Orders.

MCP must not write directly to canonical Core customer, sales, inventory, logistics or accounting tables.

## 3. Trusted employee boundary

Browser input is never trusted as employee authority.

```text
Core workforce login/session
-> MCP web middleware resolves the session
-> middleware replaces any browser Authorization value with an internal workforce identity
-> MCP backend derives principal.employeeId
-> MCP verifies field-outlet/customer ownership
-> MCP Core adapter forwards only the trusted identity/service boundary required by Core
```

A missing, inactive, ambiguous or mismatched employee fails closed.

Canonical MCP customer lists read canonical customer data and are filtered by `responsible_employee_id = trusted employeeId`.

## 4. Standalone verification contract

Core endpoint remains:

```text
POST /api/customer-onboarding-requests
```

Standalone MCP verification uses:

```text
source_system = MCP
source_outlet_id = stable mcp_route_customers.id
source_demand_reference = FIELD_PROFILE_VERIFICATION
order_required = false
trigger_reason = FIELD_PROFILE_VERIFICATION
immutable proposed customer/address snapshot
requested_by_employee_id = trusted employee context
Idempotency-Key = shared canonical generator/contract
```

The same field outlet cannot silently switch employee ownership or reuse the same verification identity with a different immutable snapshot.

## 5. Core lifecycle and authority

Lifecycle remains:

```text
submitted
under_review
need_more_info
approved
linked_existing
rejected
cancelled
```

MCP service authority remains submit/read only. Review/approve/link/reject authority stays in Core.

For `FIELD_PROFILE_VERIFICATION`, transition to `approved` or `linked_existing` must atomically guarantee an active canonical customer and trusted responsible employee.

## 6. MCP customer projection

Standalone verification state is stored on the stable field outlet (`mcp.mcp_route_customers`), not on `mcp.orders`.

The projection includes the responsible employee, persisted operation/idempotency/fingerprint data and canonical Core onboarding/customer/address references. The canonical idempotency key and immutable payload are persisted before the outbound Core POST so a retry reuses the exact same key after transport failure.

The former order-based onboarding projection may remain as historical columns/data until a separately approved schema retirement, but it is **inert**: active MCP runtime routes and UI do not read or mutate it.

## 7. Customer UX

`/customers` shows canonical Core customers assigned to the logged-in employee.

`/customers/onboarding` shows the employee's field outlets and standalone verification states. No order/session IDs are required and the screen must not show a “continue order” CTA.

## 8. Official Sales Order boundary

Only a linked active Core customer/address may create an official Core Sales Order.

Active MCP flow:

```text
linked Core customer/address
-> /orders
-> browser sends customerId + customerAddressId + variantId/quantity/note only
-> MCP backend validates trusted employee ownership
-> MCP backend calls canonical Core Sales Order API
-> Core resolves price, tax, sales channel and other commercial rules
-> canonical Sales Order is stored with sourceType=MCP
```

Requirements:

- browser cannot supply employee authority, manual commercial price, sales channel or arbitrary unlinked customer authority;
- `Idempotency-Key` uses the shared canonical generator/contract;
- retry of the same logical create reuses the exact same key;
- `sourceId` is the canonical idempotency identity and `sourceOutletId` is the owned field outlet identity;
- Core Sales Orders UI shows source `MCP` in the existing Sales Order lifecycle.

There is no second MCP order inbox/lifecycle.

## 9. Legacy order-intent retirement

The following session/order-intent bridge is retired from active runtime:

```text
sessionCustomerId + orderId
-> customer-onboarding submit/sync
-> /visits/order-intent wizard
-> session-customer sales-order submit/sync
```

Rules after retirement:

- `/visits/order-intent` only redirects old bookmarks to `/orders`;
- session cards and closed-session views do not expose “Đơn NPP” links;
- recording `Nhu cầu mua` remains a reporting fact and stops there;
- MCP backend no longer exposes `/api/mcp-day/session-customer/customer-onboarding*` or `/api/mcp-day/session-customer/sales-order*` handlers;
- old adapter/source files for those runtime paths are removed;
- historical database columns/rows are not dropped in this cleanup, so **no migration is required**.

## 10. Acceptance gate

The boundary is accepted only when source and CI prove:

- standalone verification works without purchase/order intent;
- browser cannot supply trusted employee authority;
- field outlet access is employee-scoped and fail-closed;
- `Nhu cầu mua` has no Core side effect;
- direct official orders require linked active Core customer/address;
- Core resolves commercial authority;
- canonical idempotency generator is used and retry reuses the exact key;
- old session onboarding/order routes and wizard are unreachable/retired;
- Core Sales Order UI clearly shows MCP source;
- exact-head CI is green.

Merge, production migration and deployment require separate explicit authorization.
