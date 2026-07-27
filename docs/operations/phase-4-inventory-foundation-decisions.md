# Phase 4 — Inventory Foundation Decisions

> Status: **P4.0 CONTRACT DRAFT — NO INVENTORY MUTATION MAY BE IMPLEMENTED YET**  
> Branch: `agent/phase-4-inventory-contract`  
> Base audited: `main@2e3638efd6290cfd459a6de93da3b20f916844db`  
> Scope of this document: source contract, schema proposal, state machines, unresolved business decisions and acceptance-test matrix only.  
> Explicit exclusions: no production provider call, no production database mutation, no Heroku/Vercel deployment, no Phase 4 migration, no posting service and no UI.

## 1. Evidence boundary and repository audit

The following repository facts were verified before writing this contract:

- The active master plan is `NPP_PLATFORM_MASTER_PLAN.md`.
- `main` is at `2e3638efd6290cfd459a6de93da3b20f916844db`.
- PR #59 remains open and currently states that the grouped Phase 3 rollout was operator-confirmed complete. It must not be merged as-is before the owner performs the deferred Phase 3 production verification.
- `docs/operations/LATEST_HANDOFF.md` on `main` is stale: it still says Phase 3.3F is next and production migrations stop at 009.
- The actual migration registry ends at:
  - `015_document_numbering`
  - `016_permission_catalog_alignment`
- The actual migration files are:
  - `database/migrations/shared/015_document_numbering.sql`
  - `database/migrations/shared/016_permission_catalog_alignment.sql`
- Therefore the handoff labels `015_document_numbering_foundation` and `016_document_numbering_allocation` are not the source-of-truth migration IDs.
- If `main` remains unchanged, the first Phase 4 migration candidate is `017_inventory_ledger_foundation`. This number is not reserved by this document and must be re-audited immediately before P4.1 creates a migration.
- Existing product quantity logic uses fixed-scale decimal strings and `BigInt`, not JavaScript floating point.
- `shared.product_variants.conversion_to_base` is `numeric(20,6)` and the current multiplication helper preserves up to 12 fractional digits.
- Request context is server-owned and already carries `installationId` plus `warehouseIds` scope, but the current bootstrap principal has no explicit warehouse scope. Inventory posting must remain blocked until warehouse-scope behavior is fail-closed and tested.
- Existing mutation routes use the shared idempotency store and `withAuditOutboxTransaction` to keep domain writes, audit and outbox atomic.
- Existing document-number allocation already provides installation-scoped, idempotent, concurrency-safe numbering with immutable allocation history.

Audited source paths:

```text
NPP_PLATFORM_MASTER_PLAN.md
docs/operations/LATEST_HANDOFF.md
npp-core/api/src/migrations/index.js
npp-core/api/src/request-context.js
npp-core/api/src/access/permissions.js
npp-core/api/src/audit-outbox.js
npp-core/api/src/services/product-unit.js
npp-core/api/src/services/document-numbering.js
npp-core/api/src/routes/document-numbering.js
database/migrations/shared/005_org_warehouses.sql
database/migrations/shared/006_org_locations.sql
database/migrations/shared/012_product_catalog_foundation.sql
database/migrations/shared/013_product_units_conversions_barcodes.sql
database/migrations/shared/015_document_numbering.sql
database/migrations/shared/016_permission_catalog_alignment.sql
```

## 2. Phase 4 scope and non-goals

Phase 4 establishes inventory truth and reusable posting primitives for later purchasing and sales slices.

Included:

- immutable inventory movement ledger;
- atomic posting and reversal;
- rebuildable balance read model;
- reservation lifecycle and concurrency control;
- negative-stock enforcement;
- lot/expiry foundation;
- opening-balance import through ledger posting;
- movement and balance drill-down contract;
- inventory permissions, idempotency, audit and outbox.

Not included:

- purchase orders or complete goods-receipt workflow;
- sales orders, delivery or complete returns workflows;
- receivable, payable or accounting entries;
- inventory costing entries or COGS;
- MCP order integration or MCP cutover;
- production posting before costing, negative-stock, lot/expiry and backdated policies are owner-approved;
- a generic public posting endpoint that future purchasing or sales code can use to bypass their own document lifecycle.

## 3. Locked technical invariants

These are architecture invariants, not optional business preferences.

