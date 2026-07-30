# Phase 6 — Transportation and Dispatch Decisions

> Status: **ACTIVE PHASE 6 DECISION DOCUMENT**  
> Source baseline: `main@6983844b9f6b4a63ad0fe04863f1492e360050cb`  
> Date: `2026-07-30`  
> Scope: Delivery Order, transportation route, vehicle, driver, trip, attempt, POD/COD boundary and inventory interaction.  
> This document does not authorize production migration, deployment or vehicle tracking.

## 1. Purpose

Transportation/Dispatch is not a field-sales feature and is not a status column on Sales Order.

It is a Core domain that connects:

```text
Sales Order
customer and canonical delivery address
warehouse fulfillment
inventory issue and in-transit facts
Delivery Order
vehicle and driver assignment
delivery attempts
proof of delivery
customer return/COD/accounting references
```

The design must support:

- one order delivered in multiple parts;
- one trip containing many delivery orders;
- one delivery order assigned to multiple attempts or trips;
- vehicle/driver reassignment before dispatch;
- partial, failed, returned and rescheduled delivery;
- immutable operational history and audit.

## 2. Locked ownership

### Core Sales owns

```text
Sales Orders and lines
fulfillment/allocation references
Delivery Orders and lines
customer/address snapshots
commercial delivery requirements
partial/backorder/cancel-remaining decisions
customer return references
```

### Core Logistics owns

```text
delivery routes
vehicles
driver profiles
trip crew members
delivery trips
trip stops
delivery-order assignments
delivery attempts
proof-of-delivery references
dispatch transitions and audit
```

### Core Inventory owns

```text
reservations
stock issue/return movements
in-transit inventory facts
balances and reconciliation
```

### Core Accounting owns

```text
receivable posting
payment allocation
COD receipt/allocation
refund/write-off references
```

MCP may read permitted delivery status; it does not own or mutate dispatch.

## 3. Schema decision

Add `logistics` to the target PostgreSQL schemas:

```text
shared
mcp
sales
purchasing
inventory
logistics
accounting
reporting
```

Target migration path:

```text
database/migrations/logistics/
```

Do not place vehicle/trip tables temporarily in `sales` merely to move them later.

No logistics migration is created until the Phase 6E implementation slice re-audits the actual migration registry and locks transitions, permissions and posting points.

## 4. Canonical terminology

| Term | Meaning |
|---|---|
| `field_route` | MCP route used by field employees to visit outlets. |
| `delivery_route` | Core logistics route template or standard service area. |
| `delivery_trip` | A concrete dispatch run by date/shift. |
| `trip_stop` | A planned/actual stop on one trip. |
| `delivery_order` | Core document representing goods that must be delivered to a customer/address. |
| `delivery_attempt` | One immutable result record for an attempted delivery. |
| `proof_of_delivery` | Evidence attached to one delivery attempt. |

Never use an unqualified `route` in a new cross-domain contract.

## 5. Document separation

### 5.1 Sales Order

Represents what the customer ordered and the commercial agreement.

Sales Order must not use these fields as transportation source of truth:

```text
vehicle_id
driver_id
trip_id
delivered_at
failed_reason
```

Derived order/fulfillment/delivery statuses may summarize child documents, but child documents remain authoritative.

### 5.2 Fulfillment/allocation

Represents which quantities are reserved, allocated, picked and packed.

It is separate from the commercial order and separate from the trip.

### 5.3 Delivery Order

Represents a deliverable requirement generated from a Sales Order/fulfillment.

Proposed minimum header:

```text
id
installation_id
sales_order_id
customer_id
customer_address_id
delivery_address_snapshot
warehouse_id
planned_delivery_date
priority
status
note
created_at
updated_at
```

Proposed status vocabulary:

```text
draft
ready_to_dispatch
planned
partially_dispatched
dispatched
partially_delivered
delivered
failed
returned
cancelled
closed
```

Exact transitions are locked in the implementation slice.

### 5.4 Delivery Order line

Proposed quantities:

```text
ordered_quantity
deliverable_quantity
dispatched_quantity
delivered_quantity
failed_quantity
returned_quantity
```

Every line references the originating Sales Order line and canonical SKU/unit snapshots.

## 6. Logistics entities

### 6.1 Delivery route

A reusable transportation route or service area.

