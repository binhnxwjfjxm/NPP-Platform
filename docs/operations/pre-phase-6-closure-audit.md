# Pre-Phase 6 Closure Audit

> Status: **ACTIVE ENTRY GATE FOR PHASE 6**  
> Audited source baseline: `main@6983844b9f6b4a63ad0fe04863f1492e360050cb`  
> Date: `2026-07-30`  
> Scope: source readiness only. This document does not claim production deployment, production migration, backup availability, restore success, R2 production readiness or provider smoke.

## 1. Purpose

Phase 6 must not start from the old assumption that Sales is one large feature containing order, warehouse issue, delivery, receivable and MCP integration in one slice.

This audit records what Phases 1–5 already provide, what remains intentionally deferred, and which decisions must be locked before the first Phase 6 mutation is implemented.

## 2. Source capabilities already present

### Phase 1 — Monorepo and shared foundation

The current repository already operates as one monorepo with separate MCP and NPP Core application boundaries, root workspaces, shared packages, database migrations and CI workflows.

Phase 1 is treated as absorbed into the current repository baseline rather than reopened as a new implementation phase.

### Phase 2 — Core foundation

Available on `main`:

- Core API and Core web skeleton;
- PostgreSQL pool and migration runner;
- request context and server-owned installation scope;
- authentication and deny-by-default authorization;
- idempotency store;
- audit/outbox transaction boundary;
- sanitized API error envelope;
- same-origin web gateway pattern;
- R2 adapter contract and foundation verification;
- browser E2E and migration rehearsal workflows.

Production R2 configuration and production backup/restore remain provider operations and are not inferred from source completion.

### Phase 3 — Shared master data and access foundation

Available on `main`:

- branches, warehouses and warehouse locations;
- employees, roles, permissions, users and role assignments;
- canonical `shared.customers` and `shared.customer_addresses`;
- suppliers, supplier contacts and addresses;
- products, categories, brands, variants/SKU;
- units, conversions and barcodes;
- price lists and price-resolution foundation;
- concurrency-safe document numbering;
- installation scope, optimistic concurrency, idempotency and audit for master-data mutations.

Important Phase 6 consequence:

- `shared.customers.id` is the canonical Core customer ID;
- customer route assignment was intentionally excluded from the Core customer slice;
- MCP field outlets therefore require a separate link contract rather than being silently treated as Core customers.

### Phase 4 — Inventory foundation

Available on `main`:

- immutable inventory ledger and reversal;
- rebuildable balance read model and reconciliation;
- reservations and negative-stock guards;
- lot/expiry foundation;
- opening-balance import through ledger posting;
- warehouse-scoped inventory reads and movement drill-down;
- exact decimal quantity handling;
- integration hooks used by Purchasing.

Not yet automatically decided for Sales:

- when Sales inventory issue occurs;
- whether allocation selects lots automatically or requires explicit lot selection;
- FEFO/FIFO policy for picking;
- costing method and COGS posting;
- vehicle-as-virtual-location behavior.

These are Phase 6/7 business decisions, not defects in the Phase 4 foundation.

### Phase 5 — Purchasing and payable

Available on `main`:

- Purchase Order lifecycle and document numbering;
- scalable PO SKU search and bulk line entry;
- partial Goods Receipt;
- quantity and quality variance;
- inventory receipt posting and reversal;
- supplier return and inventory issue;
- payable document and immutable payable ledger posting;
- supplier payment, allocation and reversal;
- exact financial calculations, installation/warehouse scope, idempotency, audit and browser E2E.

Explicitly deferred from Phase 5:

- bank reconciliation;
- cashbook/general ledger;
- payment approval workflow;
- FX and cross-currency allocation;
- production rollout evidence for the latest source migrations.

These deferrals do not block Phase 6 source design unless a Sales slice depends directly on them.

## 3. Required additions before Phase 6 mutation code

### 3.1 Customer and MCP identity boundary

Lock all of the following:

- MCP field outlet has its own identity;
- `core_customer_id` is nullable until Core approval/link;
- canonical delivery address linking is explicit;
- unlinked outlets cannot create official Sales Orders;
- legacy MCP `route_customer` rows are audited and mapped, not blindly migrated into `shared.customers`;
- legacy MCP `orders/order_items` are classified as order intents, historical requests or migratable official orders before import.

### 3.2 Sales posting decisions

Owner approval is required for:

- inventory issue at dispatch, at confirmed delivery, or another locked transition;
- receivable posting at confirmation/invoice, dispatch, or confirmed delivery;
- tax-inclusive versus tax-exclusive pricing;
- rounding rules for quantity, price, discount, tax and totals;
- approved Sales discount modes;
- cancellation and amendment after reservation/pick/dispatch;
- credit-limit override and approval behavior;
- return/refund and exchange references.

### 3.3 Fulfillment and lot allocation

Before pick/pack mutation:

- define reservation-to-allocation transition;
- define lot/expiry eligibility;
- decide manual lot selection versus policy-driven selection;
- define partial allocation and backorder behavior;
- ensure delivery issue and customer-return receipt use internal inventory posting contracts rather than a generic public inventory mutation endpoint.

### 3.4 Transportation boundary

Before adding a delivery status to Sales Order:

- introduce Delivery Order as a separate document;
- separate delivery route from MCP field route;
- separate delivery trip/vehicle/driver assignment from Sales Order;
- allow one order to be delivered through multiple attempts/trips;
- allow one trip to contain multiple delivery orders;
- define failed, partial, returned-to-warehouse and rescheduled transitions;
- keep vehicle/trip out of warehouse master in the initial foundation.

### 3.5 MCP adaptation readiness

Before MCP writes into Core:

- audit current MCP identity/employee mapping;
- preserve working MCP UI and route/session/test/report flows;
- move writes behind MCP backend-owned APIs;
- add customer onboarding and linked-customer read models;
- add idempotent Sales Order request adapter;
- add offline/retry behavior without duplicate Core mutations;
- keep Supabase/VPS replacement in the dedicated migration/cutover track.

### 3.6 Production separation

Source work may continue after this planning gate, but production rollout remains separately blocked until the relevant operation has:

- exact migration manifest;
- confirmed backup;
- restore rehearsal;
- pre/post reconciliation;
- provider environment audit;
- deployment and smoke evidence.

No source document may claim those provider facts without a fresh audit.

## 4. Entry decision

Phases 1–5 do not require a new implementation pass before Phase 6.

The required work is:

1. update the active Master Plan and handoff;
2. lock Sales/MCP customer boundary decisions;
3. lock Transportation/Dispatch ownership;
4. split Phase 6 into vertical slices;
5. begin with a documentation-only Phase 6A contract before schema or mutation code.

## 5. Phase 6 entry gate

Phase 6A may start when:

- this audit is linked from the active Master Plan;
- the Sales/MCP customer-boundary decision document is active;
- the Transportation/Dispatch decision document is active;
- no implementation assumes every MCP outlet is already a Core customer;
- no implementation places vehicle/driver/trip fields directly on Sales Order as the source of truth;
- source and production status are reported separately.
