# Phase 7.0 — Inventory and Costing Decision Lock

**Status:** `PROPOSED / OWNER_REVIEW_REQUIRED`  
**Parent:** Issue #328  
**Baseline audited:** `main@7d4b952db1b4c340b3bfb3e92a1e98f6356e717b`  
**Scope:** NPP Operations + Core Inventory only  
**Production:** no deploy, no production migration, no provider change

## 1. Purpose

This document locks the architecture and proposes the remaining owner decisions before Phase 7 introduces any inventory mutation.

Phase 7 must extend the existing inventory ledger. It must not create a second stock ledger, overwrite balance projections, duplicate Goods Receipt behavior, or move daily warehouse work into Admin, Delivery, or MCP.

## 2. Audited source-of-truth map

| Concern | Current source of truth | Derived/read model | Phase 7 rule |
|---|---|---|---|
| Posted inventory quantity | immutable inventory movement + movement lines | inventory balance projection | movement remains authoritative; no direct balance mutation |
| Reversal | append-only reversal movement linked to original | rebuilt balance | never edit or delete a posted movement |
| Available quantity | on-hand less active reservations | balance/reservation projections | fail closed when quantity is insufficient |
| Reservation | immutable reservation lifecycle/events | available balance | reservations do not replace on-hand ledger |
| Lot and expiry | canonical lot + tracking policy | allocation candidate view | preserve canonical lot identity and expiry policy |
| Physical allocation | existing FEFO/FIFO ordering | fulfillment allocation rows | FEFO when expiry exists, FIFO otherwise |
| Manual allocation override | exact location/lot allocation | allocation read model | permission plus mandatory reason and audit |
| Cost value | no complete inventory cost ledger exists | none suitable as authority | Phase 7 must add a rebuildable cost projection tied to movement lines |
| Audit/integration | audit records + shared outbox in mutation transaction | consumers | every Phase 7 mutation follows the same atomic pattern |

Exact quantity and money calculations must use database decimal/numeric or scaled integer semantics. JavaScript floating-point values are not an inventory or costing source of truth.

## 3. Existing invariants retained

The following are already established and are not reopened by Phase 7:

1. The immutable inventory ledger is the quantity source of truth.
2. Balance and future costing tables are rebuildable projections.
3. Negative stock fails closed by default.
4. Posted records are corrected with reversal or compensating movements.
5. Mutation, movement, projection, audit, and outbox commit in one transaction.
6. Every mutation is installation-scoped, warehouse-scoped, deny-by-default, idempotent, and concurrency-safe.
7. Existing physical allocation remains FEFO for expiring lots and FIFO for non-expiring stock.
8. Manual allocation outside the suggested order requires explicit permission and a business reason.
9. NPP Operations owns daily warehouse work. Admin may only review totals, alerts, or explicitly delegated exceptions.
10. Delivery and MCP do not own inventory adjustment or costing.

## 4. Owner decisions proposed for lock

### D1. Costing method

**Proposed decision:** `MOVING_WEIGHTED_AVERAGE` by installation + warehouse + inventory-base SKU in the installation base currency.

Rules:

- Physical allocation policy remains FEFO/FIFO and is independent from financial valuation.
- Every inbound cost-bearing movement updates the warehouse/SKU moving average using exact decimal arithmetic.
- Every outbound movement carries the current locked average cost from its warehouse/SKU valuation state.
- A warehouse transfer carries the source dispatch cost into in-transit and then into the destination receipt; the destination moving average is recalculated on receipt.
- Cost projections must drill down to the exact inventory movement line and source document.
- Lot cost may be displayed for traceability, but lot identity is not a separate competing costing ledger.

**Not selected:** FIFO cost layers. Existing FIFO wording concerns physical lot allocation, not accounting valuation.

### D2. Backdated and reversal costing

**Proposed decision:**

- Quantity ledger stores both business occurrence time and immutable posting time.
- Cost ordering is deterministic by business occurrence time, posting time, then movement identity.
- Backdated posting is allowed only in an open accounting period.
- A backdated cost-bearing movement marks the affected warehouse/SKU cost projection stale and rebuilds it forward from the earliest affected movement before the projection is considered current.
- Backdating into a closed period is denied. Correction is posted in the current open period with lineage to the original document.
- Reversal uses the exact original movement-line quantity and cost amount. It never uses the current average cost.
- A reversal or rebuild never edits the original movement or original cost entry.

### D3. Negative stock

**Proposed decision:** no negative-stock exception in Phase 7.

All transfer dispatch, adjustment, scrap, and stocktake posting paths remain fail closed. Any future exception requires a separate owner decision, permission, reason, limit, audit contract, and reconciliation plan.

### D4. Lot, expiry, and allocation

**Proposed decision:** retain the current physical allocation policy:

- FEFO when a canonical expiry date exists.
- FIFO by first inbound receipt when expiry does not exist.
- Expired stock is not automatically allocatable.
- Required lot, expiry, and location policies remain enforced at every new posting boundary.
- Manual override is permitted only with the existing allocation-override permission, exact location/lot selection, mandatory reason, and audit.