1. **Ledger is the source of truth.** On-hand quantity is the sum of posted movement-line deltas for the exact inventory scope.
2. **Balance is a read model.** It may be updated synchronously by the inventory projector, but it must be fully rebuildable from the ledger.
3. **Posted movements are immutable.** No update or delete of a movement or movement line after insert.
4. **Correction is append-only.** An error is corrected by a reversal or a new adjustment movement, never by editing the original movement.
5. **One reversal only.** A unique constraint on `reversal_of_movement_id` prevents reversing the same movement twice.
6. **Installation is server-owned.** Client-supplied installation IDs are ignored or rejected.
7. **Warehouse scope is fail-closed.** A request without an allowed warehouse scope cannot post, reverse, reserve, release or consume inventory for that warehouse.
8. **Exact decimal arithmetic only.** Quantity parsing, conversion and aggregation must not use JavaScript `number` arithmetic.
9. **Atomic posting.** Movement header, lines, synchronous projection when present, reservation consumption when present, audit and outbox commit or roll back together.
10. **Idempotent retry.** Same key plus same canonical payload returns the original result. Same key plus different payload returns conflict.
11. **Historical snapshots are preserved.** Source SKU, unit, conversion and document-number values used at posting time are stored on the ledger line/header.
12. **No direct balance mutation.** Controllers, imports and UI cannot update balance rows. Only the inventory projector and rebuild process may write the read model.
13. **No raw provider errors.** Public API responses use sanitized stable error codes.
14. **Costing is absent until selected.** Phase 4 cannot invent moving average, FIFO, accounting value or gross margin.
15. **Core-only boundary.** A Phase 4 Core PR must keep `mcp/** = 0`.

## 4. Quantity, unit and precision contract

### 4.1 Canonical identity

- A document line selects a canonical `shared.product_variants` row as its source SKU/unit identity.
- Inventory is normalized to the product's active inventory-base variant.
- Posting validates that the product, source variant, base variant and unit all belong to the server-owned installation and are active according to the posting policy.
- The source variant's current conversion is read and snapshotted at posting time.

### 4.2 Precision

Existing Phase 3 data allows:

```text
source quantity:       up to 6 fractional digits
conversion_to_base:    up to 6 fractional digits
exact product:         up to 12 fractional digits
```

Proposed storage:

```text
source_quantity          numeric(20,6)
conversion_to_base       numeric(20,6)
base_quantity_delta      numeric(30,12)
balance quantities       numeric(30,12)
reservation quantities   numeric(30,12)
```

Rules:

- `source_quantity` is positive on the document-facing line.
- `base_quantity_delta` is signed and non-zero in the ledger.
- `base_quantity_delta = exact(source_quantity × conversion_to_base × direction)`.
- No rounding is permitted during normalization. Overflow or unsupported precision is rejected.
- A non-fractional source unit rejects a fractional source quantity.
- Historical movement values do not change when the master-data conversion changes later.

### 4.3 Required snapshots

Each movement line should snapshot at least:

```text
source_variant_id
source_sku
source_unit_id
source_unit_code
source_quantity
conversion_to_base
base_variant_id
base_sku
base_quantity_delta
```

Names may be snapshotted for display, but IDs and codes remain the canonical references.

## 5. Inventory scope contract

Every ledger delta has this identity:

```text
installation
warehouse
location when required
base product variant/SKU
lot when applicable
```

Proposed rules:

- `warehouse_id` is always required.
- `location_id` belongs to the same installation and warehouse.
- Whether `location_id` is mandatory is controlled by an inventory policy, not by client choice.
- A balance key uses `installation_id + warehouse_id + location_id + base_variant_id + lot_id`.
- PostgreSQL 17 `UNIQUE NULLS NOT DISTINCT` should be used where nullable scope columns must still form one canonical balance row.
- Warehouse A permission never authorizes Warehouse B.
- A transfer is represented by balanced source and destination ledger deltas in one atomic movement or by a future explicit in-transit workflow. Phase 4 does not choose instant transfer versus in-transit behavior.

## 6. Movement lifecycle

The ledger contains posted facts only. Draft business documents belong to purchasing, sales or another owning domain.

```text
validated command
  -> atomic POSTED movement inserted
  -> immutable forever

incorrect POSTED movement
  -> new POSTED reversal movement
  -> reversal_of_movement_id references original
  -> original row remains unchanged
```

