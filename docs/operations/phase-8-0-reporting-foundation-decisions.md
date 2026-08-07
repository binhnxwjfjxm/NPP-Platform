# Phase 8.0 — Reporting Foundation & Decision Lock

Status: **SOURCE GATE / OWNER-LOCKED FOR PHASE 8 IMPLEMENTATION**

Parent issue: #367

Execution plan: `docs/operations/phase-8-reporting-operations-plan.md`

Baseline audited before this decision lock:

- repository: `binhnxwjfjxm/NPP-Platform`;
- exact `main`: `2d4f273d65c6f9ac15dbdf72a6d05b8d5b9a27e9`;
- Phase 8 plan PR #368 merged;
- PR #234 remains an unrelated NPP Sales UI PR and must not be absorbed;
- no Phase 8.0 branch existed before this slice;
- PR #368 exact-head `verify-foundation` completed successfully;
- parent #367 was reopened because the plan PR text contained `Closes #367` even though Phase 8 is not complete.

This file locks the reporting rules that Phase 8.1–8.7 must follow. It does **not** add report runtime code, schema migration, role assignment, production migration or deployment.

## 1. User outcome

Phase 8 reporting must give operations one reproducible answer to a business question.

A card, table, export, cached aggregate or control-tower number is never a new source of truth. Every displayed metric must be traceable to canonical source documents/ledgers/facts, or to a rebuildable read model whose definition and reconciliation path are documented.

## 2. Audit of the current reporting foundation

### 2.1 Existing `reporting` schema

At this gate, `database/migrations/reporting/` contains only the Phase 6F reconciliation migration:

- `057_phase6f_reconciliation_views.sql`.

It creates read-only/rebuildable reconciliation views such as:

- `reporting.phase6f_document_reconciliation`;
- `reporting.phase6f_customer_balance_reconciliation`;
- `reporting.phase6f_order_status_projection`;
- `reporting.phase6f_cod_collection_reconciliation`;
- `reporting.phase6f_cod_handover_reconciliation`;
- `reporting.phase6f_closeout_anomalies`.

These views are useful evidence and may be reused where their definitions match a Phase 8 metric, but they are **not** a generic Phase 8 reporting source layer.

### 2.2 Existing read models and costing facts

Phase 7 already established the required pattern for inventory/cost reporting:

- immutable inventory movement ledger remains quantity truth;
- `inventory.inventory_cost_facts` is immutable costing lineage;
- `inventory.inventory_cost_balances` is projector-owned and rebuildable;
- `inventory.inventory_cost_period_balances` is the closed-period snapshot basis;
- `inventory.inventory_cost_reconciliation` and cost discrepancy structures provide verification paths;
- costing method is perpetual moving weighted average `MWA_V1` by `(installation, warehouse, base variant)`;
- costing currency is VND for the current costing model;
- CLOSED costing periods are immutable.

Phase 8 must consume these contracts. It must not calculate a competing stock quantity, inventory value or COGS truth in dashboard code.

### 2.3 Existing authorization/scopes

Core request context already owns:

- `installationId`;
- `branchIds`;
- `warehouseIds`;
- `territoryIds`;
- actor, role, permissions, request id and source app.

Existing reconciliation code demonstrates backend warehouse fail-closed behavior, but it currently authorizes through a domain permission (`core.receivable.read`) and contains bootstrap-specific scope expansion. That is legacy evidence, not the Phase 8 reporting permission contract.

No `core.reporting.*` permission namespace exists at this gate.

### 2.4 Existing branch and territory source state

`shared.branches` is canonical branch master data. `shared.warehouses.branch_id` has a canonical FK to `shared.branches`, so Core reports may derive branch membership from the warehouse relationship.

There is no persisted canonical `territory_id` in the current database migrations. Request context has a `territoryIds` slot, but Phase 8 must not pretend that a branch or warehouse is a sales territory. Territory filtering becomes enforceable only for a report whose canonical MCP/field source exposes a stable territory lineage.

