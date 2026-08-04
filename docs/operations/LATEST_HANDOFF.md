# NPP Platform — Latest Handoff

## Current source checkpoint

- Repository: `binhnxwjfjxm/NPP-Platform`.
- Production branch: `main`.
- Exact audited baseline `main`: `2cfb48710ebd048bafc6e0014eefc2fc5bedef89`.
- PR #228 restored daily Sales Admin work to NPP Operations and limited Admin to aggregate/exception work.
- PR #229 corrected Admin production smoke to use the canonical domain.
- Source merge does not prove backend deployment, database migration, backup, reconciliation or provider state. Audit every production operation again.

## Verified frontend production checkpoint

### NPP Operations

- Vercel project: `npp-platform`.
- Deployed source: `eff58bb4d318379e13c3925d2362244b627c7665`.
- Deployment and real route/API smoke passed.
- `npp-platform.vercel.app` remains the working fallback URL.
- `office.nguyenlieuhungphat.com` was not attached at the last audit and must not be assumed present.

### Admin MCP/NPP

- Vercel project: `admin-mcp-npp`.
- Deployed source: `2cfb48710ebd048bafc6e0014eefc2fc5bedef89`.
- Canonical domain `admin.nguyenlieuhungphat.com` passed unauthenticated/authenticated production smoke.
- Admin shows aggregate information and the management-exception boundary; daily customer-code and order confirmation work stays in NPP Operations.

No Core backend, MCP backend or production database migration was performed during those frontend rollouts.

## Active work

```text
Issue #230 — Phase 6D — Fulfillment, reservation and Delivery Order
Draft PR #231 — Phase 6D.1 warehouse reservation demand
Branch agent/phase-6d1-reservation-demand
Baseline main@2cfb48710ebd048bafc6e0014eefc2fc5bedef89
Migration 042_sales_fulfillment_reservation_demand
```

## Phase 6D.1 product behavior

```text
confirmed Sales Order
-> resolve each line to its inventory-base SKU snapshot
-> lock warehouse + base-SKU availability
-> reserve the available quantity at warehouse level
-> record the remaining quantity as backorder when allowed
-> expose reserved/backordered totals and per-line projection
```

Locked rules:

- Warehouse demand is separate from exact location/lot allocation.
- `allow_backorder=true` preserves current confirmation behavior while making shortages visible.
- `allow_backorder=false` makes insufficient stock fail the complete confirmation transaction.
- Sales demand, exact Inventory reservations and Inventory OUT share a concurrency lock and database backstops.
- Amendment supersedes the old active demand in the same transaction.
- Cancellation releases active demand when no downstream execution fact blocks cancellation.
- Fulfillment progress is monotonic; allocation/pick/pack/issue cannot move backwards.
- Sales Order content revision is separate from fulfillment projection status.

## Phase 6D sequence

```text
6D.1 warehouse reservation demand and fulfillment projection ACTIVE — PR #231
6D.2 exact location/lot allocation, FEFO/FIFO, pick and pack  NOT STARTED
6D.3 Delivery Order foundation to ready_to_dispatch          NOT STARTED
6D.4 Inventory issue/reversal and return lineage             NOT STARTED
```

Phase 6E, not Phase 6D, owns vehicles, drivers, trips, stops, delivery attempts and POD.

## Production boundary

Issue #230 and PR #231 authorize source work only.

They do not authorize:

```text
production migration 042
Core backend production deploy
NPP frontend production redeploy
MCP changes or deploy
provider, DNS or credential changes
Phase 6E transportation execution
merge to main without an explicit owner command
```

> Updated: `2026-08-04`
> Current checkpoint: Phase 6D.1 source implementation and exact-head CI on Draft PR #231.
