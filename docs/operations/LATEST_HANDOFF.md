# NPP Platform — Latest Handoff

## Current source checkpoint

- Repository: `binhnxwjfjxm/NPP-Platform`.
- Production branch: `main`.
- Exact audited baseline `main`: `057fdedf9bc8c586e0dc831c1a43e09067212d4e`.
- Active branch: `agent/phase-6d2-allocation-pick-pack`.
- Issue: `#235 — Phase 6D.2 — Phân bổ vị trí/lô, soạn và đóng gói`.
- Draft PR: `#236 — feat(sales): phân bổ vị trí lô, soạn và đóng gói 6D.2`.
- Exact implementation checkpoint before this handoff-only commit: `249a5208cae986ec3af097a401fd970af829ca71`.
- Source merge does not prove backend deployment, database migration, backup, reconciliation or provider state. Audit every production operation again.

## Verified production checkpoint

The latest verified NPP frontend production source remains the navigation correction merged at:

```text
057fdedf9bc8c586e0dc831c1a43e09067212d4e
```

No Phase 6D.1 or Phase 6D.2 backend deployment, production migration or provider mutation was performed during this source task.

Do not assume production has migrations `042` or `043`, reservation demand, exact allocation, pick or pack until a separate production rollout is explicitly authorized and audited.

## Phase 6D.2 product behavior

```text
confirmed Sales Order
-> Phase 6D.1 reserves available quantity at warehouse level
-> Phase 6D.2 proposes exact storage location/lot
-> create exact Inventory reservation in the same transaction
-> warehouse confirms picked quantity
-> warehouse confirms packed quantity
-> packed quantity becomes input for Phase 6D.3 Delivery Order
```

A normal Sales Order does not require two different people by default. One user may create and confirm the order when their role has both permissions. Price, discount, credit or other exceptions remain subject to their separate approval permissions and policies.

## Locked allocation rules

- Warehouse execution lives in NPP Operations under `Tồn kho & lô hàng -> Chuẩn bị hàng`.
- It is not a global shortcut and is not daily CRUD in Admin or Delivery.
- Allocation is scoped by installation, warehouse, active storage location, inventory-base SKU and lot.
- Only active `storage` locations are eligible; receiving, shipping, quarantine, returns, damaged and other locations are rejected.
- Lots with an expiry date use FEFO.
- Lots without an expiry date use FIFO based on traceable first receipt time.
- `expiry_tracking_mode = REQUIRED` requires an expiry date.
- `expiry_tracking_mode = OPTIONAL` allows dated FEFO lots and undated FIFO lots.
- Expired lots are always rejected.
- Manual policy override requires `core.fulfillment.override-allocation-policy` and a reason, but cannot bypass scope, storage, expiry or available-stock checks.
- Exact Inventory reservation and Sales allocation share transaction, lineage, idempotency, audit and outbox.
- Pick cannot exceed allocated quantity.
- Pack cannot exceed picked quantity.
- Allocation, pick and pack progress is monotonic.
- Backordered quantity prevents a partial execution from projecting a false full-completion state.

## Migration and source structure

Phase 6D.2 uses one consolidated migration:

```text
database/migrations/sales/043_sales_fulfillment_allocation_pick_pack.sql
```

Intermediate migration drafts were folded into `043` before merge. There is no patch chain `044/045` for this slice.

Source includes:

```text
Sales fulfillment allocation repository/service/routes
Inventory route integration
warehouse-scoped permissions
NPP fulfillment queue and workspace
PostgreSQL integration coverage
Browser E2E coverage
```

The automatic FEFO/FIFO flow is available in the NPP warehouse UI. Backend manual override is permissioned and reason-required; a dedicated permission-aware manual allocation UI is not claimed complete in this slice.

## Exact-head gate evidence

The implementation checkpoint `249a5208cae986ec3af097a401fd970af829ca71` passed:

```text
Foundation F0.2
Phase 3 Split Validation including grouped migration rehearsal
Phase 4 Inventory Ledger
Phase 4 Inventory Balance
Phase 4.3 Inventory Reservations
Phase 6B.2 Sales Commercial Controls
Core Foundation including PostgreSQL fulfillment integration
Core UI build and Browser E2E
Admin Frontend boundary CI
```

The PostgreSQL integration test verifies:

```text
two expiry lots ordered by FEFO
exact Inventory reservations
allocation command idempotency
pack-before-pick rejection
over-pick rejection
pick and pack completion
audit and outbox evidence
concurrent allocation: one success and one conflict without over-allocation
```

CodeRabbit skipped the draft PR; required repository CI is the source gate and no CodeRabbit wait is required.

## Phase 6D sequence

```text
6D.1 warehouse reservation demand and fulfillment projection  SOURCE MERGED
6D.2 exact location/lot allocation, FEFO/FIFO, pick and pack   SOURCE READY IN PR #236
6D.3 Delivery Order foundation to ready_to_dispatch           NOT STARTED
6D.4 Inventory issue/reversal and return lineage              NOT STARTED
```

Phase 6E, not Phase 6D, owns vehicles, drivers, trips, stops, delivery attempts and POD.

## Production boundary

Issue #235 and PR #236 authorize source work only.

They do not authorize:

```text
production migrations 042 or 043
Core backend production deploy
NPP frontend production redeploy
MCP, Admin or Delivery deploy
provider, DNS or credential changes
Phase 6D.3 Delivery Order work
Phase 6E transportation execution
merge to main without an explicit owner command
```

> Updated: `2026-08-04`
> Current checkpoint: Phase 6D.2 source implementation complete; final handoff-only commit requires exact-head CI before PR is marked ready.