### 2.5 Existing exports

NPP currently has browser-side CSV export patterns, including the existing sales/COD reconciliation workspace. Those exports serialize the rows already loaded into the browser.

There is no canonical backend `export_jobs`/`import_jobs` history contract at this gate.

Therefore client-generated CSV remains a convenience for existing screens only. It is not the Phase 8 official export contract and must not be treated as audit evidence or source truth.

### 2.6 Existing API envelope

Core API already centralizes:

- success envelope through `createSuccessEnvelope`;
- sanitized error envelope through `createErrorEnvelope`;
- `x-request-id` correlation;
- request received timestamp.

Phase 8 reuses this envelope. Reporting must not introduce a competing API response shape.

### 2.7 Timezone audit

The current codebase contains multiple `Asia/Ho_Chi_Minh` presentation/business-date uses, but Core API has no single reporting-timezone configuration contract.

For this installation, Phase 8 locks the reporting timezone to **`Asia/Ho_Chi_Minh`**. New Phase 8 calculations must use that server-owned timezone explicitly rather than browser timezone, host timezone or implicit UTC calendar boundaries.

If a future installation requires another business timezone, that becomes an explicit installation configuration change; clients must never supply the authoritative timezone ad hoc.

## 3. Canonical source map

| Report family | Canonical source | Allowed supporting read model | Never use as truth |
| --- | --- | --- | --- |
| Sales | Sales Order + fulfillment + Delivery Order lifecycle | documented `reporting` projection reconciled to source | dashboard totals, browser state |
| Purchasing | Purchase Order + Goods Receipt + return lifecycle | documented `reporting` projection reconciled to source | UI PO counters |
| Inventory quantity | immutable inventory movement ledger | inventory balances/read projections | dashboard stock card |
| Inventory value / COGS | Phase 7 cost facts + period balances + adjustment lineage | costing balances/reconciliation | recomputing cost in frontend |
| Customer aging | receivable ledger + allocations/payments/credits | aging read model reconciled to receivable ledger | Sales Order total alone |
| Supplier aging | payable ledger + allocations/payments | aging read model reconciled to payable ledger | Purchase Order total alone |
| Gross margin | locked sales basis + Phase 7 realized costing facts | reconciled gross-margin projection | current product cost, price list or UI subtraction |
| Employee master | `shared.employees` and canonical branch relation | reporting dimension projection | display-name matching |
| MCP field performance | MCP-owned route/session/visit/outlet/order-intent facts | read-only cross-domain reporting projection | assuming field outlet is a Core customer |
| Delivery/logistics | trip/stop/attempt + Delivery Order source | logistics reporting projection | trip card state alone |
| COD | collection -> handover -> acceptance/accounting lineage | Phase 6F/COD reconciliation projections where definitions match | delivery status alone |
| Audit/activity | canonical audit/outbox records | filtered reporting projection | application logs as business history |
| Import/export history | canonical Phase 8 job metadata once introduced | reporting history view | browser download history |
| Admin control tower | approved aggregates from the report families above | scoped control-tower projection | duplicated Admin CRUD state |

### Source-map rule

A Phase 8 metric specification is incomplete unless it states:

1. metric name and business meaning;
2. canonical source rows/documents;
3. inclusion/exclusion lifecycle states;
4. business date basis;
5. dimension keys;
6. money/quantity/currency rule;
7. scope rule;
8. rebuild/live/snapshot mode;
9. drill-down target;
10. reconciliation assertion.

## 4. Scope contract

### 4.1 Installation

- `installationId` is always server-owned from request context.
- Reporting APIs must never accept an authoritative installation id from query/body/header supplied by a browser.
- Every query/read model row must remain installation-scoped.

### 4.2 Warehouse

- Warehouse-bound metrics must intersect requested warehouses with authorized `requestContext.scopes.warehouseIds`.
- A requested warehouse outside the authorized set fails closed; it is not silently broadened.
- Empty authorized warehouse scope fails closed for warehouse-bound end-user reports.
- Infrastructure/bootstrap compatibility is not an end-user role model and must not be used to justify broad reporting access.

