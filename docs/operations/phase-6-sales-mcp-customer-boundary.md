# Phase 6 — Sales and MCP Customer Boundary Decisions

> Status: **ACTIVE PHASE 6 DECISION DOCUMENT**  
> Audited source baseline: `main@7c082641d46bfbe22b9e68924641933864ee184b`  
> Active implementation: Issue #151 / Draft PR #153  
> Date: `2026-08-02`  
> Scope: field-outlet identity, demand-triggered customer verification and the later MCP-to-Core Sales Order gate.  
> This document does not authorize production migration, deployment, provider changes, merge or MCP cutover.

## 1. Non-negotiable product decision

MCP Field is an existing field-sales application. Its route, session, customer-entry, GPS, outlet-photo, visit, test, report, follow-up and order-intent workflows must be preserved.

The existing MCP `Thêm khách` action is a field-operation action only:

```text
employee opens an active route/session
-> taps “Thêm khách”
-> MCP creates or keeps a field outlet in the route and active session
-> MCP stores its field data, GPS, photos and notes
-> no Core verification request is created
-> no official Core customer/address is created or linked
-> no company customer code is assigned
```

A field outlet may be a prospect, visit point, historical outlet, shop with no purchase yet, or another market record. Adding it to a route/session does not prove that it is a company customer.

Core verification/open-code is allowed only after a real buying event needs an official order:

```text
MCP records purchase demand or an order intent
-> the outlet has no active Core customer/address link
-> the employee explicitly requests verification/open-code from the order flow
-> the request carries a stable demand/order-intent reference
-> Core reviews duplicates and master-data completeness
-> Core links an existing active customer/address or approves one new customer/address
-> MCP stores the returned Core request and official references
-> only then may an official Sales Order be submitted to Core
```

**No purchase-demand trigger means no Core request.**

This rule prevents route prospects and low-quality field records from polluting the canonical customer master.

## 2. Locked ownership

### MCP owns

```text
field routes
field outlets
route-outlet assignments
field route sessions
session outlet snapshots
visits and check-in
field tests
market reports
follow-ups
GPS and field media
existing “Thêm khách” workflow
purchase demand and pre-official order intent
Core request/order references and synchronized read models
MCP action logs
```

### NPP Core owns

```text
canonical customers and customer addresses
verification/review lifecycle after explicit submission
customer codes
products, SKU, units and prices
Sales Orders and amendments
credit policy
inventory reservation and fulfillment
Delivery Orders and dispatch
receivables, payments and refunds
```

MCP must not write directly to Core customer, sales, inventory, logistics or accounting tables.

## 3. Existing MCP `Thêm khách` boundary

The current UI lives at:

```text
mcp/src/features/mcp/McpSessionAddCustomerButton.tsx
```

It already captures:

```text
outlet name
phone
area
address
note
GPS position and accuracy
outlet photos
active session identity
route context
```

Its existing frontend route is:

```text
POST /api/backend/mcp-day/session-customer/add
```

That route proxies only to the MCP backend:

```text
POST /api/mcp-day/session-customer/add
```

Phase 6C.1A must prove that neither boundary calls:

```text
/api/customer-onboarding-requests
```

The add-customer flow may continue to create route/session records and upload MCP-owned media. It must not gain hidden Core side effects.

## 4. Identity and linkage contract

### 4.1 Core customer

`shared.customers.id` is the immutable canonical customer identifier. `shared.customer_addresses.id` is the immutable canonical address identifier.

Only an active Core customer and active address in the same installation may be used for an official order.

### 4.2 MCP field outlet

A field outlet remains a separate identity before and after linking because Core customers may have multiple physical locations and MCP may retain market-history records.

Minimum future linkage/read-model fields are:

```text
core_customer_id nullable
core_customer_address_id nullable
core_customer_code nullable
core_onboarding_request_id nullable
core_onboarding_status nullable
last_core_sync_at nullable
```

These fields are references/read models. They do not transfer Core ownership to MCP.

### 4.3 Cardinality

```text
field_outlet 0..1 -> core_customer
field_outlet 0..1 -> core_customer_address
core_customer 0..n <- field_outlets
```

The linked address must belong to the linked customer, both must be active, and both must belong to the same installation.

## 5. Demand-triggered Core request contract

The Core foundation endpoint is:

```text
POST /api/customer-onboarding-requests
```

A valid submission requires:

```text
source_system = MCP
source_outlet_id
source_demand_reference
order_required = true
trigger_reason = OFFICIAL_ORDER_REQUIRED
immutable proposed customer/address snapshot
Idempotency-Key
installation and actor context from trusted authentication
```

The request must not accept client-supplied review status, reviewer identity, approved customer ID or approved address ID.

