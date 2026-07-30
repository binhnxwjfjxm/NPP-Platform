# NPP Platform — Latest Handoff

## Current source checkpoint

- Repository: `binhnxwjfjxm/NPP-Platform`.
- Production branch: `main`.
- Audited source baseline before this planning branch: `6983844b9f6b4a63ad0fe04863f1492e360050cb`.
- PR #101 standardized Purchase Order line entry and merged as `dc5dc2dfff5c93d3ccd5bf11c784ce0f2df0255c`.
- PR #102 standardized dependency-aware deactivate conflicts and merged as `6983844b9f6b4a63ad0fe04863f1492e360050cb`.
- Phase 5 Purchasing/Payable source work is closed through supplier payment/allocation, with later PO UX/contract hardening on `main`.
- The next source gate is Phase 6A Sales, MCP customer boundary and Transportation/Dispatch contract locking.

## Active planning branch

```text
agent/phase-6-master-plan-integration
```

The branch updates:

```text
NPP_PLATFORM_MASTER_PLAN.md
docs/operations/pre-phase-6-closure-audit.md
docs/operations/phase-6-sales-mcp-customer-boundary.md
docs/operations/phase-6-transportation-dispatch-decisions.md
docs/operations/LATEST_HANDOFF.md
```

This is a documentation-only planning change. It does not include schema, API, UI, provider or production mutations.

## Locked planning conclusions

### MCP strategy

MCP Field is an existing field-sales application to adapt and integrate, not rebuild from zero.

Preserve working route/session/visit/test/report/order-display flows. Remaining work focuses on:

- legacy data and identity audit;
- backend-owned MCP writes;
- session outlet snapshots;
- customer onboarding and Core customer/address linking;
- idempotent Core Sales Order adapter;
- read-only order/fulfillment/delivery sync;
- Supabase/VPS adapter replacement and cutover after reconciliation.

### Customer boundary

- `shared.customers.id` is the canonical Core customer ID.
- MCP field outlet has a separate identity.
- A field outlet may have nullable Core customer/address links.
- Only a linked active Core customer may create an official Sales Order.
- Core owns the onboarding review lifecycle after submission.

### Transportation boundary

- Transportation/Dispatch belongs to NPP Core, not MCP.
- Add target schema `logistics`.
- Sales Order, Delivery Order and Delivery Trip are separate sources of truth.
- Vehicle/driver/trip do not belong directly on Sales Order as transportation truth.
- Vehicle/trip is not a warehouse/location in the initial foundation.

## Phases 1–5 closure audit

Source foundations already available on `main`:

```text
Phase 1  monorepo/shared foundation absorbed into current baseline
Phase 2  Core API/web, auth, idempotency, audit/outbox, migration and browser foundation
Phase 3  organization/access/customer/supplier/product/unit/pricing/numbering
Phase 4  inventory ledger/balance/reservation/negative-stock/lot-opening foundation
Phase 5  PO/receipt/variance/return/payable/payment-allocation
```

No new implementation pass is required before Phase 6.

Required pre-Phase-6 work is decision locking, not rebuilding:

- customer/outlet/address identity;
- MCP legacy mapping and order classification;
- inventory issue point;
- receivable posting point;
- VAT/rounding/discount rules;
- lot allocation/FEFO policy;
- costing dependency;
- Delivery Order and Dispatch transitions;
- failed-delivery stock treatment;
- COD/POD policy.

## Phase 6 roadmap

```text
6A  Sales and MCP boundary contract — decision-only
6B  Sales Order Foundation
6C  Customer Onboarding Bridge
6D  Fulfillment and Delivery Order
6E  Transportation/Dispatch
6F  Receivable, Returns, Payment and COD
```

MCP adaptation runs in parallel but cannot create official orders before customer linking and idempotency contracts exist.

## Entry gate before Phase 6 mutation

Before opening the Sales Order implementation branch:

1. merge the planning documents;
2. owner approves the unresolved Phase 6A business decisions;
3. re-audit fresh `main`, PRs, CI, migration registry and this handoff;
4. create a new `agent/<task>` branch from exact `main`;
5. keep source work and production rollout reporting separate.

## Production separation

No production deployment, production migration, backup, restore, R2 configuration or provider smoke is claimed by this planning branch.

Vercel Auto Deploy and Heroku Automatic Deploy remain intended to stay off. Production rollout requires a separate explicit operation with fresh provider, backup, restore-rehearsal, migration and smoke evidence.

> Updated: `2026-07-30`  
> Current checkpoint: Phase 6A planning and owner decision gate.