### 4.3 Branch

- Branch is canonical through `shared.branches` and `shared.warehouses.branch_id` for warehouse-backed Core facts.
- A branch filter must resolve to canonical branch ids and then authorized warehouses/source rows.
- Branch access does not imply all warehouses unless the authorization context explicitly grants them.

### 4.4 Territory

- Territory is a separate concept from branch and warehouse.
- Do not infer territory from branch, warehouse, address text or salesperson name.
- Until a stable canonical territory key is present in the relevant MCP/field source, a territory filter must be rejected as unsupported rather than produce guessed numbers.
- Phase 8.4 must document the exact MCP territory lineage before enabling territory-scoped metrics.

### 4.5 Admin control tower

- Admin does not get installation-wide detail merely because it is the Admin app.
- `control-tower` permission may expose only explicitly approved aggregate cards/warnings within its granted scope.
- Drill-down remains subject to the relevant detailed report/source permission.

## 5. Reporting permission contract

Phase 8 locks a dedicated deny-by-default reporting namespace. Role-to-permission assignment remains an Access-track concern.

Permission keys reserved for implementation slices:

- `core.reporting.sales.read`;
- `core.reporting.purchasing.read`;
- `core.reporting.inventory.read`;
- `core.reporting.aging.read`;
- `core.reporting.gross-margin.read`;
- `core.reporting.employee-mcp.read`;
- `core.reporting.logistics.read`;
- `core.reporting.cod.read`;
- `core.reporting.audit-history.read`;
- `core.reporting.control-tower.read`;
- `core.reporting.export`.

Rules:

1. Every reporting endpoint must require its explicit reporting permission at the backend.
2. Unknown permission keys fail closed through the existing permission registry behavior.
3. UI navigation/buttons may mirror permissions for usability, but backend authorization remains authoritative.
4. `core.reporting.export` never grants report access by itself. Export requires both `core.reporting.export` and the report-family read permission.
5. Viewing a reporting aggregate does not automatically grant access to the underlying canonical detail endpoint. Drill-down must reauthorize the target resource using the applicable permission contract.
6. `core.reporting.control-tower.read` permits only the approved management aggregate catalog. It does not imply every detailed report permission.
7. No Phase 8.0 change bulk-assigns these permissions to existing roles.
8. A current `Permission denied` remains correct when the principal has not been granted the required permission/scope.

## 6. Business date, timezone and period boundaries

### 6.1 Locked timezone

- business timezone: `Asia/Ho_Chi_Minh`;
- stored event timestamps remain `timestamptz`/UTC-capable source values;
- calendar grouping uses the locked business timezone on the server.

### 6.2 Date filters

For timestamp-backed facts:

- `from` means local `00:00:00` inclusive in `Asia/Ho_Chi_Minh`;
- `to` means the next local day `00:00:00` exclusive;
- convert these boundaries to instants before comparing timestamp source columns;
- do not implement `timestamp::date` using the database/session timezone as an implicit business rule.

For canonical `date` columns, compare calendar dates directly.

### 6.3 Periods

- reporting day/week/month boundaries are business-timezone calendar boundaries;
- costing month follows the immutable Phase 7 costing period dates;
- CLOSED costing periods use closed snapshots/locked facts and must not be silently recomputed into a different historical number;
- late corrections follow the Phase 7 forward-correction/adjustment contract.

## 7. Decimal, money, currency and rounding

