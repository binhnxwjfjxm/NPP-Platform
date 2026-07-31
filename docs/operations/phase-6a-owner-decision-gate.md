# Phase 6A — Owner Decision Gate

> Status: **PROPOSED — OWNER APPROVAL REQUIRED**  
> Issue: `#116`  
> Source baseline: `main@1fc3930bdef16d076a8b103d299d7b0d7600ac6b`  
> Scope: Sales, MCP customer boundary, fulfillment, Delivery Order, Dispatch, receivable, tax, credit, lot allocation and COD policy.  
> This document does not authorize schema/API/UI mutation, production deployment or production migration.

## 1. Purpose

Phase 6B–6F and MCP M3–M5 must not infer business rules while coding.

This document consolidates the active Master Plan and the two existing Phase 6 decision documents into one owner approval gate. Decisions already locked by the active documents are marked **INHERITED**. Remaining choices are marked **PROPOSED** until the owner explicitly approves them.

Sources:

```text
NPP_PLATFORM_MASTER_PLAN.md
docs/operations/phase-6-sales-mcp-customer-boundary.md
docs/operations/phase-6-transportation-dispatch-decisions.md
docs/operations/pre-phase-6-closure-audit.md
```

## 2. Inherited decisions

### 2.1 Customer and outlet identity — INHERITED

```text
shared.customers.id         = canonical official Core customer
mcp field outlet            = independent visit/prospect/outlet identity
field outlet 0..1           -> Core customer
field outlet 0..1           -> Core customer address
Core customer 0..n          <- field outlets
```

Rules:

- only an active linked Core customer may create an official Sales Order;
- a delivery order requires a valid canonical delivery address;
- an unlinked outlet may be visited, tested, surveyed and submitted for onboarding, but may not reserve stock, create an official Sales Order, create receivable or enter Dispatch;
- linking, relinking and unlinking require permission, conflict checks and audit;
- historical field activity keeps the original field outlet identity.

### 2.2 Domain ownership — INHERITED

```text
MCP owns field operations and local/offline drafts.
Core Sales owns Sales Orders, fulfillment references and Delivery Orders.
Core Inventory owns reservations, lot allocation and inventory movements.
Core Logistics owns routes, vehicles, crew, trips, stops, assignments, attempts and POD.
Core Accounting owns receivables, payment allocation, COD allocation, refunds and write-offs.
```

MCP must call canonical Core APIs. MCP does not write Core Sales, Inventory, Logistics or Accounting tables directly.

### 2.3 Source and idempotency boundary — INHERITED + PROPOSED DETAIL

Inherited:

- retryable mutations require idempotency;
- the same key with the same canonical payload returns the same result;
- the same key with a different canonical payload returns a conflict;
- installation, actor, role and warehouse scope are server-owned.

Proposed implementation contract:

```text
source_type: MANUAL | IMPORT | API | MCP
source_id: required for IMPORT/API/MCP
source_outlet_id: required for MCP official orders
unique source reference: installation_id + source_type + source_id
```

A lost network response must never create a second onboarding request, Sales Order, Delivery Order, attempt, receivable or payment fact.

## 3. Status axes — PROPOSED

Keep independent status axes. One status must not stand in for another.

### 3.1 Order status

```text
draft
confirmed
cancelled
closed
```

An amendment creates a new immutable order version and audit history; it does not replace `confirmed` with a generic `amended` lifecycle status.

`closed` is a terminal commercial state after all remaining fulfillment, delivery and accounting obligations are resolved. It must not be set merely because one delivery attempt succeeded.

### 3.2 Fulfillment status

```text
unallocated
partially_allocated
allocated
partially_fulfilled
fulfilled
cancelled
```

### 3.3 Delivery status projection

```text
not_required
pending
ready_to_dispatch
partially_dispatched
dispatched
partially_delivered
delivered
failed
rescheduled
returned
cancelled
```

Delivery Order and delivery attempts remain authoritative; the Sales Order stores only a projection/read model.

### 3.4 Payment status projection

```text
unpaid
partially_paid
paid
overpaid
refunded
written_off
```

Receivable and payment allocation ledgers remain authoritative.

## 4. Inventory reservation, allocation and issue — PROPOSED

### 4.1 Reservation and allocation