Transfer receipt preserves the source lot identity. It must not silently create a different lot for the same transferred goods.

### D5. Warehouse transfer and in-transit

**Proposed lifecycle:**

```text
DRAFT -> SUBMITTED -> APPROVED -> DISPATCHED
DISPATCHED -> PARTIALLY_RECEIVED -> RECEIVED
DRAFT|SUBMITTED -> CANCELLED
APPROVED -> CANCELLED only before dispatch
```

Rules:

- Dispatch posts an immutable `TRANSFER` outbound movement from the source warehouse.
- Receipt posts one immutable `TRANSFER` inbound movement per receipt at the destination warehouse.
- In-transit quantity is a projection derived from approved transfer lines, dispatch movements, receipt movements, and resolution movements.
- In-transit is not a warehouse, not a storage location, and not a vehicle.
- Partial receipt leaves the unresolved quantity in transit.
- Shortage, damage, or excess requires an explicit variance resolution; it must not disappear through quantity overwrite.
- Dispatch reversal is allowed only when no receipt or downstream resolution exists. Otherwise use an explicit compensating transfer/variance document.
- A vehicle virtual location is out of scope unless a separate owner-approved need is documented.

### D6. Transfer variance and damage

**Proposed decision:** transfer receiving owns only transfer variance. It does not duplicate Purchase Goods Receipt.

- `RECEIVED`: accepted into destination storage.
- `DAMAGED`: received into a non-available damaged/quarantine location with exact transfer lineage.
- `SHORT`: remains unresolved in transit until an approved loss/claim resolution posts the appropriate movement.
- `EXCESS`: cannot be silently accepted; it requires source reconciliation and an approved resolution document.

Existing PO Goods Receipt remains the authority for supplier partial receipt and supplier variance.

### D7. Stocktake lifecycle and posting

**Proposed lifecycle:**

```text
DRAFT -> COUNTING -> SUBMITTED
SUBMITTED -> RECOUNT_REQUIRED -> COUNTING
SUBMITTED -> APPROVED -> POSTED
DRAFT|COUNTING|SUBMITTED|RECOUNT_REQUIRED -> CANCELLED
```

Rules:

- Draft/count data never changes inventory.
- A stocktake declares exact warehouse/location/SKU/lot scopes.
- Only those exact scopes are frozen while counting is active; unrelated warehouse work continues.
- Movement posting services must fail closed when a movement overlaps an active frozen stocktake scope.
- Submit stores counted quantity, system quantity at the locked scope, variance, counter, timestamps, and request lineage.
- Any nonzero variance requires approval before posting.
- Approver may request recount without mutating the submitted count history.
- Posting creates one idempotent `ADJUSTMENT` movement for nonzero lines and updates the balance projection through the ledger service.
- A zero-variance stocktake posts its audit/outbox result without an empty inventory movement.
- A posted stocktake is immutable. Correction uses approved reversal/compensating adjustment plus a new stocktake when necessary.
- For a nonzero variance, the final approver must differ from the latest counter.

### D8. Manual adjustment

**Proposed lifecycle:**

```text
DRAFT -> SUBMITTED -> APPROVED -> POSTED
DRAFT|SUBMITTED -> CANCELLED
```

Rules:

- No direct quick-adjust endpoint is allowed.
- Reason code and business explanation are mandatory.
- Exact warehouse/location/SKU/lot scope and signed base quantity are mandatory.
- Every nonzero manual adjustment requires approval; no arbitrary monetary threshold is introduced before the cost foundation exists.
- Creator and approver must be different actors.
- Posting creates one immutable `ADJUSTMENT` movement and the corresponding audit/outbox records in the same transaction.
- Transfer, receipt, issue, or return mistakes use their domain reversal path rather than a generic manual adjustment.

Initial reason codes:

- `FOUND_STOCK`
- `LOST_STOCK`
- `DATA_CORRECTION`
- `DAMAGE_CONFIRMED`
- `SCRAP_APPROVED`
- `OTHER_APPROVED`

`OTHER_APPROVED` requires the approval note to explain why no specific code applies.

### D9. Quarantine, damaged, and scrap

**Proposed decision:**

- Quarantine and damaged stock remain on hand but are moved to dedicated non-available locations using immutable transfer movements.
- These locations are excluded from fulfillment allocation and ordinary available quantity.
- Scrap is not a warehouse or permanent stock location.
- Scrap requires an approved scrap document and posts an outbound inventory movement from the exact damaged/quarantine/storage scope.
- A scrap reversal is allowed only when downstream disposal evidence does not block it; otherwise use an approved compensating receipt with full lineage.

### D10. Vehicle location

**Proposed decision:** no vehicle virtual location in the initial Phase 7 plan.

Delivery trip state and transfer in-transit projection already provide lineage without treating each vehicle as inventory storage. A vehicle location requires a separate issue only if a concrete operational gap is proven.

## 5. Permission contract

All permissions are deny-by-default and always combined with installation and warehouse scope.

Existing permissions retained:

- `core.inventory.read`
- `core.inventory.post`
- `core.inventory.reverse`
- `core.inventory.reserve`
- `core.inventory.tracking-policy.read`
- `core.inventory.tracking-policy.manage`
- `core.inventory.lot.read`
- `core.inventory.lot.manage`
- `core.fulfillment.override-allocation-policy`

Proposed Phase 7 permissions:

| Domain | Permissions |
|---|---|
| Transfer | `core.warehouse-transfer.read`, `.create`, `.submit`, `.approve`, `.dispatch`, `.receive`, `.reverse` |
| Stocktake | `core.stocktake.read`, `.create`, `.count`, `.submit`, `.approve`, `.post`, `.reverse` |
| Adjustment | `core.inventory-adjustment.read`, `.create`, `.submit`, `.approve`, `.post`, `.reverse` |
| Disposition | `core.inventory-disposition.read`, `.create`, `.approve`, `.post`, `.reverse` |
| Costing | `core.inventory-cost.read`, `.rebuild`, `.reconcile` |

The backend remains the final authority. Hidden or disabled UI controls are not authorization.

## 6. Idempotency and concurrency contract

Every transition that can change state or inventory must:

1. Require an idempotency key using the existing safe-key contract.
2. Hash a canonical request payload.
3. Replay the original result for the same key and same payload.
4. return `IDEMPOTENCY_PAYLOAD_MISMATCH` for the same key with a different payload.
5. Enforce a database uniqueness invariant for document + transition.
6. Lock the document row and each affected inventory scope in a deterministic order.
7. Validate current lifecycle state after acquiring locks.
8. Commit domain state, movement, projection, audit, and outbox atomically.

A retry must never create a second dispatch, receipt, stocktake adjustment, manual adjustment, disposition, or cost entry.

## 7. Audit and outbox contract

Required audit fields include:

- installation, actor, source app, request, idempotency key;
- document, lifecycle transition, before/after state;
- warehouse/location/SKU/lot scope;
- reason, approval, recount, variance, reversal lineage;
- movement IDs and cost-entry IDs when applicable.

Required outbox families:

- `warehouse_transfer.*`
- `stocktake.*`
- `inventory_adjustment.*`
- `inventory_disposition.*`
- `inventory_cost.*`

Outbox event identity must be deterministic for an aggregate transition so replay does not emit duplicate business events.

## 8. NPP Operations layout contract

Phase 7.0 changes no screen, route, menu, or button.

Future Phase 7 UI must follow the existing Operations shell:

- Inventory functions stay inside the `Tồn kho & lô hàng` group.
- Section navigation remains navigation only.
- Desktop primary actions stay at the right side of the page header/action row.
- Mobile primary actions use the page's compact action area and are not mixed into navigation.
- Filters stay at the top of content and follow the existing apply/reset/export pattern.
- Mutation buttons are not scattered inside summary cards.
- A primary action appears once; duplicate desktop/body/mobile actions are not allowed.
- Every action is permission-aware, but backend authorization remains mandatory.

## 9. Vertical slices after owner lock

1. Warehouse transfer + in-transit foundation.
2. Transfer receipt + partial receipt + variance/damage.
3. Stocktake + recount + approval + posting.
4. Manual adjustment + quarantine/damaged + scrap.
5. Moving weighted-average costing foundation.
6. Backdated/reversal costing + rebuild/reconciliation.
7. Optional vehicle virtual location only through a separate approved issue.
8. Production closeout as a separate task after all source slices merge and only on explicit instruction.

Each slice is migration -> backend -> required NPP UI -> tests -> exact-head CI -> PR. No slice may combine MCP, Admin daily CRUD, Delivery inventory adjustment, or production rollout.

## 10. Migration and production boundary

The audited aggregate migration registry ends at `057_phase6f_reconciliation_views`; therefore the next free migration identifier is `058`, subject to re-audit immediately before the first Phase 7 schema PR.

Phase 7.0 creates no migration. Before any later production migration:

- audit exact registry and pending migrations;
- confirm shared database backup;
- run apply/rerun/grouped rehearsal;
- run restore rehearsal and before/after reconciliation;
- obtain explicit production migration instruction.

No production deployment or migration is implied by owner approval of this document.

## 11. Owner lock checklist

Phase 7 mutation work remains blocked until the owner confirms or edits these decisions:

- [ ] D1 moving weighted-average costing
- [ ] D2 open-period backdate rebuild and exact-original reversal cost
- [ ] D3 no negative-stock exception
- [ ] D4 FEFO/FIFO physical allocation with audited manual override
- [ ] D5 transfer lifecycle and derived in-transit model
- [ ] D6 transfer variance/damage boundary
- [ ] D7 stocktake lifecycle, exact-scope freeze, recount, approval, and posting
- [ ] D8 approved manual adjustment with no quick-adjust path
- [ ] D9 quarantine/damaged locations and document-based scrap
- [ ] D10 no vehicle virtual location in the initial plan

After owner approval, this document changes from `PROPOSED / OWNER_REVIEW_REQUIRED` to `LOCKED`, and child implementation issues may move from planning to mutation work.