There is no editable `DRAFT` row in the inventory ledger.

Derived read states may show:

```text
POSTED
REVERSED (derived because a reversal exists)
REVERSAL (the reversing movement itself)
```

The original movement is not updated merely to display `REVERSED`.

## 7. Movement-type proposal

Movement type is a stable domain code stored as text. The database should validate syntax; the service owns the allowlist and source-domain rules so future forward-only types do not require rewriting old migrations.

Proposed vocabulary:

```text
OPENING_BALANCE            Phase 4.4
MANUAL_ADJUSTMENT_IN       future enablement; explicit permission/reason required
MANUAL_ADJUSTMENT_OUT      future enablement; explicit permission/reason required
REVERSAL                   system-generated only
PURCHASE_RECEIPT           Phase 5 internal posting caller
SUPPLIER_RETURN_ISSUE      Phase 5 internal posting caller
SALES_DELIVERY_ISSUE       Phase 6 internal posting caller
CUSTOMER_RETURN_RECEIPT    Phase 6 internal posting caller
TRANSFER_ISSUE             Phase 7 or earlier owner-approved transfer slice
TRANSFER_RECEIPT           Phase 7 or earlier owner-approved transfer slice
STOCKTAKE_ADJUSTMENT       Phase 7
QUARANTINE_MOVE            Phase 7
SCRAP_ISSUE                Phase 7
```

P4.1 must not expose all of these through a generic public API. Future owning modules call an internal inventory posting service with a validated source document reference. Unsupported or not-yet-enabled movement types fail closed.

Every movement records:

```text
movement_type
source_domain
source_document_type
source_document_id
source_document_number snapshot when present
document_date
posted_at
posted_by
request_id
source_app
idempotency_key
payload_hash
reversal_of_movement_id when applicable
reason_code / reason_note when required
metadata
```

## 8. Reversal contract

A reversal command must:

1. authenticate and authorize `core.inventory.reverse`;
2. validate warehouse scope for every original line;
3. lock or otherwise serialize on the original movement;
4. reject reversal when a reversal already exists;
5. create a new movement with `movement_type = REVERSAL`;
6. copy the original line snapshots;
7. negate every original `base_quantity_delta` exactly;
8. use a new document number if the owner-approved numbering policy requires one;
9. write audit and outbox in the same transaction;
10. leave the original movement and lines unchanged.

Open decisions:

- whether reversal uses current posting date or may use original document date;
- which roles may reverse;
- whether a reason is mandatory;
- whether negative-stock checks apply to a reversal that decreases stock;
- whether a reversal may be blocked after downstream documents consume its stock.

Until decided, reversal is not production-enabled.

## 9. Schema proposal

This is a proposal only. P4.1 must re-audit `main` before creating migration `017` or any later migration.

### 9.1 `inventory.inventory_movements`

```text
id uuid primary key
installation_id text not null
movement_type text not null
source_domain text not null
source_document_type text null
source_document_id text null
source_document_number text null
document_date date not null
posted_at timestamptz not null
posted_by text not null
request_id text not null
source_app text not null
idempotency_key text not null
payload_hash text not null
reversal_of_movement_id uuid null
number_series_id uuid null
number_allocation_id uuid null
document_number text null
reason_code text null
reason_note text null
metadata jsonb not null default '{}'
```

Key constraints:

```text
unique (installation_id, id)
unique (installation_id, idempotency_key)
unique (installation_id, reversal_of_movement_id) where reversal_of_movement_id is not null
foreign key (installation_id, reversal_of_movement_id) -> inventory_movements
foreign key (installation_id, number_series_id) -> shared.document_number_series
foreign key (installation_id, number_allocation_id) -> shared.document_number_allocations
append-only trigger: reject UPDATE and DELETE
```

### 9.2 `inventory.inventory_movement_lines`

```text
id uuid primary key
installation_id text not null
movement_id uuid not null
line_number integer not null
warehouse_id uuid not null
location_id uuid null
source_variant_id uuid not null
source_sku text not null
source_unit_id uuid not null
source_unit_code text not null
source_quantity numeric(20,6) not null
conversion_to_base numeric(20,6) not null
base_variant_id uuid not null
base_sku text not null
base_quantity_delta numeric(30,12) not null
lot_id uuid null
lot_code text null
expiry_date date null
source_line_reference text null
metadata jsonb not null default '{}'
```

