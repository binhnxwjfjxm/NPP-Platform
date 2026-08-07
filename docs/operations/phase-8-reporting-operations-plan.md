# Phase 8 — Reporting & Operations Plan

Parent issue: #367

Baseline when this plan was created:

- repository: `binhnxwjfjxm/NPP-Platform`
- exact `main`: `ab3cf4056bf9b668fd9f7493192c8dbb42faa776`
- Phase 7 parent #328: closed `completed`
- production migration 063: applied; pending `[]`
- Core backend + NPP Operations Phase 7 rollout: successful
- open PR at baseline: #234; Phase 8 must not absorb its diff

This document defines only the Phase 8 execution plan and handoff. It does not implement reporting features.

## Product goal

Phase 8 turns the source documents, ledgers and rebuildable read models completed through Phase 7 into reproducible operational reporting.

Reports must always be traceable back to canonical source data. Dashboard cards, exports and cached aggregates are never sources of truth.

## Runtime ownership

- NPP Operations owns detailed internal reporting, filters, drill-down and exports.
- Admin MCP/NPP is a management control tower: combined totals, warnings, exceptions, small permissioned approvals and links to NPP drill-down. It must not duplicate full NPP CRUD.
- MCP Field remains the field operations app and supplies MCP-owned facts/read projections only.
- Delivery remains the delivery operations app and does not own canonical reporting.
- Core API owns reporting/read APIs for Core-owned domains.
- No frontend connects directly to PostgreSQL.

## Phase split

### 8.0 — Reporting foundation & decision lock

Before large schema/API/UI work, lock:

- metric source of truth;
- installation/branch/warehouse/territory scope;
- reporting permissions and deny-by-default rules;
- timezone, business date and period boundaries;
- decimal quantity/money/currency/rounding;
- live query vs rebuildable read model vs snapshot semantics;
- refresh/rebuild/staleness semantics;
- drill-down contract from KPI to source document/ledger;
- pagination/filter/sort/export contract;
- retention for export/history/audit;
- API/error envelope;
- migration and production boundary.

Do not start 8.1 until 8.0 reaches its source gate.

### 8.1 — Sales + Purchasing dashboards

- sales dashboard;
- purchase dashboard;
- volume/value/status trends;
- top customers/SKUs/suppliers;
- operational state breakdowns;
- drill-down to Sales Orders, Delivery Orders, Purchase Orders and Goods Receipts.

### 8.2 — Inventory reporting

- nhập-xuất-tồn;
- stock availability;
- warehouse/location/SKU/lot balances;
- inventory aging;
- slow-moving/exception views when justified by source data;
- drill-down to immutable movement/costing lineage.

### 8.3 — Customer/Supplier aging + Gross Margin

- customer aging;
- supplier aging;
- overdue buckets;
- gross margin after Phase 7 costing;
- reconciliation across sales basis, costing facts and receivable/payable ledgers.

This is not a general-ledger phase.

### 8.4 — Employee + MCP Field performance

- employee/field-route performance;
- visit/check-in/output metrics;
- outlet/order-intent/onboarding/order conversion using actual source facts;
- employee/territory scope;
- field outlet identity remains distinct from canonical Core customer.

### 8.5 — Delivery/Logistics performance

- trip performance;
- on-time delivery;
- failed/partial/rescheduled delivery;
- failed delivery reasons;
- vehicle/driver utilization;
- drill-down to trip/stop/attempt/Delivery Order.

### 8.6 — COD & operational reconciliation

- COD reconciliation when enabled;
- collection -> handover -> acceptance/accounting state;
- discrepancy and exception queues;
- controlled approval surfaces only where permission/domain decisions allow.

### 8.7 — Audit + Import/Export history + Admin control tower

- import/export history;
- audit/activity logs;
- management KPIs, warnings and exceptions;
- responsive Admin control tower;
- drill-down links to detailed NPP operational screens instead of duplicated CRUD.

## Permission boundary

A current `Permission denied` response is not automatically a product defect when the role is not intended/configured to access that capability.

Phase 8.0 completes only the reporting permission contract. It must not expand into a rewrite of the entire RBAC system.

Every reporting endpoint/surface must:

- deny by default at the backend;
- use server-owned installation and authorization context;
- enforce relevant branch/warehouse/territory scope;
- hide or disable UI navigation/actions according to the locked reporting permission contract;
- re-check current authorization for export/download/replay.

If whole-system role-to-permission configuration needs a broader completion track, create a separate Access task rather than swelling Phase 8.

## Source-of-truth rules

Canonical inputs may include:

- Sales Order / fulfillment / Delivery Order;
- Purchase Order / Goods Receipt;
- immutable inventory ledger and rebuildable balances;
- Phase 7 costing facts, period balances and reconciliation;
- receivable/payable ledgers and payment/allocation;
- logistics trip/stop/attempt;
- MCP field route/session/visit/outlet facts;
- audit/outbox/import-export job records.

Every aggregate/read model must have a documented definition and reconciliation test.

## Test gate per implementation slice

Where relevant:

- migration clean apply and rerun no-op;
- PostgreSQL integration;
- permission/scope fail-closed;
- fixed-point money/quantity;
- period/timezone edge cases;
- read-model rebuild/reconciliation;
- pagination/filter/sort;
- drill-down lineage;
- export contract;
- Core API regression;
- frontend interaction tests;
- browser E2E;
- exact-head CI before merge.

Do not change tests to hide reporting mismatches.

## Git and CI discipline

The next chat must work narrowly and finish each slice cleanly.

- Work from fresh `main` on `agent/phase-8-<slice>`.
- One vertical slice per branch/PR.
- Do not absorb unrelated PR/branch changes.
- Audit all failures/root causes before making a fix commit.
- **Collect all failures and fix them together once.** Do not push a stream of one-error-at-a-time commits.
- **No force-push.**
- **Do not rerun Actions repeatedly.** Multiple queued/rerun workflows are not a debugging strategy.
- If exact-head CI fails, collect all failing jobs/logs first, determine the complete root cause, then make one additive fix commit when possible.
- Rerun only when a known transient/infra failure justifies it or after a real fix; never rerun to hope for green.
- **Do not wait for CodeRabbit** when required/exact-head CI is green and there is no valid unresolved finding.
- **If exact-head CI is green and no valid finding remains, merge.** The owner has explicitly authorized this workflow for Phase 8 source PRs.
- After merge, verify exact `main`.
- Source merge does not authorize production migration/deploy. Production remains a separate gate unless explicitly requested.

## New-chat startup order

1. Read `NPP_PLATFORM_MASTER_PLAN.md`.
2. Read `docs/operations/master-plan-frontend-runtime-addendum.md`.
3. Read parent Issue #367 and this plan.
4. Read Phase 7 closeout/decision documents, especially costing decisions.
5. Audit reporting schema/read models/permissions/exports and current source contracts.
6. Audit exact `main`, open PR/branches and latest CI.
7. Briefly explain to the user what Phase 8.0 will do for operations.
8. Build the source-map/decision matrix.
9. Only then implement 8.0.

Work **đúng trọng tâm, không lan man**. Do not jump to 8.1 before 8.0 is closed.

## Production boundary

Current architecture remains:

- 5 Vercel frontends;
- 2 Heroku backends;
- 1 shared PostgreSQL installation.

Deployment follows actual diff ownership. Auto Deploy remains OFF.

Any production DB change must follow the repository gate:

`audit pending -> backup -> restore rehearsal -> pre-reconciliation -> migration -> verify/rerun -> post-reconciliation -> smoke`

Never paste secrets, DATABASE_URL or tokens into GitHub, chat, logs, screenshots or frontend code.