1. Database source numeric precision remains authoritative.
2. Quantity reporting preserves source precision; Phase 7 costing quantities are `numeric(30,12)`.
3. Cost/unit-cost/value reporting preserves Phase 7 `numeric(38,12)` precision until presentation.
4. API decimal values are represented losslessly; Phase 8 code must not perform business arithmetic with JavaScript `Number`.
5. Client formatting may round for display only; rounded display values must never be written back or reused as aggregate input.
6. Currency is always explicit on money metrics.
7. Never sum different currencies into one money total without an explicitly locked FX/base-currency conversion source.
8. Phase 7 costing is VND; do not invent FX costing in Phase 8.
9. VND may display with zero fractional digits where product presentation requires it, while source precision remains unchanged.

## 8. Live query, rebuildable read model and snapshot semantics

### Live query

Use when the metric can be computed safely from indexed canonical facts within the report latency target.

A live query:

- reads canonical source directly or a pure SQL view;
- has no hidden asynchronous lag;
- returns `generatedAt/asOf` metadata;
- is never cached publicly.

### Rebuildable read model

Use when repeated joins/aggregation would be too expensive or when a stable cross-domain projection is needed.

A rebuildable model:

- is derived only from canonical facts;
- has a deterministic definition/version;
- has a rebuild path;
- stores/returns a source watermark or equivalent `sourceThrough` marker;
- exposes `refreshedAt` and staleness state;
- has reconciliation tests against canonical source;
- can be deleted/rebuilt without losing business truth.

### Snapshot

Use only when the business meaning itself is "as closed/as generated at that point in time", for example:

- CLOSED costing-period balances;
- immutable export job parameters/result metadata;
- explicitly versioned management snapshots if introduced later.

A snapshot must record its source/as-of identity. It must not silently replace live operational truth.

## 9. Refresh, rebuild, cache and staleness

- Authenticated operational reporting defaults to `Cache-Control: no-store` unless a later slice proves a safe private scoped cache contract.
- CDN/public cache must not hold permission-scoped reporting responses.
- Read-model freshness is determined by source watermark/rebuild state, not only by wall-clock age.
- A report backed by a read model must expose enough metadata to tell whether it is current, rebuilding or stale.
- Stale data must be labeled; the API/UI must not present it as current without disclosure.
- A failed rebuild keeps the last valid projection identifiable as stale and surfaces the rebuild error through sanitized operational status; it does not corrupt canonical source.
- Rebuild is an explicit permissioned operation when exposed. A GET report must not trigger a hidden destructive rebuild.

## 10. Drill-down and lineage contract

Every KPI/table aggregate must support this conceptual chain:

`KPI -> grouped reporting row -> source identity -> canonical document/ledger/fact`

A report-family implementation must expose stable source identifiers needed for drill-down, for example:

- Sales Order / Delivery Order ids and numbers;
- PO / Goods Receipt ids and numbers;
- inventory movement + movement-line ids;
- cost fact / adjustment / period ids;
- receivable/payable document or ledger ids;
- trip/stop/attempt ids;
- MCP route/session/visit/outlet/order-intent ids;
- audit/job ids.

Rules:

- never drill down by fragile display text alone;
- snapshot labels such as customer/product/warehouse names are presentation aids, not entity identity;
- source drill-down is reauthorized;
- a metric without reproducible source lineage does not pass its Phase 8 slice gate.

## 11. Pagination, filter and sort contract

### Lists

- Large report detail lists use stable cursor/keyset pagination, not unbounded responses.
- Default page size: `100`.
- Maximum interactive page size: `200` unless a slice documents a smaller safe maximum.
- Cursor ordering must include a unique deterministic tie-breaker.
- Aggregate summary blocks are not paginated, but their drill-down lists are.

### Filters

- Server validates every filter.
- Scope filters are intersected with authorized server-owned scope.
- Search text has explicit length limits and parameterized queries.
- Date filters follow Section 6.
- Unsupported dimensions fail validation instead of being silently ignored.

### Sort

- Sort fields/directions come from an endpoint allowlist.
- Never interpolate an arbitrary client SQL column/expression.
- Default sort must be deterministic.

## 12. Export contract

An official Phase 8 export is a server-authorized reproduction of a report query, not a dump of browser state.

Every official export must record at least:

- installation id;
- actor/request/source app;
- report family + report definition/version;
- normalized filters/sort;
- authorized effective scopes;
- business timezone;
- `asOf`/source watermark;
- requested format;
- row count;
- status and timestamps;
- result checksum/object identity when a file is persisted;
- sanitized failure code when unsuccessful.

Authorization rules:

- re-check current authentication when export is requested;
- require report-family read permission + `core.reporting.export`;
- download/replay re-checks current authorization;
- an old successful export does not bypass a later permission revocation.

Execution rules:

- small synchronous exports may stream from the same server query pipeline when bounded;
- large exports use a persisted job and approved object-storage adapter;
- browser-generated CSV may remain for legacy convenience but is not the official Phase 8 export history.

## 13. Retention contract

- Generated export binary artifacts default to **30 days** retention unless a later owner-approved policy requires longer.
- Export/import job metadata remains after binary expiry so the action, parameters, actor, checksum/object identity and outcome stay auditable.
- Phase 8 does not introduce automatic deletion of canonical audit/outbox history.
- Any future purge policy must be explicit, permissioned, auditable and separate from report generation.
- Read models may be rebuilt/pruned according to their projector contract because they are not business truth.

## 14. API and error contract

Phase 8 uses the existing Core HTTP contract:

- success: existing `createSuccessEnvelope`;
- failure: existing sanitized `createErrorEnvelope`;
- `x-request-id` on responses;
- request correlation through existing request context;
- no raw SQL/provider/internal exception leakage.

Reporting payload metadata should consistently expose, where applicable:

- `generatedAt`;
- `asOf`;
- `timezone`;
- `dataMode`: `live | read_model | snapshot`;
- `refreshedAt` / `sourceThrough` for read models;
- `stale` and a sanitized `staleReason` when not current;
- normalized filters and effective scope summary.

Expected authorization failures are not reported as generic 500 errors.

## 15. Migration and production boundary

Phase 8.0 is documentation/source-lock only. It creates no database or runtime deployment requirement.

For Phase 8.1–8.7:

- schema/read-model changes are migrations in the owning domain/reporting directory;
- migrations must clean-apply and rerun safely according to repository migration rules;
- no production DB edit by hand;
- source merge does not authorize production migration/deploy;
- runtime deploy follows actual diff ownership;
- `npp-core/**` never implies MCP backend deploy;
- `mcp/**` never implies Core backend deploy;
- frontend-only changes do not trigger backend deploy;
- Auto Deploy remains OFF.

Any production DB mutation still requires:

`audit pending -> backup -> restore rehearsal -> pre-reconciliation -> migration -> verify/rerun -> post-reconciliation -> smoke`

## 16. Implementation gate for Phase 8.1–8.7

A later slice may start only if it obeys this decision lock.

Each report/metric added in Phase 8.1–8.7 must ship with:

- source definition;
- permission + scope tests;
- timezone/period tests where relevant;
- decimal/currency tests where relevant;
- deterministic pagination/filter/sort tests for detail lists;
- drill-down lineage tests;
- rebuild/reconciliation tests for derived models;
- export authorization/reproducibility tests when export is introduced;
- Core API/front-end/browser regression appropriate to the diff;
- exact-head CI before merge.

Do not change a canonical ledger/document lifecycle merely to make a report easier to build.

## 17. Explicit non-goals of Phase 8.0

Phase 8.0 does not:

- build Sales/Purchasing dashboards;
- create a generic BI warehouse;
- add general ledger/accounting scope;
- assign reporting permissions to every role;
- invent MCP territory identity;
- migrate/deploy production;
- change provider architecture;
- absorb PR #234;
- replace Phase 7 costing decisions.

## 18. Source gate conclusion

Phase 8.0 is considered source-locked when this document is merged with exact-head CI green and no valid unresolved finding.

After that gate, the next allowed implementation slice is **Phase 8.1 — Sales + Purchasing dashboards**, on a fresh branch from the then-current `main`.