```text
logistics.delivery_routes
- id
- installation_id
- code
- name
- area/description
- default_warehouse_id nullable
- is_active
- audit fields
```

It is not an MCP field route.

### 6.2 Vehicle

```text
logistics.vehicles
- id
- installation_id
- code
- license_plate
- vehicle_type
- capacity_weight nullable
- capacity_volume nullable
- operational_status
- is_active
- audit fields
```

A vehicle is an operational master record, not an inventory warehouse in the initial foundation.

### 6.3 Driver profile

```text
logistics.driver_profiles
- id
- installation_id
- employee_id nullable
- name
- phone nullable
- license_reference nullable
- is_active
- audit fields
```

A driver may link to an employee. Identity and permissions remain server-owned.

### 6.4 Trip crew member

Do not store helper IDs as a JSON array.

Use a relationship:

```text
logistics.trip_crew_members
- trip_id
- driver_profile_id or employee_id
- crew_role
- assigned_at
- removed_at nullable
- audit metadata
```

This preserves FK integrity, role, history and audit.

### 6.5 Delivery trip

A concrete trip:

```text
logistics.delivery_trips
- id
- installation_id
- trip_number
- delivery_route_id nullable
- warehouse_id
- vehicle_id nullable
- primary_driver_id nullable
- planned_start_at nullable
- dispatched_at nullable
- closed_at nullable
- status
- audit fields
```

Suggested lifecycle:

```text
draft
planned
locked
dispatched
in_progress
partially_completed
completed
failed
cancelled
closed
```

### 6.6 Trip stop

```text
logistics.trip_stops
- id
- installation_id
- trip_id
- stop_sequence
- customer_id
- customer_address_id
- address_snapshot
- planned_arrival_at nullable
- actual_arrival_at nullable
- status
```

A stop may group multiple Delivery Orders for the same approved address when the business allows it.

### 6.7 Trip-order assignment

```text
logistics.trip_order_assignments
- id
- installation_id
- trip_id
- trip_stop_id
- delivery_order_id
- assignment_status
- assigned_by
- assigned_at
- unassigned_at nullable
- reason nullable
```

One Delivery Order may have multiple historical assignments when delivery is split, rescheduled or attempted again. Active assignment uniqueness rules must be explicit.

### 6.8 Delivery attempt

An immutable result of one attempted delivery:

```text
logistics.delivery_attempts
- id
- installation_id
- delivery_order_id
- trip_id nullable
- trip_stop_id nullable
- attempt_number
- status
- delivered_at nullable
- failed_reason nullable
- received_by nullable
- cod_amount_collected nullable
- note nullable
- created_at
- created_by
```

Suggested statuses:

```text
delivered_full
delivered_partial
failed_customer_absent
failed_customer_rejected
failed_address_issue
failed_vehicle_issue
returned_to_warehouse
```

The implementation may normalize failure reason into a code catalog rather than creating an excessive status enum.

### 6.9 Proof of delivery

```text
logistics.proof_of_delivery
- id
- installation_id
- delivery_attempt_id
- pod_type
- file_id nullable
- signature_name nullable
- gps_lat nullable
- gps_lng nullable
- captured_at
- captured_by
```

Supported foundation types may include:

```text
signature
photo
otp
manual_confirm
```

Files use the Core object-storage boundary. Production POD upload is blocked until R2 configuration and access controls are freshly audited.

## 7. Main lifecycle

```text
Sales Order confirmed
-> inventory reservation/allocation
-> pick
-> pack
-> Delivery Order ready_to_dispatch
-> dispatcher assigns Delivery Order to trip/stop
-> assigns vehicle and crew
-> locks trip
-> dispatches trip
-> posts the approved inventory issue transition
-> records delivery attempts per stop/order
-> updates Delivery Order projections
-> posts receivable/COD/payment facts according to locked accounting policy
-> closes trip after reconciliation
```

The exact inventory issue and receivable posting transitions are unresolved business decisions and must be approved in Phase 6A.

## 8. Partial delivery

A Delivery Order is not completed when delivered quantity is below deliverable quantity.

The remaining quantity must take one explicit path:

```text
backorder
reschedule
cancel remaining
approved amendment
```

Only actual approved issue/delivery quantities affect inventory and accounting according to the locked posting policy.

## 9. Failed delivery

A failed attempt records its own immutable result.