- Sales Order confirmation creates reservation demand for the confirmed quantity.
- When backorder is disabled, confirmation fails unless the required quantity can be reserved.
- When an explicit backorder policy is enabled, confirmation may reserve zero, part or all of the quantity and must project `unallocated`, `partially_allocated` or `allocated` accurately.
- Reservation is SKU/scope based and must not oversell under concurrency.
- Lot allocation happens at pick/pack, not at initial commercial draft.
- Only allocated, picked and packed quantities may become deliverable quantities.

### 4.2 Inventory issue point

Default transition:

```text
trip dispatch / goods physically leave warehouse
-> post inventory OUT for the approved dispatched quantity
```

For customer pickup or counter handover:

```text
confirmed physical handover
-> post inventory OUT
```

Rules:

- partial dispatch posts only the partial quantity;
- a Delivery Order cannot dispatch more than its allocated/picked/packed quantity;
- inventory movement is immutable and source-linked to Delivery Order/trip/attempt;
- failed delivery never silently returns stock to warehouse;
- failed/partial delivery keeps the undelivered quantity explicitly in transit until it is reassigned, returned, damaged/lost through an approved exception, or otherwise reconciled;
- return to warehouse requires an explicit inventory IN/reversal contract.

## 5. Receivable posting — PROPOSED

Default transition:

```text
confirmed actual delivery or confirmed customer pickup
-> post receivable for the accepted quantity/value
```

Rules:

- order confirmation and trip dispatch do not by themselves create receivable;
- partial delivery posts only the accepted partial value;
- failed delivery posts no receivable for undelivered quantity;
- customer return does not reduce receivable until the approved return/credit transition posts;
- reversal/credit is append-only and references the original receivable source;
- invoice-first or legally required invoicing flows are a later explicit policy slice and must not be inferred into the Phase 6 foundation.

## 6. Tax mode and rounding — PROPOSED

### 6.1 Tax mode

Every confirmed line snapshots an explicit tax mode:

```text
EXCLUSIVE
INCLUSIVE
```

Installation/customer/channel policy may supply the default, but the resolved mode and tax rate are snapshotted on the confirmed order line. Later master-data changes do not recalculate historical orders.

### 6.2 Money precision

- all quantity and money calculations use exact decimal arithmetic;
- unit price may retain additional decimal precision required by the pricing engine;
- posted document amounts use the currency scale;
- VND uses zero decimal minor units unless an explicit future currency policy says otherwise.

### 6.3 Rounding order

Per line:

```text
raw gross = quantity × unit price
line discount = resolved discount using exact decimals
taxable base = raw gross - line discount
line tax = round(taxable base × tax rate, currency scale, HALF_UP)
line total = round(taxable base + line tax, currency scale, HALF_UP)
```

For tax-inclusive lines, the tax component is derived from the inclusive taxable amount and rounded per line. Document totals are sums of rounded line values; the system must not recalculate a different total from unrounded document-level aggregates.

## 7. Credit check and override — PROPOSED

At confirmation and any amendment that increases exposure, Core checks:

```text
current open receivable exposure
+ approved but not yet posted order exposure
+ proposed order exposure
against the active customer credit policy
```

Default behavior:

- inactive customer, blocked customer, overdue hard-block or credit-limit breach is denied;
- warning-only rules may allow confirmation but must be returned as structured warnings;
- override requires `core.sales-order.credit.override`;
- override requires a non-empty reason and records actor, limit, exposure, order amount, timestamp and request ID;
- MCP sales users may not self-approve a credit override;
- approval and override are audit/outbox facts, not hidden booleans.

## 8. Lot allocation and FEFO/FIFO — PROPOSED

Default policy:

```text
expiry-tracked SKU -> FEFO
lot-tracked without expiry -> FIFO by received/created sequence
non-lot SKU -> normal scope allocation
```

Rules:

- expired, blocked, quarantine, scrap and insufficient lots are ineligible;
- allocation may split across multiple eligible lots;
- manual lot selection requires explicit permission and reason when it deviates from policy;
- lot selection is snapshotted on allocation and inventory issue;
- concurrent allocation must lock/check the exact eligible balance facts and cannot oversell;
- no vehicle virtual warehouse is introduced in Phase 6.

## 9. Cancellation and amendment — PROPOSED

### 9.1 Draft

