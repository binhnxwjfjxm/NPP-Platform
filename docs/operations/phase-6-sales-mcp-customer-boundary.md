# Phase 6 — Sales and MCP Customer Boundary Decisions

> Status: **ACTIVE — UPDATED 2026-08-15**  
> This revision supersedes the previous rule that Core customer verification required purchase demand/order intent.  
> Scope of this revision: **Customer boundary only**. The direct MCP → Core Sales Order boundary remains a later slice.  
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

A separate explicit action **Mở / liên kết mã** may now be used at any time for a sufficiently complete field outlet. It is **not dependent on purchase demand, `Có mua`, order intent, or an order**.

```text
MCP employee explicitly requests verification
-> MCP verifies trusted employee ownership of the field outlet
-> MCP sends FIELD_PROFILE_VERIFICATION to Core
-> Core reviews duplicate/master-data completeness
-> Core approves a new customer/address or links an existing customer/address
-> Core customer responsible_employee_id is the trusted MCP employee
-> MCP stores only Core request/link references
```

`Có mua` / `Có đơn` remain reporting facts. They must not create a customer request, order intent, redirect, or official Sales Order as a side effect.

## 2. Ownership

### MCP owns

- field routes and field outlets;
- route/session execution, visits, GPS, media, tests, reports and follow-ups;
- the explicit customer-verification projection and Core reference IDs;
- employee-scoped MCP presentation/read flows.

### NPP Core owns

- `shared.customers` and customer addresses;
- customer codes and canonical customer status;
- verification/review lifecycle;
- responsible employee on canonical customers;
- official products/prices and Sales Orders.

MCP must not write directly to canonical Core customer, sales, inventory, logistics or accounting tables.

## 3. Trusted employee boundary

Browser input is never trusted as employee authority.

The customer boundary uses:

```text
Core workforce login/session
-> MCP web middleware resolves the session
-> middleware replaces any browser Authorization value with an internal workforce identity
-> MCP backend derives principal.employeeId
-> MCP verifies field-outlet ownership
-> MCP Core adapter forwards employee identity under the MCP service-token boundary
-> Core requestContext.employeeId becomes requested_by_employee_id
```

A missing, inactive, ambiguous or mismatched employee fails closed.

Canonical MCP customer lists read `mcp.accounts` / `shared.customers` and are filtered by `responsible_employee_id = trusted employeeId`.

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

For `FIELD_PROFILE_VERIFICATION`, transition to `approved` or `linked_existing` must atomically guarantee:

```text
approved_customer_id exists and is active
requested_by_employee_id exists and is active
shared.customers.responsible_employee_id = requested_by_employee_id
```

The invariant is enforced in the same database transaction as the Core onboarding transition.

## 6. MCP projection

Standalone verification state is stored on the stable field outlet (`mcp.mcp_route_customers`), not on `mcp.orders`.

The projection includes:

```text
responsible_employee_id
customer_verification_operation_id
customer_verification_idempotency_key
customer_verification_payload
customer_verification_fingerprint
core_onboarding_request_id
core_onboarding_status
core_customer_id
core_customer_address_id
core_customer_code
last_core_sync_at
```

The operation ID, canonical idempotency key, immutable payload and fingerprint are persisted **before** the outbound Core POST so a retry reuses the exact same Core `Idempotency-Key` after a transport failure.

Legacy order-based onboarding projection remains temporarily isolated for compatibility and is removed/refactored only with the later Order-boundary slice.

## 7. Customer UX

`/customers` shows only canonical Core customers assigned to the logged-in employee.

`/customers/onboarding` shows the employee's field outlets and standalone states:

```text
Chưa gửi
Đã gửi Core
Core đang xác minh
Cần bổ sung
Đã mở mã
Đã liên kết
Bị từ chối
Đã hủy
```

No order/session IDs are required by this screen and it must not show a “continue order” CTA.

## 8. Official Sales Order gate — unchanged in this slice

Only a linked active Core customer/address may later create an official Core Sales Order.

The current legacy MCP order flow is intentionally not removed in this Customer-boundary slice. Direct official order creation from canonical customer + product/quantity/note is handled by the next Order-boundary implementation.

## 9. Acceptance gate for Customer boundary

This slice is accepted only when source and CI prove:

- `Thêm khách` remains field-only;
- standalone verification works without purchase/order intent;
- browser cannot supply trusted employee authority;
- field outlet access is employee-scoped and fail-closed;
- Core approval/link assigns the canonical responsible employee;
- MCP canonical customer list is employee-scoped;
- standalone verification does not read/write `mcp.orders`;
- canonical idempotency generator is used and retry reuses the stored key;
- migrations are registered and rehearsal/tests pass;
- exact-head CI is green.

Merge, production migration and deployment require separate explicit authorization.
