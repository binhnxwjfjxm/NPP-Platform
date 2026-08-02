# Phase 6 — Sales and MCP Customer Boundary Decisions

> Status: **ACTIVE PHASE 6 DECISION DOCUMENT**  
> Source baseline: `main@7c082641d46bfbe22b9e68924641933864ee184b`  
> Date: `2026-08-02`  
> Scope: customer identity, MCP adaptation, customer onboarding and MCP-to-Core Sales Order contract.  
> This document does not authorize production migration, deployment or MCP cutover.

## 1. Context

MCP Field is an existing field-sales application with working route, session, customer-entry, GPS, photo, visit, test, report and order-related flows. It is not a greenfield application to rebuild.

The integration strategy is:

```text
keep the current MCP workflows and UI
-> adapt the existing backend boundary
-> send the existing field-outlet snapshot to Core
-> let Core verify and create/link the official customer
-> synchronize the official customer reference back to MCP
-> call canonical Core order APIs only after the outlet is linked
```

Do not redesign MCP merely to make it resemble NPP Core. Do not create a second “new customer” form when MCP already has one.

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
existing “Thêm khách” field workflow
local/offline onboarding data before Core submission
Core request/order references and read models
MCP action logs
```

### NPP Core owns

```text
canonical customers and customer addresses
customer verification/review lifecycle after submission
products/SKU/units/prices
Sales Orders and amendments
credit policy
inventory reservation and fulfillment
Delivery Orders and dispatch
receivables, payments and refunds
```

MCP never writes directly to Core customer, sales, inventory, logistics or accounting tables.

## 3. Existing MCP “Thêm khách” behavior must be preserved

The current field workflow already exists in `mcp/src/features/mcp/McpSessionAddCustomerButton.tsx`.

It already collects:

```text
customer/outlet name
phone
area
address
note
GPS position and accuracy
outlet photos
active session identity
route context
```

It already calls the frontend backend-proxy route:

```text
POST /api/backend/mcp-day/session-customer/add
```

The route proxies to the MCP backend:

```text
POST /api/mcp-day/session-customer/add
```

The intended integrated behavior is:

```text
Employee taps “Thêm khách” in the active route/session
-> MCP creates/keeps the field outlet in the route and active session
-> MCP keeps GPS, photos and field notes under MCP ownership
-> MCP backend creates one canonical onboarding request in Core using the same outlet snapshot
-> Core verifies duplicates and completeness
-> Core creates a new official customer or links an existing one
-> MCP stores the Core request reference and synchronized status
-> when approved/linked, MCP stores the official customer ID, address ID and customer code
```

This is an adapter/integration task, not a replacement UI task.

## 4. Customer identity contract

### 4.1 Core customer

`shared.customers.id` is the immutable canonical Core customer identifier.

Only an active Core customer may participate in an official Sales Order.

### 4.2 MCP field outlet

A field outlet remains a separate identity because it may be a prospect or a real visit point before Core approval.

Minimum linkage fields:

```text
core_customer_id nullable
core_customer_address_id nullable
core_customer_code nullable/read model
core_onboarding_request_id nullable
core_onboarding_status nullable/read model
last_core_sync_at nullable
```

A field outlet may still be visited, tested, surveyed, photographed and followed up while Core verification is pending.

### 4.3 Link cardinality

```text
field_outlet 0..1 -> core_customer
field_outlet 0..1 -> core_customer_address
core_customer 0..n <- field_outlets
```

Multiple outlets may link to the same Core customer when they represent multiple physical locations approved by the business.

## 5. Core customer verification lifecycle

MCP submits the field-outlet snapshot. Core owns the canonical lifecycle after submission:

```text
submitted
under_review
need_more_info
approved
linked_existing
rejected
cancelled
```

Core reviewers may:

```text
request more information
create a new official customer/address
link an existing active customer/address
reject the request
```

MCP receives status and result references; it does not independently mutate the Core review lifecycle.

## 6. Required user-facing behavior

### Field employee

- keeps using the current “Thêm khách” button;
- does not enter the same information into a new screen;
- sees that the outlet was added to the route/session;
- sees a safe Core verification state such as “Đang xác minh”, “Cần bổ sung”, “Đã có mã khách”, or “Từ chối”;
- can continue field work while verification is pending;
- cannot create an official Core order until the outlet is linked to an active Core customer.

### Core reviewer

- sees the submitted outlet snapshot, GPS/photo references and source employee/route context as permitted;
- checks for duplicate customers;
- creates one customer/address or links an existing customer/address;
- records the review decision and reason;
- returns official customer references to MCP.

## 7. Idempotency and retry

Retrying the same MCP submission must not create a duplicate Core onboarding request.

Required source identity:

```text
source_system = MCP
source_outlet_id
source_request_id / idempotency key
installation_id
```

The same source request with the same payload replays the existing result. The same key with a different payload returns a conflict.

## 8. Official Sales Order gate

An unlinked field outlet may:

- be assigned to field routes;
- be added during an active session;
- be visited and checked in;
- participate in tests, reports and follow-ups;
- record demand/order intent;
- submit customer verification to Core.

It may not:

- create an official Core Sales Order;
- reserve or issue inventory;
- create receivables;
- enter Core delivery/dispatch;
- receive official credit decisions as an approved customer.

After Core approval/linking, MCP may submit an official order only through a canonical Core API using the returned Core customer/address IDs.

## 9. Delivery sequence

```text
6C.1A preserve existing MCP Add Customer flow and add Core verification bridge
6C.1B complete Core reviewer operations and MCP status/reference synchronization
6C.2  adapt existing MCP order flow to canonical Core Sales Order API
```

Each slice must preserve the existing MCP user workflow and avoid broad UI rewrites.

## 10. Acceptance gate

The boundary is accepted when tests prove:

- the existing MCP “Thêm khách” flow still adds the outlet to the active route/session;
- the same captured data is submitted once to Core;
- retry does not duplicate the Core request;
- Core can create one customer/address or link an existing one;
- link-existing creates no duplicate customer;
- MCP receives customer ID, address ID and customer code after approval/linking;
- pending or rejected outlets remain available for field work but cannot create official Core orders;
- GPS/photos stay under MCP ownership and are referenced safely rather than copied blindly;
- MCP cannot directly mutate Core customer, inventory, logistics or receivable tables;
- source and production status are reported separately.