A draft may be edited or deleted only while it has no posted child facts. Draft deletion remains audited where required by platform policy.

### 9.2 Confirmed order

A confirmed order is not edited in place.

Changes use a versioned amendment with before/after snapshots, actor, reason and idempotency. An amendment that changes customer, address, SKU, unit, quantity, price, discount, tax or requested delivery must rerun the applicable validation, pricing, tax, credit and reservation rules.

### 9.3 Cancellation

- full cancellation is allowed only before fulfillment/issue/receivable facts make the order partially executed;
- after partial execution, only the remaining quantity may be cancelled;
- issued or delivered quantities are corrected through return/reversal/credit flows, not by rewriting or deleting the order;
- cancellation always requires a reason and emits audit/outbox events.

## 10. Dispatch boundary — PROPOSED

- a trip may be created and planned before vehicle/driver assignment;
- a trip cannot be locked or dispatched without an active vehicle and primary driver unless a separately approved manager exception policy exists;
- Delivery Order assignments are mutable before trip lock;
- reassignment after lock requires explicit permission, reason and audit;
- after dispatch, an assignment is not silently removed: use a new attempt, reschedule, return or approved exception transition;
- weight/volume capacity is advisory in the initial Phase 6E foundation; hard enforcement requires complete product/vehicle measurement data and a later owner decision;
- one trip may carry many Delivery Orders;
- one Delivery Order may have multiple historical assignments/attempts;
- partial and failed delivery never complete the Sales Order automatically.

## 11. POD and COD — PROPOSED

### 11.1 POD

- every successful delivery attempt requires at least one permitted POD fact by default;
- permitted foundation types: signature, photo, OTP or manager manual confirmation;
- manual confirmation requires permission and reason;
- POD belongs to one delivery attempt and uses the object-storage boundary;
- production upload remains blocked until R2 access and retention controls are audited.

### 11.2 COD

```text
logistics records COD collection fact
accounting posts/allocates the payment
```

Rules:

- expected COD amount comes from the authoritative receivable/order policy, not unrestricted driver input;
- driver records collected amount, method, timestamp and discrepancy reason when applicable;
- COD collection alone does not mark a receivable paid;
- paid status changes only after Accounting payment allocation;
- trip closure requires COD handover/reconciliation or an approved manager exception;
- refunds, shortages, overpayments and write-offs use Accounting transitions.

## 12. MCP mobile implications

Phase 6 does include MCP frontend adaptation, but no MCP UI mutation begins in this decision-only task.

Once the relevant Core contracts exist, MCP mobile must support:

- local/offline onboarding draft;
- submit and synchronize onboarding status;
- official order creation only for a linked active customer;
- canonical SKU/unit references and server-resolved price/tax/credit warnings;
- idempotent retry on weak networks;
- read-only order, fulfillment and delivery status;
- no Dispatch, inventory posting, receivable posting or COD allocation mutation.

MCP keeps its existing mobile-first UX, GPS/camera and correct field workflows. It is not rebuilt to resemble the Core desktop AppShell.

## 13. Required acceptance tests for later slices

At minimum, later implementation must prove:

- unlinked outlet cannot create an official Sales Order;
- inactive customer/address/SKU/unit is rejected;
- MCP retry does not duplicate onboarding or order;
- idempotency payload mismatch returns conflict;
- status axes do not overwrite one another;
- concurrent reservation/allocation cannot oversell;
- FEFO/FIFO and manual override permission work as locked;
- partial dispatch issues only approved quantity;
- failed delivery does not create receivable or complete the order;
- confirmed delivery posts the correct partial/full receivable;
- tax-inclusive/exclusive rounding is deterministic and reconciles by line;
- credit breach is denied without an authorized reasoned override;
- confirmed order changes use amendment rather than in-place mutation;
- one trip contains multiple Delivery Orders;
- one Delivery Order may have multiple attempts;
- POD links to exactly one attempt;
- COD fact does not bypass Accounting allocation;
- MCP cannot write Core tables directly.

## 14. Approval gate

Owner approval must explicitly confirm either:

```text
APPROVE AS PROPOSED
```

or list requested changes by section number.

Only after approval may this document be changed to `LOCKED`, the Phase 6A checklist be closed, and the Phase 6B Sales Order Foundation implementation issue/branch be opened.
