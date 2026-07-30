# Phase 6 — Sales and MCP Customer Boundary Decisions

> Status: **ACTIVE PHASE 6 DECISION DOCUMENT**  
> Source baseline: `main@6983844b9f6b4a63ad0fe04863f1492e360050cb`  
> Date: `2026-07-30`  
> Scope: customer identity, MCP adaptation, customer onboarding and MCP-to-Core Sales Order contract.  
> This document does not authorize production migration, deployment or MCP cutover.

## 1. Context

MCP Field is an existing field-sales application, not a greenfield application to rebuild from zero.

The repository already contains working or substantially implemented MCP flows for:

- dashboard and compact mobile navigation;
- field routes and route customer lists;
- route sessions and visits;
- product/customer field tests;
- order display;
- market reports and follow-up/action concepts;
- live read adapters to the legacy Supabase source.

The integration strategy is therefore:

```text
keep correct MCP workflows and UI
-> audit legacy data and identities
-> complete backend-owned write models
-> replace legacy data adapters
-> link canonical Core identities
-> call canonical Core APIs
-> migrate/cut over only after reconciliation
```

Do not redesign MCP merely to make it resemble NPP Core.

## 2. Locked ownership

### MCP owns

```text
field routes
field outlets
field route-outlet assignments
field route sessions
session outlet snapshots
visits/check-in
field tests
market reports
follow-ups
field media
local/offline onboarding drafts
Core request/order references and read models
MCP action logs
```

### NPP Core owns

```text
canonical customers and customer addresses
customer onboarding review lifecycle after submission
products/SKU/units/prices
Sales Orders and amendments
credit policy
inventory reservation and fulfillment
Delivery Orders and dispatch
receivables, payments and refunds
```

MCP never writes directly to Core customer, sales, inventory, logistics or accounting tables.

## 3. Canonical terminology

Use these names in new contracts and documentation:

| Term | Owner | Meaning |
|---|---|---|
| `field_route` | MCP | A field employee's visit/sales route. |
| `field_outlet` | MCP | A physical outlet/prospect/visit point; may not be a Core customer. |
| `field_route_outlet_assignment` | MCP | Time-bounded assignment and sequence of an outlet on a field route. |
| `core_customer` | Shared/Core | An approved official customer represented by `shared.customers.id`. |
| `core_customer_address` | Shared/Core | A canonical address represented by `shared.customer_addresses.id`. |
| `delivery_route` | Core Logistics | A standard transportation route. |
| `delivery_trip` | Core Logistics | A concrete dispatch trip by date/shift. |

Legacy names such as `mcp_route_customers` remain source-table names until a separately rehearsed migration. New code must not rename tables or add constraints without orphan and duplicate audits.

## 4. Customer identity contract

### 4.1 Core customer

`shared.customers.id` is the immutable canonical Core customer identifier.

Only an active Core customer may participate in an official Sales Order.

Core customer master data may include:

```text
customer code
name
contacts
customer group/channel
responsible employee
payment terms
credit limit/profile
official status
canonical addresses
```

Sales-specific extensions may live in `sales` tables, but they reference `shared.customers.id`; they do not create a second customer identity.

### 4.2 MCP field outlet

A field outlet is a separate identity because it may be:

- a prospect;
- a new outlet awaiting approval;
- an outlet with incomplete legal/contact information;
- a physical branch of an existing Core customer;
- an outlet that is valid for visits/tests but not for official orders;
- rejected or archived without ever becoming a Core customer.

Proposed canonical MCP entity:

```text
mcp.field_outlets
- id
- installation_id
- name
- phone nullable
- address_text nullable
- gps_lat nullable
- gps_lng nullable
- lifecycle_status
- source
- core_customer_id nullable
- core_customer_address_id nullable
- created_by_employee_id
- created_at
- updated_at
```

Suggested lifecycle:

```text
prospect
qualified
pending_core_approval
linked
rejected
archived
```

The exact migration must be based on an audit of the current legacy MCP schema. This document does not authorize creating these tables immediately.

### 4.3 Link cardinality

Minimum contract:

```text
field_outlet 0..1 -> core_customer
field_outlet 0..1 -> core_customer_address
core_customer 0..n <- field_outlets
```

A field outlet may link to an existing Core customer and one canonical address. Multiple outlets may represent multiple physical points under the same Core customer when the business approves that model.

Changing a link requires permission, audit and conflict checks. Historical visits and order references retain their original outlet identity.

## 5. Field route assignment contract

Do not store a route as an immutable property of the outlet.

Use a separate assignment concept:

```text
mcp.field_route_outlet_assignments
- field_route_id
- field_outlet_id
- sequence
- valid_from
- valid_to nullable
- is_active
- assignment metadata
```

This supports:

- moving an outlet between routes;
- preserving assignment history;
- one outlet appearing in different route plans over time;
- stable session snapshots when route master data changes.

Opening a field session creates a session-outlet snapshot. Later changes to route assignments do not mutate the opened session.

## 6. Customer onboarding request

### 6.1 Ownership rule

Before submission, MCP may keep a local/offline draft.

After submission, NPP Core owns the canonical review lifecycle. MCP stores only the Core request reference and a synchronized status/read model.

Do not maintain two independently mutable canonical request lifecycles in both applications.

### 6.2 Core entity proposal

```text
sales.customer_onboarding_requests
- id
- installation_id
- source_system
- source_outlet_id
- source_request_id
- requested_by_actor_id
- proposed_name
- proposed_phone
- proposed_address
- proposed_tax_code nullable
- proposed_contact_name nullable
- proposed_area nullable
- status
- approved_customer_id nullable
- approved_customer_address_id nullable
- rejected_reason nullable
- reviewed_by nullable
- reviewed_at nullable
- created_at
- updated_at
```

Duplicate candidates may initially be stored as a versioned review snapshot, but they are not a replacement for canonical customer relationships.

### 6.3 Lifecycle

```text
submitted
under_review
need_more_info
approved
linked_existing
rejected
cancelled
```

### 6.4 Workflow

```text
MCP employee creates/uses field outlet
-> prepares onboarding draft
-> submits canonical request to Core
-> Core checks duplicates and completeness
-> reviewer requests information, approves new customer, links existing customer, or rejects
-> Core returns canonical customer/address IDs when approved or linked
-> MCP updates the outlet link read model
```

### 6.5 Required behavior

An outlet without `core_customer_id` may:

- be assigned to field routes;
- be visited and checked in;
- participate in surveys/tests/reports;
- receive follow-up actions;
- record demand or a non-posted order intent;
- submit a customer onboarding request.

It may not:

- create an official Core Sales Order;
- reserve or issue inventory;
- create receivables;
- enter Core delivery/dispatch;
- receive official price/credit decisions as though it were an approved customer.

## 7. MCP Sales Order integration

### 7.1 Entry contract

MCP creates an official order only through a canonical Core API and only for a linked active customer.

Required source fields:

```text
source_type = MCP
source_id
source_outlet_id
idempotency_key
actor_id/request_id
core_customer_id
core_customer_address_id when delivery is requested
canonical SKU IDs
canonical unit IDs
quantity and note
```

Core remains authoritative for:

- customer activity and eligibility;
- address validity;
- price resolution;
- discount/tax policy;
- unit/conversion validation;
- credit policy;
- stock/reservation policy;
- document numbering and status transitions.

### 7.2 Unlinked customer error

Stable error example:

```text
code: CUSTOMER_NOT_LINKED
message: Khách tuyến chưa có mã khách hệ thống. Vui lòng gửi đề nghị mở mã khách hàng hoặc liên kết với khách hàng có sẵn.
retryable: false
```

The response may include a safe action hint such as `submit_onboarding_request` or `link_existing_customer`; it must not expose unrestricted customer records.

### 7.3 Idempotency

Retrying the same source request with the same canonical payload returns the same Core result.

The same idempotency key with a different payload returns a conflict.

MCP stores:

```text
core_order_id
core_order_number
core_order_status
last_synced_at
source request/idempotency reference
```

MCP must not create a second Core order because a network response was lost.

### 7.4 Legacy MCP orders