The Delivery Order then transitions according to policy, for example:

```text
ready_to_dispatch again
rescheduled
returned
cancelled
closed with approved exception
```

If inventory was already issued, the remaining stock must be explicitly represented as one of:

```text
in_transit
returned_to_warehouse
assigned to a new trip
lost/damaged through an approved exception movement
```

Failure must never silently mark the Sales Order completed.

## 10. Customer return

Customer Return must reference available origins:

```text
sales_order_line
delivery_order_line
delivery_attempt
inventory movement source
```

A return request alone does not increase inventory or reduce receivable. Posting occurs only after receipt/inspection and the owning inventory/accounting transitions.

## 11. Vehicle and inventory decision

### Initial decision

```text
vehicle and delivery trip are not warehouse master records
```

Use explicit shipment/trip/in-transit state and inventory movements instead of creating a virtual warehouse for every vehicle.

Benefits:

- avoids fake warehouse/location proliferation;
- avoids accidental costing and balance behavior tied to vehicle records;
- keeps dispatch foundation simpler;
- preserves the option to add virtual locations later if operations truly require stock-on-vehicle reconciliation.

### Future option

Vehicle/trip virtual locations may be considered in Phase 7 or later only after real operational evidence and a migration/reconciliation design.

## 12. Posting decisions still requiring owner approval

Before implementation of dispatch mutation, lock:

1. inventory issue at loading/dispatch, confirmed delivery, or another transition;
2. receivable posting at confirmation/invoice, dispatch, or confirmed delivery;
3. whether failed delivery keeps stock in transit or requires immediate return posting;
4. whether a trip may dispatch without vehicle/driver assignment;
5. when assignment becomes immutable;
6. reassignment rules after lock/dispatch;
7. COD collection and handover lifecycle;
8. lot allocation/FEFO behavior;
9. weight/volume capacity enforcement versus advisory warning;
10. POD requirement by customer/channel/order type.

Programmers must not infer these rules.

## 13. API capability groups

Exact endpoint names are locked in the implementation slice. Proposed groups:

```text
Delivery Orders
- list/get/create/update readiness
- cancel/close according to transition

Delivery Trips
- create/update plan
- assign/unassign Delivery Orders
- reorder stops
- assign vehicle/crew
- lock
- dispatch
- close

Delivery Attempts
- record full/partial/failed attempt
- attach POD
- record safe COD fact
```

Every mutation uses server-owned installation and warehouse/branch scope, permission checks, idempotency when retryable, audit and outbox.

## 14. Event/outbox groups

```text
core.delivery_order.created
core.delivery_order.ready_to_dispatch
core.delivery_order.assigned_to_trip
core.delivery_order.delivered

core.delivery_trip.planned
core.delivery_trip.locked
core.delivery_trip.dispatched
core.delivery_trip.reassigned
core.delivery_trip.closed

core.delivery_attempt.completed
core.delivery_attempt.failed
core.delivery_attempt.pod_attached
```

Event payloads contain safe canonical IDs and snapshots required by consumers, not unrestricted row dumps.

## 15. Roles and permissions

Suggested roles:

```text
dispatcher
driver
logistics manager
```

Permission foundation:

```text
core.delivery-order.read
core.delivery-order.create
core.delivery-order.update
core.delivery-trip.read
core.delivery-trip.create
core.delivery-trip.assign
core.delivery-trip.dispatch
core.delivery-trip.close
core.delivery-attempt.create
core.pod.attach
```

Warehouse managers do not automatically gain dispatch authority, and drivers do not automatically gain order/customer administration rights.

## 16. Acceptance gate

The Transportation/Dispatch foundation is accepted when tests prove:

- one trip contains multiple Delivery Orders;
- one Delivery Order may be delivered across multiple attempts/trips;
- vehicle/driver reassignment before dispatch is audited;
- locked/dispatched assignments cannot be edited outside approved transitions;
- partial delivery posts only approved actual quantity;
- failed delivery does not complete the order;
- returned stock reconciles to inventory ledger;
- customer return references the original delivery/order line;
- POD is linked to one delivery attempt;
- COD fact does not bypass Accounting allocation;
- MCP can read permitted status but cannot dispatch or mutate logistics tables;
- vehicle/trip is not treated as a warehouse in the initial implementation;
- source and production status are reported separately.