GPS/photo data stays under MCP ownership. Core receives safe references/metadata where required; Phase 6C.1A does not blindly copy MCP media into Core.

## 6. Core lifecycle and authority

Core owns the lifecycle:

```text
submitted
under_review
need_more_info
approved
linked_existing
rejected
cancelled
```

Allowed transitions in Phase 6C.1A:

```text
submitted -> under_review
need_more_info -> under_review
under_review -> need_more_info
under_review -> approved
under_review -> linked_existing
under_review -> rejected
submitted | under_review | need_more_info -> cancelled
```

Mutations require optimistic `expectedVersion` checks.

Review authority is split by explicit deny-by-default permissions:

```text
core.customer-onboarding.read
core.customer-onboarding.submit
core.customer-onboarding.review
core.customer-onboarding.approve
core.customer-onboarding.link-existing
core.customer-onboarding.reject
```

An MCP service principal may receive only `read` and `submit`. Those permissions must not imply review, approve, link or reject authority.

## 7. Approval and link-existing invariants

### Approve new customer

Approval must perform one transaction that:

```text
locks the onboarding request
checks installation, status and expected version
creates exactly one shared.customers row
creates exactly one default shared.customer_addresses row from the immutable snapshot
stores the resulting IDs on the onboarding request
moves the request to approved
writes one audit record and one outbox event
```

Any failure rolls back customer, address, request transition, audit and outbox together.

### Link existing

Linking must:

```text
lock the onboarding request
check installation, status and expected version
verify the selected customer is active
verify the selected address is active
verify the address belongs to that customer
store the two existing IDs
move the request to linked_existing
create no duplicate customer/address
write one audit record and one outbox event
```

## 8. Idempotency and source deduplication

Two protections are required:

1. Generic API idempotency scope:

```text
installation_id
actor_id
HTTP method
exact route including request ID for item actions
Idempotency-Key
canonical payload fingerprint
```

The same key and same payload replays the stored response. The same key with a different payload returns `IDEMPOTENCY_PAYLOAD_MISMATCH`.

2. Business demand identity:

```text
installation_id
source_system
source_outlet_id
source_demand_reference
```

The same demand and same immutable snapshot returns the existing request. The same demand reference with a different snapshot returns a conflict. Retrying must never create duplicate requests, customers or addresses.

## 9. Read isolation

All reads and writes are installation-scoped.

A principal with review authority may read the installation review queue. A submit/read-only MCP principal may read only requests created by that actor. Cross-installation IDs return not found and are never linked.

## 10. Official Sales Order gate

An unlinked MCP field outlet may:

- remain on routes and sessions;
- receive visits, check-ins, tests, reports and follow-ups;
- keep GPS/photos under MCP ownership;
- record purchase demand or a non-official order intent;
- explicitly request Core verification when an official order is needed.

It may not:

- create an official Core Sales Order;
- reserve or issue inventory;
- create receivables;
- enter Core delivery/dispatch;
- receive official credit decisions as an approved customer.

After approval/linking, MCP may submit an official order only through a canonical Core API using the returned Core customer and address IDs.

## 11. Delivery sequence

```text
6C.1A Core demand-triggered customer verification foundation
       - migration and permissions
       - submit/read/review lifecycle APIs
       - approve-new and link-existing transactions
       - idempotency, installation scope, audit/outbox
       - source proof that MCP “Thêm khách” stays field-only

6C.1B MCP order-flow request/status synchronization
       - explicit trigger from purchase demand/order intent
       - request/status/result references on MCP
       - no automatic trigger from route/session add-customer

6C.2  MCP official Sales Order adapter
       - only after active Core customer/address linkage
```

Each slice must preserve the existing MCP workflow and avoid broad UI rewrites.

## 12. Acceptance gate

Phase 6C.1A is accepted only when source and CI prove:

- exact `main`, branch history and documentation diff were audited before code changes;
- existing MCP `Thêm khách` still targets only the MCP route/session endpoint;
- no Core request is created without `source_demand_reference` and `order_required=true`;
- submit/read callers cannot perform review/admin actions;
- installation isolation is fail-closed;
- same idempotency key/same payload replays and different payload conflicts;
- same source demand does not duplicate the request;
- reviewer payload cannot overwrite the captured customer/address snapshot;
- approve creates one customer and one address atomically;
- link-existing validates active ownership and creates no customer/address;
- every successful mutation writes exactly one audit record and one outbox event in the same transaction;
- source completion is reported separately from deployment, production migration and cutover.

## 13. Production boundary

Phase 6C.1A is source-only until separately authorized. It does not prove or authorize:

```text
production backup readiness
production migration 041
Heroku or Vercel deployment
provider/environment changes
MCP traffic cutover
merge to main
```