Existing legacy `orders` and `order_items` must be audited before migration.

Each legacy order must be classified as one of:

```text
official order eligible for migration
field order request/intent
sample/test demand
historical display-only record
invalid/orphan record requiring reconciliation
```

Do not bulk-insert every legacy MCP order into `sales.sales_orders` without customer, SKU/unit, status, money and source reconciliation.

## 8. MCP read integration

MCP may read scoped Core projections for:

```text
linked customers and addresses
assigned/available customers according to policy
active product/SKU catalog
sales units and conversions
resolved price
credit warning
available-stock read model according to permission
Core order status
fulfillment status
delivery/dispatch status read-only
```

MCP may display permitted vehicle/driver information for an assigned delivery, but it does not dispatch or mutate trips.

## 9. MCP adaptation track

### M1 — Legacy audit and mapping

- audit route/outlet/session/visit/order relationships and orphan rows;
- map existing employee/user identities;
- classify route customers as field outlets versus known Core customers;
- define stable legacy-to-canonical ID mapping.

### M2 — Backend-owned MCP writes

- preserve working UI;
- route writes through MCP backend;
- complete session-outlet snapshots;
- make visit/test/report/follow-up mutations permissioned and auditable;
- remove unsafe direct anonymous writes.

### M3 — Customer onboarding bridge

- local/offline draft;
- submit to Core;
- synchronize review status;
- store customer/address link.

### M4 — Sales Order adapter

- canonical SKU/unit/customer/address references;
- idempotent retry;
- no duplicate Core order;
- stable Core reference stored in MCP.

### M5 — Read-only order and delivery sync

- order status;
- fulfillment status;
- delivery/trip status;
- safe error and retry handling.

### M6 — Infrastructure cutover

- replace Supabase/VPS adapters only after repository contract tests, data export/import, reconciliation, backup and restore rehearsal;
- avoid changing UI, domain names and data provider in one unreviewable commit.

## 10. API surface proposal

Exact endpoints are locked in the implementation slice, but the canonical capability groups are:

```text
POST /api/customer-onboarding-requests
GET  /api/customer-onboarding-requests
GET  /api/customer-onboarding-requests/:id
POST /api/customer-onboarding-requests/:id/submit
POST /api/customer-onboarding-requests/:id/approve
POST /api/customer-onboarding-requests/:id/link-existing
POST /api/customer-onboarding-requests/:id/request-info
POST /api/customer-onboarding-requests/:id/reject

POST /api/sales-order-requests
```

Administrative review mutations belong to Core permissions. MCP employee permissions cannot approve their own onboarding request unless an explicit policy is later approved.

## 11. Event/outbox groups

```text
core.customer_onboarding.submitted
core.customer_onboarding.need_more_info
core.customer_onboarding.approved
core.customer_onboarding.linked_existing
core.customer_onboarding.rejected

core.sales_order.created
core.sales_order.confirmed
core.sales_order.cancelled
core.sales_order.amended
```

Every event follows the platform outbox contract and includes aggregate identity, version, occurred time, source, actor and request correlation.

## 12. Permissions

Minimum additions:

```text
core.customer-onboarding.read
core.customer-onboarding.submit
core.customer-onboarding.review
core.customer-onboarding.approve
core.customer-onboarding.link-existing
core.customer-onboarding.reject
core.sales-order-request.create
```

Permissions remain installation-scoped and may also be constrained by branch, warehouse, employee or territory according to the implementation slice.

## 13. Acceptance gate

The boundary is accepted when tests prove:

- an unlinked field outlet can be visited but cannot create an official Sales Order;
- submitting onboarding twice with the same key does not duplicate the request;
- approving creates one Core customer/address or links an existing one;
- link-existing does not create a duplicate customer;
- MCP receives canonical customer/address IDs;
- MCP Sales Order retry does not duplicate the Core order;
- Core rejects inactive customer, invalid address and noncanonical SKU/unit references;
- historical field visits remain attached to the field outlet after linking;
- MCP cannot directly mutate Core customer, inventory, logistics or receivable tables;
- source and production status are reported separately.
