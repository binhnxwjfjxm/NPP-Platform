# Phase 6A — Owner Decision Gate

> Status: **PROPOSED — OWNER APPROVAL REQUIRED**  
> Issue: `#116`  
> Source baseline: `main@1fc3930bdef16d076a8b103d299d7b0d7600ac6b`  
> Scope: Sales, MCP customer boundary, fulfillment, delivery, settlement, Dispatch, tax, credit, lot allocation and COD policy.  
> This document does not authorize schema/API/UI mutation, production deployment or production migration.

## 1. Purpose

Phase 6B–6F and MCP M3–M5 must not infer business rules while coding.

This document consolidates the active Master Plan and existing Phase 6 decision documents into one owner-approval gate. Decisions inherited from those documents are marked **INHERITED**. Business directions explicitly provided by the owner are marked **OWNER DIRECTION INCORPORATED**. Remaining implementation details stay **PROPOSED** until final owner approval.

Sources:

```text
NPP_PLATFORM_MASTER_PLAN.md
docs/operations/phase-6-sales-mcp-customer-boundary.md
docs/operations/phase-6-transportation-dispatch-decisions.md
docs/operations/pre-phase-6-closure-audit.md
```

## 2. Customer, outlet and ownership boundaries — INHERITED

```text
shared.customers.id         = canonical official Core customer
mcp field outlet            = independent visit/prospect/outlet identity
field outlet 0..1           -> Core customer
field outlet 0..1           -> Core customer address
Core customer 0..n          <- field outlets
```

Rules:

- only an active linked Core customer may create an official Sales Order;
- a delivery requires a valid canonical delivery address or an approved pickup location;
- an unlinked outlet may be visited, tested, surveyed and submitted for onboarding, but may not create an official Sales Order;
- historical field activity keeps the original field-outlet identity;
- MCP calls canonical Core APIs and never writes Core Sales, Inventory, Logistics or Accounting tables directly.

Domain ownership:

```text
MCP                field operations, visits and local/offline drafts
Core Sales         Sales Orders, amendments and delivery requirements
Core Inventory     reservation, allocation, lots and inventory movements
Core Logistics     vehicles, trips, stops, attempts and POD
Core Accounting    receivables, payments, allocation, cash handover and reconciliation
```

## 3. Source and idempotency — INHERITED + PROPOSED DETAIL

```text
source_type: MANUAL | IMPORT | API | MCP
source_id: required for IMPORT/API/MCP
source_outlet_id: required for MCP official orders
unique source reference: installation_id + source_type + source_id
```

Rules:

- retrying the same key with the same canonical payload returns the same result;
- the same key with a different payload returns a conflict;
- a lost network response must never create a duplicate onboarding request, Sales Order, delivery, payment or accounting fact;
- installation, actor, role and warehouse scope are server-owned.

## 4. Independent status axes — OWNER DIRECTION INCORPORATED

Delivery and payment are separate. The software must never force the driver to take accepted goods back merely because payment is not available at the exact delivery moment.

### 4.1 Order lifecycle

```text
draft
confirmed
cancelled
closed
```

An amendment creates a new immutable order version and audit history. It does not rewrite the confirmed document in place.

### 4.2 Fulfillment projection

```text
unallocated
partially_allocated
allocated
partially_fulfilled
fulfilled
cancelled
```

### 4.3 Delivery projection

```text
not_required
pending
ready_to_dispatch
dispatched
partially_delivered
delivered
failed
rescheduled
returned
cancelled
```

### 4.4 Customer settlement projection

```text
not_due
pending
partially_paid
paid
overpaid
refunded
written_off
```

### 4.5 Internal cash-handover projection

```text
not_applicable
pending_collection
collected_by_driver
handed_over
reconciled
discrepancy
```

One axis must not overwrite another. Examples:

```text
Đã giao — đã thanh toán
Đã giao — chờ chuyển khoản
Đã giao — tài xế đã thu, chờ nộp tiền
Giao một phần — chờ xử lý phần còn lại
```

## 5. Delivery acceptance — OWNER DIRECTION INCORPORATED

A delivery may be completed when an authorized recipient at the customer location accepts the goods, even when the owner is absent or busy.

Authorized recipient examples:

```text
customer owner
store manager
cashier
warehouse/store employee
person previously authorized by customer
```

Required delivery facts:

- actual delivered quantities;
- receiver name and role or relationship;
- delivery time;
- POD according to policy: signature, photo, OTP or permitted manual confirmation;
- discrepancy, shortage, refusal or damage notes when applicable;
- GPS only where permitted and available; GPS failure alone must not block an otherwise valid delivery.

Rules:

- successful goods acceptance changes delivery status to `delivered` or `partially_delivered`;
- the driver may continue the route immediately;
- payment availability does not decide whether the goods were delivered;
- payment pending does not automatically cancel delivery or require return of accepted goods;
- the UI must show `Đã giao — chờ thanh toán`, not falsely show the delivery as failed.

## 6. Payment and collection policy — OWNER DIRECTION INCORPORATED

Every confirmed order snapshots a collection policy:

```text
PREPAID
COLLECT_ON_DELIVERY
COLLECT_AFTER_DELIVERY
CREDIT_TERMS
```

### 6.1 PREPAID

Payment or approved customer credit already exists before delivery and is allocated against the delivered value.

### 6.2 COLLECT_ON_DELIVERY

This is the normal/default operational policy. The driver attempts to collect cash or confirmed transfer when handing over goods.

If full payment is collected:

```text
customer accepts goods
-> record POD
-> record payment collection
-> allocate payment idempotently
-> settlement = paid
-> customer balance for this delivery = 0
```

If payment cannot be made immediately because the owner is absent, busy, or will transfer later, delivery is still allowed under Section 6.3.

### 6.3 COLLECT_AFTER_DELIVERY

This supports common real-world cases:

```text
employee receives goods; owner transfers later
owner is busy; promises transfer after checking delivery
customer uses bank transfer after the driver leaves
```

At delivery, record:

- payment method expected;
- promised payer/contact;
- promised payment time or due time;
- outstanding amount;
- reason payment was not collected immediately;
- optional customer confirmation/evidence.

Behavior:

- delivery status becomes `delivered` or `partially_delivered`;
- settlement status becomes `pending` or `partially_paid`;
- the driver continues the route;
- no automatic return, cancellation or failed-delivery status;
- receiving the later transfer settles the amount idempotently;
- overdue follow-up is a collection workflow, not a reason to rewrite delivery history;
- the system may require manager approval only when customer policy, amount threshold, overdue history or risk rule requires it;
- ordinary trusted customers must not be blocked by a rigid immediate-payment rule.

### 6.4 CREDIT_TERMS

This is formal approved credit with snapshotted payment terms, due date, credit policy and approval. It contributes to customer aging and credit exposure.

`COLLECT_AFTER_DELIVERY` is operational deferred collection and must not automatically be treated as a long-term credit sale. If it remains unpaid beyond its approved grace/due rule, Accounting may classify or escalate it according to policy without changing the delivery fact.

### 6.5 Driver cash handover

When the driver has collected money but not yet handed it to the company:

- the customer remains `paid`;
- delivery remains complete;
- the driver/trip has an internal cash-in-transit obligation;
- a handover discrepancy is handled internally and must not recreate customer debt automatically.

## 7. Inventory reservation, allocation and issue — PROPOSED

- Sales Order confirmation creates reservation demand for the confirmed quantity;
- when backorder is disabled, confirmation fails unless required quantity can be reserved;
- when backorder is enabled, confirmation may reserve zero, part or all and must show the correct projection;
- reservation and allocation must not oversell under concurrency;
- lot allocation occurs at pick/pack, not at commercial draft;
- only allocated, picked and packed quantities become deliverable.

Inventory issue point:

```text
trip dispatch / goods physically leave warehouse
-> post inventory OUT for approved dispatched quantity
```

For pickup or counter handover:

```text
confirmed physical handover
-> post inventory OUT
```

Failed delivery never silently returns stock. Reassignment, return, loss or damage requires explicit inventory facts.

## 8. Sale value, receivable and settlement posting — OWNER DIRECTION INCORPORATED

```text
confirmed actual delivery or pickup
-> post accepted delivered value
-> settle according to collection policy
```

Rules:

- order confirmation and trip dispatch do not by themselves create a completed sale settlement;
- partial delivery posts only the accepted partial value;
- failed delivery posts no sale value for undelivered quantity;
- `PREPAID` and fully collected delivery leave no customer balance;
- `COLLECT_AFTER_DELIVERY` records a pending customer settlement without blocking delivery;
- only formal `CREDIT_TERMS` is treated as approved credit exposure from the start;
- return, refund and credit adjustment are append-only and reference the original facts;
- payment retry must not duplicate receipts or allocations.

