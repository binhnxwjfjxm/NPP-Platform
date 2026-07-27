# Phase 3 — Split validation and rollout acceptance plan

> Status: required source/rehearsal gate for Phase 3 closeout  
> Production action: prohibited until every gate below has explicit evidence and a separate rollout authorization

## Purpose

Phase 3 contains operationally and financially sensitive master data. One combined CI result is necessary but not sufficient. Validation is split into independent packs; one failure blocks the grouped rollout even when every other pack passes.

## Required execution order

```text
Pack 1  Customers
Pack 2  Suppliers
Pack 3  Product catalog
Pack 4  Units, conversions and barcodes
Pack 5  Pricing — isolated financial pack
Pack 6  Document numbering
Pack 7  Cross-domain integration
Pack 8  Grouped migration rehearsal
```

Each pack records:

- exact commit SHA;
- database target and migration set;
- workflow run and commands;
- row counts and exceptions where relevant;
- PASS/FAIL status;
- unresolved or blocked source rows;
- reviewer or owner decision;
- retained artifacts;
- explicit statement that no production assumption was reused.

The repository workflow uses ephemeral PostgreSQL for source/rehearsal evidence. It does not replace the later rehearsal restored from a fresh production backup.

## Pack 1 — Customers

Validate independently:

- customer-group and customer code uniqueness per installation;
- lifecycle without hard delete;
- address ownership and primary-address rules;
- installation isolation;
- idempotent create and optimistic concurrency;
- audit records;
- `/customers` create, edit and filter flows.

## Pack 2 — Suppliers

Validate independently:

- supplier identity, contacts, addresses and payment terms;
- primary-child constraints;
- purchase-owner references;
- lifecycle and installation isolation;
- idempotency, optimistic concurrency and audit;
- `/suppliers` create, edit and filter flows.

## Pack 3 — Product catalog

Validate independently:

- category hierarchy and cycle prevention;
- brand, product and immutable SKU identity;
- one active inventory-base SKU per product;
- active, visible, sellable and orderable states;
- import replay and duplicate races;
- installation isolation and audit;
- `/products` catalog flow.

## Pack 4 — Units, conversions and barcodes

Validate independently:

- base conversion equals exactly `1`;
- converted SKU factors use fixed-scale exact arithmetic;
- quantity normalization and fractional-unit rules;
- barcode uniqueness and primary-barcode lifecycle;
- orderable guard requires complete unit/conversion metadata;
- 604 reviewed rows remain eligible for controlled rehearsal;
- two `THÙNG → THÙNG` rows remain blocked pending business decision;
- missing/zero descriptive net-content values remain warnings, never guessed conversions;
- import replay, installation isolation and audit;
- `/products` unit, conversion and barcode flow.

## Pack 5 — Pricing

This mandatory financial pack runs independently and requires explicit owner review before production readiness can be approved.

### Source reconciliation

Re-run the executable workbook audit and reconcile:

- 606 retail SKUs and 606 carton SKUs;
- 563 positive retail prices;
- 43 missing/zero retail prices blocked;
- 563 normalized carton prices;
- 168 original positive carton retail prices;
- 343 venue-channel mappings;
- 338 positive venue prices;
- five missing/zero venue prices blocked;
- 69 review-required rows blocked;
- one repeated channel SKU retained for deterministic source-key or manual review.

Missing or ambiguous amounts must never be guessed, copied, multiplied from another SKU or silently set to zero.

### Price behavior

Validate:

- retail/base and carton SKU prices are independent editable data;
- conversion changes never rewrite prices and price changes never rewrite conversion;
- base, channel, customer-group, customer, promotion and custom scopes;
- priority, exclusive, stackable and stop-processing rules;
- quantity boundaries and effective timestamps;
- inactive exclusions and scope mismatch;
- missing-base-price failure;
- manual override precedence with mandatory reason;
- explainable applied/skipped trace;
- VND integer storage, basis points, BigInt and deterministic half-up rounding;
- non-negative unit prices and exact line totals;
- installation isolation, idempotency, source-key replay, concurrency and audit;
- same-origin Basic Auth boundary;
- `/pricing` administration and simulator Chromium flow.

### Required pricing report

```text
Source audit status
Rehearsed row counts
Blocked row counts and identifiers
Retail/carton independence result
Resolver matrix result
Rounding result
Manual override result
UI simulator result
Owner decision: APPROVED / REJECTED / NEEDS DATA FIX
```

Pricing is not accepted merely because repository CI is green.

## Pack 6 — Document numbering

Validate independently:

- template syntax and deterministic rendering;
- reset/template compatibility at service and database levels;
- NONE, YEARLY and MONTHLY counters;
- backdated period isolation;
- parallel uniqueness and gap-free successful counters;
- HTTP and domain replay;
- replay transactions are read-only;
- inactive-series guard;
- width and absolute-counter overflow rollback;
- format lock after first allocation;
- append-only history;
- installation isolation, permissions and audit;
- `/document-numbering` Chromium flow.

## Pack 7 — Cross-domain integration

Validate combined behavior without posting transactions:

- customer groups and customers are selectable pricing scopes;
- product variants used by units and pricing are canonical and active;
- pricing refuses incomplete or non-priceable SKU metadata;
- document-number allocation remains independent from transaction creation;
- all server-only gateways preserve Basic Auth and hide backend credentials;
- `mcp/** = 0` for Core-only Phase 3 work;
- the full Core API and combined master-data Chromium flows pass on one exact SHA.

## Pack 8 — Grouped migration rehearsal

The repository gate runs migrations `002` through `016` on ephemeral PostgreSQL 17, reruns them, verifies canonical schema/permissions and runs the migration rehearsal contract.

This source-level Pack 8 does **not** authorize production. After Packs 1–7 pass, production readiness additionally requires:

1. Audit the actual Heroku PostgreSQL provider state.
2. Create and verify a fresh production backup.
3. Restore that backup to a temporary rehearsal target.
4. Reconcile the restored baseline.
5. Apply pending migrations `010` through `016` in order.
6. Re-run applicable Packs 1–7 against the restored rehearsal target.
7. Reconcile schema, permission metadata, row counts and blocked source rows.
8. Test the exact Core API build against the rehearsal database.
9. Prepare rollback and cutover checklists.
10. Obtain explicit owner approval for the pricing report.
11. Obtain separate production rollout authorization.

Historical backup or restore evidence must not be reused. A provider `READY` state alone is not deployment verification.

## Production verification after explicit authorization

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
/customers
/suppliers
/products
/pricing
/document-numbering
/_next/static actual asset
```

Run API and UI smoke tests pack-by-pack after deployment. Repeat pricing as a standalone financial smoke pack. Create a post-migration backup and confirm automatic deployments remain disabled.
