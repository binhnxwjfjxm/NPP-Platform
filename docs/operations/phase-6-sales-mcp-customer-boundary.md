# Phase 6 — Sales and MCP Customer Boundary Decisions

> Status: **ACTIVE — UPDATED 2026-08-22**  
> This revision supersedes the previous rule that customer verification required purchase demand/order intent and supersedes the legacy session/order-intent official-order flow.  
> Active boundaries are now **standalone customer verification** and **direct canonical Công Ty Sales Order creation**.  
> This document does not authorize production migration, deployment, provider changes, merge or MCP cutover.

## 1. Locked product decision

MCP field outlets and canonical Công Ty customers remain separate identities.

`Thêm khách` remains a field-operation action only:

```text
employee adds/keeps a field outlet
-> MCP stores route/session/GPS/media/notes
-> no hidden Công Ty customer request
-> no official customer code is created automatically
```

A separate explicit action **Mở / liên kết mã** may be used at any time for a sufficiently complete field outlet. It is **not dependent on purchase demand, `Có mua`, order intent, or an order**.

```text
MCP employee explicitly requests verification
-> MCP verifies trusted employee ownership of the field outlet
-> MCP sends FIELD_PROFILE_VERIFICATION to Công Ty
-> Công Ty reviews duplicate/master-data completeness
-> Công Ty approves a new customer/address or links an existing customer/address
-> canonical customer responsible_employee_id is controlled by Công Ty
-> MCP stores only request/link references
```

`Có mua` / `Có đơn` in the field session are reporting facts only. They must not create a customer request, order intent, redirect, or official Sales Order as a side effect.

## 2. Ownership

### MCP owns

- field routes and field outlets;
- route/session execution, visits, GPS, media, tests, reports and follow-ups;
- the explicit customer-verification projection and Công Ty reference IDs;
- employee-scoped MCP presentation/read flows;
- the browser/API boundary that submits direct official-order intent to Công Ty after validating canonical customer authority.

### Công Ty owns

- `shared.customers` and customer addresses;
- customer codes and canonical customer status;
- verification/review lifecycle;
- responsible employee on canonical customers;
- official products/prices/commercial rules and Sales Orders.

MCP must not write directly to canonical Công Ty customer, sales, inventory, logistics or accounting tables.

## 3. Trusted employee boundary

Browser input is never trusted as employee authority.

```text
Công Ty workforce login/session
-> MCP web middleware resolves the session
-> middleware replaces any browser Authorization value with an internal workforce identity
-> MCP backend derives principal.employeeId
-> MCP verifies field-outlet or canonical-customer authority
-> MCP adapter forwards only the trusted identity/service boundary required by Công Ty
```

A missing, inactive, ambiguous or mismatched employee fails closed.

Canonical MCP customer lists read canonical customer data and are filtered by `responsible_employee_id = trusted employeeId`. Installation owner may act installation-wide without changing the customer's `responsible_employee_id`.

## 4. Standalone verification contract

Công Ty endpoint remains:

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

## 5. Công Ty lifecycle and authority

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

MCP service authority remains submit/read only. Review/approve/link/reject authority stays in Công Ty.

For `FIELD_PROFILE_VERIFICATION`, transition to `approved` or `linked_existing` must atomically guarantee an active canonical customer and trusted responsible employee according to Công Ty policy.

## 6. MCP customer projection

Standalone verification state is stored on the stable field outlet (`mcp.mcp_route_customers`), not on `mcp.orders`.

The projection includes persisted operation/idempotency/fingerprint data and canonical Công Ty onboarding/customer/address references. The canonical idempotency key and immutable payload are persisted before the outbound Công Ty POST so a retry reuses the exact same key after transport failure.

The former order-based onboarding projection may remain as historical columns/data until a separately approved schema retirement, but it is **inert**: active MCP runtime routes and UI do not read or mutate it.

## 7. Customer UX

`/customers` shows canonical Công Ty customers assigned to the logged-in employee. Installation owner may see the whole installation.

`/customers/onboarding` shows the employee's field outlets and standalone verification states. No order/session IDs are required and the screen must not show a “continue order” CTA.

An existing/imported Công Ty customer does **not** need to be opened or linked again merely to create an order. **Mở / liên kết mã** is for an MCP field outlet that needs a canonical Công Ty customer relationship.

## 8. Official Sales Order boundary

An active canonical Công Ty customer with an active delivery address is order-eligible when the customer belongs to the trusted employee through `responsible_employee_id`. Installation owner may act installation-wide without changing that assignment.

A linked MCP field outlet is optional order provenance, not an order-eligibility prerequisite.

Active MCP flow:

```text
canonical Công Ty customer + active address + trusted employee authority
-> /orders
-> browser sends customerId + customerAddressId + variantId/quantity/note only
-> MCP backend validates canonical customer authority from Công Ty
-> MCP optionally resolves an existing linked field outlet for source attribution
-> MCP backend calls canonical Công Ty Sales Order API
-> Công Ty resolves price, tax, sales channel and other commercial rules
-> canonical Sales Order is stored with sourceType=MCP
```

Requirements:

- browser cannot supply employee authority, manual commercial price, sales channel or arbitrary customer authority;
- `responsible_employee_id` in Công Ty is the canonical employee assignment for normal MCP users;
- installation owner bypasses employee filtering only as installation authority and does not rewrite customer assignment;
- `Idempotency-Key` uses the shared canonical generator/contract;
- retry of the same logical create reuses the exact same key;
- `sourceId` is the canonical idempotency identity;
- `source_employee_id` records trusted MCP employee provenance at Sales Order creation;
- `sourceOutletId` records the linked MCP field outlet only when one unambiguous accessible link exists; otherwise it is `NULL`;
- Công Ty Sales Orders UI shows source `MCP` in the existing Sales Order lifecycle.

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
- session cards and closed-session views do not expose “Đơn Công Ty” links;
- recording `Nhu cầu mua` remains a reporting fact and stops there;
- MCP backend no longer exposes `/api/mcp-day/session-customer/customer-onboarding*` or `/api/mcp-day/session-customer/sales-order*` handlers;
- old adapter/source files for those runtime paths are removed;
- historical database columns/rows are not dropped in this cleanup.

## 10. Acceptance gate

The boundary is accepted only when source and CI prove:

- standalone verification works without purchase/order intent;
- browser cannot supply trusted employee authority;
- field outlet access remains employee-scoped and fail-closed;
- canonical customer access follows Công Ty `responsible_employee_id`, with explicit installation-owner bypass;
- existing/imported Công Ty customers with an active address can create MCP orders without reopening/linking a field outlet;
- an optional linked field outlet is retained only as source provenance;
- `Nhu cầu mua` has no Công Ty side effect;
- Công Ty resolves commercial authority;
- canonical idempotency generator is used and retry reuses the exact key;
- old session onboarding/order routes and wizard are unreachable/retired;
- Công Ty Sales Order UI clearly shows MCP source;
- exact-head CI is green.

Merge, production migration and deployment require separate explicit authorization.
