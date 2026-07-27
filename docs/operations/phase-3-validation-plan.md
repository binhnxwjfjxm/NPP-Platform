# Phase 3 — Split validation and rollout acceptance plan

> Status: required gate after Phase 3.3F merges  
> Production action: prohibited until every pack below has explicit evidence

## Purpose

Phase 3 contains financially and operationally sensitive master data. A single combined CI result is necessary but is not sufficient evidence for production rollout.

Validation must be executed and reported as independent packs. A failure in one pack blocks the grouped rollout even when all other packs pass.

## Required execution order

```text
Pack 1  Customers
Pack 2  Suppliers
Pack 3  Product catalog
Pack 4  Units, conversions and barcodes
Pack 5  Pricing — isolated financial pack
Pack 6  Document numbering
Pack 7  Cross-domain integration
Pack 8  Grouped migration and production-readiness rehearsal
```

Each pack must record:

- exact commit SHA;
- database target and migration set;
- test command/workflow run;
- before/after row counts and exception counts where relevant;
- PASS/FAIL status;
- unresolved review rows;
- reviewer/owner decision;
- evidence links or retained artifacts;
- explicit statement that no production assumption was reused.

## Pack 1 — Customers

Validate independently:

- customer-group and customer code uniqueness per installation;
- active/inactive lifecycle and no hard delete;
- address ownership and primary-address rules;
- installation isolation;
- idempotent create and optimistic-concurrency update;
- audit records;
- UI create/edit/filter flows.

## Pack 2 — Suppliers

Validate independently:

- supplier codes, contacts, addresses and terms;
- primary-child constraints;
- purchase-owner references;
- lifecycle guards and installation isolation;
- idempotency, optimistic concurrency and audit;
- UI create/edit/filter flows.

## Pack 3 — Product catalog

Validate independently:

- category hierarchy and cycle prevention;
- brand/product/SKU identities;
- one active inventory-base SKU per product;
- immutable code/SKU behavior;
- catalog, sellable, active and orderable states;
- import replay and duplicate races;
- installation isolation and audit;
- `/products` CRUD flow.

## Pack 4 — Units, conversions and barcodes

Validate independently:

- base SKU conversion equals exactly `1`;
- converted SKU factors use fixed-scale exact arithmetic;
- quantity normalization and fractional-unit rules;
- barcode uniqueness and primary-barcode lifecycle;
- orderable guard requires complete SKU/unit/conversion metadata;
- 604 reviewed rows import cleanly;
- two `THÙNG → THÙNG` rows remain blocked pending business decision;
- 159 missing/zero descriptive net-content rows remain warnings rather than guessed values;
- import replay, installation isolation and audit;
- `/products` unit/conversion/barcode flow.

## Pack 5 — Pricing (mandatory isolated financial test pack)

This pack is mandatory and must run independently from general master-data tests. It requires explicit owner review before Pack 8.

### Source reconciliation

Re-run the executable workbook audit and reconcile:

- 606 retail SKUs and 606 carton SKUs;
- 563 positive retail prices;
- 43 missing/zero retail prices blocked;
- 563 normalized carton prices;
- 168 original positive carton retail prices;
- 343 venue-channel mappings;
- 338 positive venue-channel prices;
- five missing/zero venue prices blocked;
- 69 review-required rows blocked;
- one repeated channel SKU resolved only by an approved deterministic source key or retained for manual review.

No missing or ambiguous amount may be guessed, copied from another SKU, multiplied from retail price or silently set to zero.

### Price-model behavior

Test exact SKU-level independence:

- retail/base SKU price is editable data;
- carton SKU price is independent and never derived from retail price × conversion;
- changing conversion never rewrites price;
- changing price never rewrites conversion.

Test all scopes separately and in combinations:

- base;
- channel;
- customer group;
- customer-specific;
- promotion;
- custom/admin/code-created policy.

Test resolver behavior:

- priority ordering;
- exclusive rules;
- stackable rules;
- stop-processing;
- quantity tiers and boundary values;
- effective start/end timestamps;
- inactive list/item exclusion;
- customer/group/channel matching and mismatch;
- missing base price failure;
- manual override precedence and mandatory reason;
- full explainable trace of applied and skipped rules.

Test financial arithmetic independently:

- VND integer minor units only;
- basis-point percentages;
- BigInt arithmetic;
- deterministic half-up rounding;
- discounts never produce negative unit price;
- exact line totals for representative quantities;
- large values remain within supported integer limits;
- no JavaScript floating-point money calculation.

Test lifecycle and safety:

- installation isolation;
- idempotent create/import replay;
- source-key update without duplicate rows;
- optimistic-concurrency conflicts;
- audit records;
- same-origin gateway and Basic Auth;
- `/pricing` administration and simulator Chromium flow.

### Pricing acceptance report

The pricing pack must produce a standalone report containing:

```text
Source audit status
Imported/rehearsed row counts
Blocked row counts and identifiers
Retail/carton independence result
Resolver matrix result
Rounding test result
Manual override result
UI simulator result
Owner decision: APPROVED / REJECTED / NEEDS DATA FIX
```

Pricing is not accepted merely because the repository CI is green.

## Pack 6 — Document numbering

Validate independently:

- template token validation and rendering;
- reset policies NONE/YEARLY/MONTHLY;
- backdated period isolation;
- parallel allocation uniqueness and gap-free successful counters;
- domain and HTTP idempotency replay;
- inactive-series guard;
- width overflow rollback;
- format lock after first allocation;
- immutable allocation history;
- installation isolation, permission and audit;
- `/document-numbering` Chromium flow.

## Pack 7 — Cross-domain integration

Validate references and combined behavior without posting transactions:

- customers/groups are selectable by pricing scopes;
- product variants used by units and pricing are canonical and active;
- pricing refuses incomplete/non-priceable SKU metadata;
- document-number allocation remains independent from transaction creation;
- all server-only gateways preserve Basic Auth and hide backend credentials;
- `mcp/** = 0` for Core-only Phase 3 work.

## Pack 8 — Grouped migration and production-readiness rehearsal

Only after Packs 1–7 pass:

1. Audit the actual Heroku PostgreSQL provider state.
2. Create and verify a new production backup.
3. Restore it to a temporary rehearsal PostgreSQL target.
4. Apply migrations `010` through `015` in order.
5. Re-run Packs 1–7 against the rehearsal target where applicable.
6. Reconcile schema, permissions, row counts and blocked-source rows.
7. Test actual Core API build against the rehearsal database.
8. Prepare a rollback/cutover checklist.
9. Obtain owner approval for the isolated pricing report.
10. Only then perform the separately authorized production rollout.

Historical backup/restore evidence must not be reused. READY status alone is not deployment verification.

## Production verification after explicit rollout authorization

Backend:

```text
/health/live
/health/ready
```

Frontend:

```text
/
/dashboard
/login
/products
/pricing
/document-numbering
/_next/static actual asset
```

Run smoke tests pack-by-pack after deployment, with pricing repeated as a standalone financial smoke pack.
