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

`closed` is a terminal commercial state after all remaining fulfillment, delivery and customer-settlement obligations are resolved. A full successful COD delivery may close the order when the customer has received the goods and the full authoritative amount has been collected and allocated. Internal driver cash handover remains a separate operational/accounting process and does not reopen customer debt.

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

### 3.4 Payment mode and settlement projections — OWNER DIRECTION INCORPORATED

Every confirmed order snapshots one payment mode:

```text
PREPAID
COD
CREDIT
```

`COD` is the normal/default commercial flow unless customer or order policy explicitly selects another permitted mode.

Customer settlement status:

```text
unpaid
partially_paid
paid
overpaid
refunded
written_off
```

COD handover/reconciliation status is a separate internal axis:

```text
not_applicable
pending_collection
collected
handed_over
reconciled
discrepancy
```

Rules:

- only `CREDIT` creates an intentionally outstanding customer debt after successful delivery;
- `COD` with full collection settles the customer at delivery and must not appear as customer debt;
- `PREPAID` uses an existing payment/credit allocation against the delivered amount;
- money held by a driver but not yet handed to the company is an internal cash-in-transit/reconciliation fact, not customer receivable;
- receivable, payment allocation and COD reconciliation ledgers remain authoritative for their own axes.

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

## 5. Sale settlement and receivable posting — OWNER DIRECTION INCORPORATED

Default delivery transition:

```text
confirmed actual delivery or confirmed customer pickup
-> post the accepted delivered value
-> settle according to PREPAID, COD or CREDIT
```

### 5.1 COD — default operational flow

```text
driver carries approved goods
-> customer accepts the delivered quantity
-> driver collects the full authoritative amount
-> record POD + COD collection
-> post and allocate payment idempotently
-> customer outstanding balance = 0
-> delivery/customer settlement complete
```

The accounting implementation may create a receivable fact and settle it immediately in the same idempotent workflow so the ledger remains complete. It must never expose that zero-duration accounting step as an outstanding customer debt.

If the driver has collected the money but has not yet handed it to the company:

- the customer remains `paid`;
- the order may remain commercially complete;
- the driver/trip has a separate pending cash-handover/reconciliation obligation;
- a handover discrepancy is handled internally and must not automatically recreate customer debt.

### 5.2 PREPAID

- an existing authorized payment or customer credit is allocated to the accepted delivered value;
- any excess remains an overpayment/customer credit according to Accounting policy;
- successful delivery with sufficient allocation leaves no customer debt.

### 5.3 CREDIT

- only an explicitly approved credit order posts an outstanding receivable after delivery;
- payment terms, due date and credit approval are snapshotted;
- this is the flow that contributes to customer aging and open debt.

### 5.4 Shared rules

- order confirmation and trip dispatch do not by themselves create customer debt;
- partial delivery posts and settles only the accepted partial value;
- failed delivery posts no sale/receivable/payment for undelivered quantity;
- COD short collection cannot be treated as fully paid unless an authorized discrepancy/credit exception is approved;
- customer return does not reduce the settled value or receivable until the approved return/credit transition posts;
- reversal/credit is append-only and references the original source;
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

## 7. Credit check and override — OWNER DIRECTION INCORPORATED + PROPOSED DETAIL

Credit exposure checks apply when:

- payment mode is `CREDIT`;
- an amendment increases an existing credit exposure;
- an order changes from `PREPAID` or `COD` to `CREDIT`;
- a COD shortage is intentionally converted into an approved customer credit balance.

Core checks:

```text
current open receivable exposure
+ approved but not yet posted credit-order exposure
+ proposed credit exposure
against the active customer credit policy
```

Default behavior:

- inactive or blocked customer is denied for every payment mode;
- normal `COD` and fully covered `PREPAID` orders do not consume customer credit limit;
- overdue hard-block or credit-limit breach denies `CREDIT` confirmation;
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

Changes use a versioned amendment with before/after snapshots, actor, reason and idempotency. An amendment that changes customer, address, SKU, unit, quantity, price, discount, tax, payment mode or requested delivery must rerun the applicable validation, pricing, tax, credit, settlement and reservation rules.

### 9.3 Cancellation

- full cancellation is allowed only before fulfillment/issue/settlement/receivable facts make the order partially executed;
- after partial execution, only the remaining quantity may be cancelled;
- issued, delivered or settled quantities are corrected through return/reversal/refund/credit flows, not by rewriting or deleting the order;
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
- partial and failed delivery never complete the Sales Order automatically;
- full successful delivery with full COD collection may complete the customer order even while the trip still has an internal cash-handover obligation.

## 11. POD and COD — OWNER DIRECTION INCORPORATED + PROPOSED DETAIL

### 11.1 POD

- every successful delivery attempt requires at least one permitted POD fact by default;
- permitted foundation types: signature, photo, OTP or manager manual confirmation;
- manual confirmation requires permission and reason;
- POD belongs to one delivery attempt and uses the object-storage boundary;
- production upload remains blocked until R2 access and retention controls are audited.

### 11.2 COD

```text
logistics records delivery, POD and COD collection fact
accounting posts and allocates the payment in the same idempotent completion workflow
internal cash handover/reconciliation continues on a separate axis
```

Rules:

- expected COD amount comes from the authoritative delivered value, not unrestricted driver input;
- driver records collected amount, method, timestamp and discrepancy reason when applicable;
- full authoritative collection plus successful payment allocation changes customer settlement to `paid` immediately;
- full COD delivery may close the customer order without waiting for driver cash handover;
- trip/cash closure still requires handover and reconciliation or an approved manager exception;
- a pending handover is cash-in-transit/internal accountability, not customer debt;
- shortages, overpayments, refunds and write-offs use explicit Accounting transitions;
- a shortage is not silently marked paid and does not become customer credit without authorized approval.

## 12. MCP mobile implications

Phase 6 does include MCP frontend adaptation, but no MCP UI mutation begins in this decision-only task.

Once the relevant Core contracts exist, MCP mobile must support:

- local/offline onboarding draft;
- submit and synchronize onboarding status;
- official order creation only for a linked active customer;
- default COD order entry, with PREPAID/CREDIT only when policy permits;
- canonical SKU/unit references and server-resolved price/tax/credit warnings;
- idempotent retry on weak networks;
- read-only order, fulfillment, delivery and customer-settlement status;
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
- failed delivery creates no sale settlement for undelivered quantity and does not complete the order;
- full COD delivery plus full collection leaves customer debt at zero and completes customer settlement;
- pending driver cash handover does not reopen customer debt;
- COD shortage cannot be marked paid without an authorized exception;
- PREPAID delivery allocates existing payment/credit correctly;
- only approved CREDIT delivery creates an outstanding receivable and aging balance;
- tax-inclusive/exclusive rounding is deterministic and reconciles by line;
- credit breach is denied without an authorized reasoned override;
- confirmed order changes use amendment rather than in-place mutation;
- one trip contains multiple Delivery Orders;
- one Delivery Order may have multiple attempts;
- POD links to exactly one attempt;
- COD fact and customer settlement do not bypass Accounting allocation;
- MCP cannot write Core tables directly.

## 14. Approval gate

Owner approval must explicitly confirm either:

```text
APPROVE AS PROPOSED
```

or list requested changes by section number.

Only after approval may this document be changed to `LOCKED`, the Phase 6A checklist be closed, and the Phase 6B Sales Order Foundation implementation issue/branch be opened.