Key constraints:

```text
unique (installation_id, id)
unique (installation_id, movement_id, line_number)
foreign key movement, warehouse, location, variants, units and lot are installation-scoped
source_quantity > 0
conversion_to_base > 0
base_quantity_delta <> 0
location belongs to warehouse
append-only trigger: reject UPDATE and DELETE
```

### 9.3 `inventory.inventory_balances`

Read model only:

```text
installation_id text not null
warehouse_id uuid not null
location_id uuid null
base_variant_id uuid not null
lot_id uuid null
on_hand_quantity numeric(30,12) not null
reserved_quantity numeric(30,12) not null default 0
projected_through timestamptz null
updated_at timestamptz not null
```

Derived:

```text
available_quantity = on_hand_quantity - reserved_quantity
```

The application must not store `available_quantity` independently unless it is a generated value or an explicitly rebuildable projection.

### 9.4 `inventory.inventory_lots`

```text
id uuid primary key
installation_id text not null
base_variant_id uuid not null
lot_code text not null
manufactured_date date null
expiry_date date null
metadata jsonb not null default '{}'
created_at timestamptz not null
created_by text not null
```

Proposed identity: `installation_id + base_variant_id + normalized lot_code`. Owner confirmation is required.

### 9.5 `inventory.product_tracking_policies`

Inventory-owned extension instead of adding inventory policy columns to the shared product table:

```text
installation_id text not null
base_variant_id uuid not null
lot_tracking_mode text not null
expiry_tracking_mode text not null
location_required boolean not null
updated_at timestamptz not null
updated_by text not null
```

The exact modes remain owner decisions.

### 9.6 Reservation tables

Proposed aggregate plus immutable event history:

```text
inventory.inventory_reservations
inventory.inventory_reservation_events
```

The reservation row is a lifecycle aggregate and may be updated only through the reservation service under row locking. Every transition appends an immutable event in the same transaction.

### 9.7 Opening-balance import tables

Proposed P4.4 support:

```text
inventory.opening_balance_imports
inventory.opening_balance_import_rows
```

Imports store source key, file checksum, validation result, row errors, totals and the resulting movement ID. They never write balances directly.

## 10. Balance projection and rebuild

### 10.1 Projection

Only the inventory projector may change `inventory.inventory_balances`.

For each movement line:

```text
on_hand_quantity := on_hand_quantity + base_quantity_delta
```

The projector runs in the posting transaction when synchronous projection is enabled.

### 10.2 Rebuild

A full rebuild must:

1. create a fresh projection target or truncate a disposable projection inside a controlled transaction;
2. aggregate immutable movement lines by exact scope;
3. replace the read model atomically or swap tables/views safely;
4. compare row counts, scope keys and quantities against the current projection;
5. be repeatable and yield the same result every time;
6. never modify the ledger.

### 10.3 Reconciliation

Required report columns:

```text
installation_id
warehouse_id
location_id
base_variant_id
lot_id
ledger_quantity
projected_quantity
difference
movement_count
latest_movement_at
```

The Phase 4 gate requires all differences to be exactly zero.

## 11. Idempotency contract

Inventory uses two layers:

1. shared HTTP/request idempotency for stable API replay;
2. domain-level uniqueness on movement/reservation/import source keys so internal retries are also safe.

Canonical payload hashing must:

- sort object keys recursively;
- preserve array order;
- normalize decimal strings before hashing;
- exclude server-generated values such as IDs and timestamps;
- include every field that changes business meaning;
- produce a stable SHA-256 digest.

Behavior:

```text
same installation + key + same hash      -> replay original result
same installation + key + different hash -> IDEMPOTENCY_PAYLOAD_MISMATCH
```

A retry cannot allocate a second document number or create a second movement.

## 12. Reservation state machine proposal

Proposed states:

```text
ACTIVE
RELEASED
CONSUMED
EXPIRED
CANCELLED
```

Proposed transitions:

```text
create/reserve:  none      -> ACTIVE
release:         ACTIVE    -> RELEASED
consume:         ACTIVE    -> CONSUMED
expire:          ACTIVE    -> EXPIRED
cancel:          ACTIVE    -> CANCELLED
```