## 9. Tax and rounding — PROPOSED

Every confirmed line snapshots:

```text
tax_mode: EXCLUSIVE | INCLUSIVE
tax_rate
unit_price
discount basis
currency and currency scale
```

Rules:

- exact decimal arithmetic only;
- VND posted amounts use zero minor decimals unless a later currency policy says otherwise;
- tax is rounded per line using `HALF_UP`;
- document totals are sums of rounded line values;
- later master-data changes do not recalculate confirmed historical orders.

## 10. Credit and collection risk — OWNER DIRECTION INCORPORATED + PROPOSED DETAIL

Credit-limit checks apply to:

- `CREDIT_TERMS` orders;
- amendments increasing approved credit exposure;
- conversion of unpaid operational collection into approved formal credit;
- policy-defined risky `COLLECT_AFTER_DELIVERY` cases.

Normal COD, prepaid and trusted short collection-after-delivery flows do not automatically consume the formal credit limit.

Risk controls may consider:

- customer active/blocked status;
- overdue history;
- promised-payment breaches;
- amount threshold;
- customer-specific collection policy;
- permitted employee/manager approval.

Overrides require permission, reason, actor, request ID and audit/outbox records. MCP sales users may not self-approve credit overrides.

## 11. Lot policy — PROPOSED

```text
expiry-tracked SKU       -> FEFO
lot-tracked without expiry -> FIFO by received sequence
non-lot SKU              -> normal scope allocation
```

Expired, blocked, quarantine, scrap and insufficient lots are ineligible. Manual deviation requires permission and reason. Concurrent allocation must not oversell.

## 12. Cancellation and amendment — PROPOSED

- drafts may be edited before posted child facts exist;
- confirmed orders are amended through immutable versions;
- full cancellation is allowed only before partial execution makes it impossible;
- after partial execution, only remaining quantity may be cancelled;
- delivered or settled quantities are corrected through return, reversal, refund or credit flows;
- cancellation and amendment always require reason, audit and outbox.

## 13. Dispatch, POD and COD boundaries — OWNER DIRECTION INCORPORATED

- one trip may carry many deliveries;
- one delivery may have multiple historical attempts;
- vehicle/driver assignment is required before dispatch unless an approved exception exists;
- assignments are editable before lock and controlled after lock;
- partial or failed delivery never completes undelivered quantity;
- authorized recipient acceptance is valid POD according to policy;
- payment pending does not make a successful delivery fail;
- full payment collection settles the customer immediately;
- driver cash handover and reconciliation remain separate from customer settlement;
- POD and payment facts are idempotent and independently auditable.

## 14. MCP mobile implications

MCP mobile must eventually support:

- local/offline onboarding draft;
- submit and synchronize onboarding status;
- official order only for linked active customers;
- mobile-first order entry;
- collection-policy selection according to customer permission;
- `Đã giao — chờ thanh toán` display;
- promised transfer details and follow-up status;
- weak-network idempotent retry;
- read-only fulfillment, delivery and settlement status;
- no direct Core table writes.

MCP keeps its existing mobile-first UX, GPS/camera and correct field workflows. It is not rebuilt as a small Core desktop screen.

## 15. Required acceptance tests for later slices

Later implementation must prove at minimum:

- unlinked outlet cannot create an official Sales Order;
- MCP retry does not duplicate onboarding, order, delivery or payment;
- delivery and settlement statuses do not overwrite each other;
- an authorized employee may receive goods while the owner is absent;
- accepted goods may be marked delivered while payment remains pending;
- the driver can continue the route without returning accepted goods;
- promised transfer later settles the correct delivery exactly once;
- payment pending does not produce a failed-delivery status;
- driver-collected cash pending handover does not recreate customer debt;
- only approved formal credit creates planned credit exposure;
- concurrent reservation/allocation cannot oversell;
- partial dispatch issues only approved quantity;
- failed delivery does not post delivered value for undelivered quantity;
- FEFO/FIFO and manual-lot override work as locked;
- tax-inclusive/exclusive rounding is deterministic;
- confirmed orders use amendment rather than in-place mutation;
- MCP cannot directly mutate Core tables.

## 16. Approval gate

Owner approval must explicitly confirm either:

```text
APPROVE AS PROPOSED
```

or list requested changes by section number.

Only after approval may this document be changed to `LOCKED`, Issue #116 be closed and Phase 6B implementation begin.