Terminal states cannot transition again.

Open decisions that block P4.3:

- whether partial release and partial consume are required;
- whether one reservation may span multiple warehouses/locations/lots;
- whether reservation selects a lot immediately or only at allocation/picking time;
- expiration source: explicit timestamp, order lifecycle or scheduled job;
- whether a reservation may be extended;
- whether available stock is checked at warehouse, location or lot scope;
- whether reservations are created from sales confirmation or a later allocation event;
- whether an override can reserve beyond available stock.

Concurrency proposal:

- lock the exact balance scope rows in deterministic key order;
- calculate available quantity inside the transaction;
- reject when the requested quantity exceeds available quantity;
- update reserved projection and reservation aggregate atomically;
- append reservation event, audit and outbox before commit;
- use domain idempotency on every transition.

The acceptance gate is not met unless two concurrent reserve requests cannot oversell.

## 13. Negative-stock policy questions

Technical safe behavior until owner approval: **deny by default**.

Owner must decide:

1. Is policy installation-wide or warehouse-specific?
2. Does it apply to on-hand or available quantity?
3. Which movement types may ever exceed stock?
4. Which role/permission may override?
5. Is an override reason mandatory?
6. Is approval required above a threshold?
7. Can backdated posting create a historical negative balance?
8. Is negative quantity evaluated per warehouse, location and lot?
9. Can reversal bypass the rule when it restores historical correctness?
10. Is a vehicle warehouse treated differently?
11. Can transfer issue make the source negative while receipt is pending?
12. How are existing negative balances reconciled during opening import?

Proposed permissions:

```text
core.inventory.read
core.inventory.post
core.inventory.reverse
core.inventory.reserve
core.inventory.override-negative
core.inventory.opening-balance.import
```

Permission alone never bypasses warehouse scope.

## 14. Lot and expiry questions

Owner must decide:

1. Which products/SKUs require lot tracking?
2. Which require expiry tracking?
3. Is lot identity installation-wide or scoped by base SKU?
4. Is expiry mandatory, optional or prohibited per product?
5. Can the same lot have different expiry dates?
6. Is FEFO a read/allocation suggestion or a mandatory posting rule?
7. Can a lot balance become negative?
8. Does transfer preserve lot identity?
9. Can a receipt split one line into multiple lots?
10. Can one lot exist in multiple warehouses and locations?
11. Are manufacture date and supplier lot reference required?
12. What happens when master policy changes after historical posting?

Technical proposal:

- product tracking policy is versioned or snapshotted sufficiently for historical explanation;
- lot is optional for non-lot-tracked items and mandatory for lot-tracked items;
- expiry is validated against the tracking policy;
- ledger lines snapshot lot code and expiry date in addition to `lot_id`;
- balances include lot in their key only when applicable.

## 15. Opening-balance contract

Opening balance is `movement_type = OPENING_BALANCE`.

Required import behavior:

- source key and file checksum are mandatory;
- retry with the same source key and content returns the same movement;
- source-key reuse with different content conflicts;
- SKU, source unit, conversion, warehouse, location and lot are validated;
- every accepted row becomes a ledger line;
- no controller/import code writes balances directly;
- totals before normalization and after normalization are reported;
- resulting balances reconcile exactly to the posted movement;
- audit and outbox are in the posting transaction.

Owner decisions:

- all-or-nothing file versus partial acceptance;
- maximum rows per import;
- one movement per file or one movement per logical group;
- whether zero quantities are ignored or rejected;
- whether negative opening quantities are allowed;
- duplicate row policy;
- required source columns and date semantics;
- who approves and posts an import.

Safe proposal: validate the complete file first and post nothing while any row is invalid. Row-level errors are returned for correction.

## 16. Document-number contract

The actual repository already has complete allocation in migration `015_document_numbering`; no second allocation migration exists.

Inventory posting should call the existing document-number service inside the same outer transaction or use a transaction-compatible repository primitive. It must not allocate a number before validation and then abandon it outside the posting transaction.

Owner must decide:

- one `INVENTORY_MOVEMENT` document type or separate series by movement type;
- whether reversal has its own series;
- whether opening balance has its own series;
- numbering date: document date or posting date;
- warehouse-specific series or installation-wide series.

A document number is snapshotted on the movement and never changes.

## 17. API and authorization proposal

P4.1 API foundation should prioritize reads and explicit commands:

```text
GET  /api/inventory/movements
GET  /api/inventory/movements/:id
POST /api/inventory/movements/:id/reverse
GET  /api/inventory/balances
GET  /api/inventory/balances/:scope/movements
```

Do not expose a universal public `POST /api/inventory/movements` accepting arbitrary movement types.

Later owning-domain commands call the internal posting service. Opening balance gets a dedicated import/post endpoint in P4.4. Manual adjustment gets a dedicated endpoint only after its policy and permission are approved.

Authorization order:

1. authenticate;
2. build server-owned request context;
3. require known inventory permission;
4. resolve warehouse IDs from canonical database rows;
5. require explicit scope for every warehouse touched;
6. validate product/unit/location/lot scope;
7. execute idempotent transaction.

Current blocker: bootstrap authentication currently provides no explicit warehouse IDs. Production inventory mutation must not be enabled until the real scope contract is implemented and covered by tests.

## 18. Audit and outbox proposal

Audit records should include:

```text
actor
request ID
source app
operation
movement/reservation/import ID
source document reference
warehouse/location scope
before/after only for mutable reservation aggregates/read models
reason code/note
idempotency key or safe digest reference
occurredAt
```

Outbox event proposal:

```text
inventory.movement.posted
inventory.movement.reversed
inventory.balance.rebuilt
inventory.reservation.created
inventory.reservation.released
inventory.reservation.consumed
inventory.reservation.expired
inventory.opening-balance.posted
```

Events contain IDs and normalized quantities, not secrets or provider data.

## 19. Acceptance-test matrix

### 19.1 Migration and PostgreSQL 17

| Case | Expected |
|---|---|
| Clean PostgreSQL 17 database migrates from 002 through candidate Phase 4 migration | PASS |
| Rerun migration | no-op PASS |
| `migration:verify` | PASS |
| Required schemas, constraints, indexes and append-only triggers exist | PASS |
| Rollback on migration failure leaves registry consistent | PASS |
| Existing migrations 002–016 remain unchanged | PASS |

### 19.2 Ledger posting

| Case | Expected |
|---|---|
| Post one valid movement | one header and exact lines |
| Retry same key/payload | same movement, no duplicate |
| Same key/different payload | 409 mismatch |
| Invalid warehouse/location/SKU/unit | fail before write |
| Inactive or cross-installation master data | fail closed |
| Source quantity × conversion | exact 12-scale base delta |
| Fractional quantity on non-fractional unit | reject |
| One line fails | whole movement/audit/outbox rollback |
| Posted movement update/delete | database rejects |
| Controller/import attempts direct balance update | no supported code path |
| Cross-warehouse scope | 403 |
| Missing warehouse scope | 403 |
| Audit and outbox | same transaction |

### 19.3 Reversal

| Case | Expected |
|---|---|
| Reverse once | exact opposite deltas |
| Reverse retry same key | same reversal |
| Reverse same original with new key | conflict |
| Original movement after reversal | unchanged |
| Reversal line snapshots | match original identity and negate quantity exactly |
| Unauthorized or wrong warehouse scope | denied |
| Reversal transaction failure | no partial reversal/audit/outbox |

### 19.4 Balance projection and rebuild

| Case | Expected |
|---|---|
| Projection after posting | equals ledger aggregate |
| Rebuild from zero | equals projection |
| Rebuild rerun | identical result |
| Rebuild with nullable location/lot keys | one canonical row per exact scope |
| Drill-down movement sum | equals displayed balance |
| Reversal projected | restores exact prior quantity |
| Reconciliation report | zero differences |
| Ledger during rebuild | unchanged |

### 19.5 Reservations

| Case | Expected |
|---|---|
| Reserve within available | ACTIVE and reserved increases |
| Concurrent reserve over available | only valid amount succeeds; no oversell |
| Same transition retry | no duplicate event or quantity change |
| Release | available restored |
| Consume | reserved reduced according to approved semantics |
| Expire | no longer reduces available |
| Terminal-state transition | reject |
| Wrong warehouse scope | denied |
| Negative-stock default | deny |
| Transition failure | aggregate/event/audit/outbox rollback |

### 19.6 Lot and expiry

| Case | Expected |
|---|---|
| Lot-required SKU without lot | reject |
| Non-lot SKU with lot | follow approved policy, tested explicitly |
| Expiry-required SKU without expiry | reject |
| Lot from another SKU/installation | reject |
| Lot drill-down | exact movement sum |
| Transfer lot behavior | matches approved contract |

### 19.7 Opening balance

| Case | Expected |
|---|---|
| Valid import | creates OPENING_BALANCE movement |
| Balance write path | projector only |
| Retry same source key/file | no duplicate movement |
| Source key with changed file | conflict |
| Invalid row | no post or approved partial behavior |
| Before/after totals | reconcile exactly |
| Cross-installation/SKU/unit/location | reject |
| Import failure | no partial movement/balance/audit/outbox |

### 19.8 API, security and UI

| Case | Expected |
|---|---|
| Unknown permission key | deny |
| No inventory permission | 403 |
| Client spoofs installation/warehouse scope | ignored/rejected |
| Storage/database error | sanitized stable error |
| Frontend | same-origin server gateway only |
| Browser | no backend token or provider secret |
| Movement drill-down UI | totals match API and ledger |
| Core-only PR | `mcp/** = 0` |

## 20. Slice plan and gates

### P4.0 — Contract

Deliverables:

- this decision document;
- schema and movement-type proposal;
- reservation state machine;
- reversal contract;
- negative-stock and lot/expiry questions;
- acceptance-test matrix;
- draft PR only.

Gate: owner answers all decisions that affect posting behavior. No mutation code before gate.

### P4.1 — Ledger core

- re-audit migration registry;
- create candidate inventory schema migration;
- immutable movement repository and posting service;
- internal posting contract, reversal and read API;
- idempotency, exact decimal arithmetic, permission and scope tests;
- PostgreSQL 17 apply/rerun/verify.

Gate: immutable posting/reversal, retry safety, transaction audit/outbox and warehouse isolation pass.

### P4.2 — Balance read model

- synchronous projector;
- full rebuild;
- reconciliation report;
- movement drill-down.

Gate: zero-difference rebuild and deterministic rerun.

### P4.3 — Reservations and negative stock

- reservation aggregate and event history;
- reserve/release/consume/expire;
- concurrency-safe available calculation;
- approved negative-stock policy.

Gate: concurrent reserve cannot oversell and retry cannot duplicate.

### P4.4 — Lot/expiry, opening balance and UI

- product tracking policies and lots;
- opening-balance validation/posting;
- movement/balance drill-down UI;
- browser E2E.

Gate: opening totals reconcile, lot/expiry rules pass and UI cannot bypass the API.

## 21. Decisions required from owner before P4.1 mutation code

Blocking decisions:

1. Warehouse/location model: when is location mandatory?
2. Negative-stock scope, override role and reason/approval requirements.
3. Backdated posting and reversal dates.
4. Costing method required before any production posting: moving weighted average or FIFO.
5. Document-number series strategy for inventory and reversal.
6. Who can post and reverse manual inventory adjustments?
7. Whether manual adjustment is enabled in Phase 4 or deferred.
8. Whether reversals may create temporary negative stock.
9. Production-ready warehouse-scope behavior for the current auth principal.

Decisions required before P4.3/P4.4:

10. Reservation partial release/consume semantics and expiration source.
11. Reservation scope: warehouse/location/lot selection timing.
12. Lot identity and expiry requirements per product.
13. FEFO behavior.
14. Opening-balance file atomicity, columns, maximum size and approval flow.
15. Transfer lot and in-transit behavior.

## 22. Current P4.0 conclusion

The repository is ready for a Phase 4 contract branch, but it is **not ready for inventory mutation code**.

Reasons:

- Phase 3 production verification is deferred by owner and PR #59 is unsafe to merge as-is.
- Several required business policies are intentionally unresolved.
- Current authentication supplies permissions but does not yet prove production warehouse scope.
- Quantity storage needs a deliberate 12-scale ledger/balance design to preserve exact conversion results.
- Costing is not selected and must not be invented.

The next valid action is owner review of this contract. After decisions are recorded, P4.1 may create a small ledger-core PR from the then-current `main`, using PostgreSQL 17 disposable testing only and without any production provider call.
