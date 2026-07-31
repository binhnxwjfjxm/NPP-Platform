# Phase 6B.1 — Sales Order Operational UX Contract

> Status: ACTIVE IMPLEMENTATION CONTRACT  
> Issue: #121  
> Baseline: `main@cf5ea2f2fbfd47977b4228d625a6002b7226282f`  
> Production deploy/migration: NOT AUTHORIZED

## Goal

Turn the Phase 6B Sales Order foundation into an operational order-entry surface for NPP Operations without expanding into fulfillment, delivery, receivable, payment or MCP work.

## Locked boundaries

- Work only in `npp-core/**`, `database/**`, shared packages when genuinely required, and this document.
- `mcp/**` must remain unchanged.
- Core backend deploy target remains `hung-phat`; MCP backend `hung-phat-mcp` is out of scope.
- No production deploy, production migration, provider change or secret mutation.
- Reuse existing customer, product/SKU/barcode, pricing, exact-decimal, permission, idempotency, audit/outbox and migration foundations.

## 1. Operational layout

Desktop order entry is a near-full-screen work surface:

- width approximately `96vw`, capped near `1440px`;
- height approximately `94vh`;
- sticky header and action footer;
- middle content scrolls vertically;
- no horizontal scrollbar at `1366x768`;
- compact order header in at most two desktop rows;
- optional note and uncommon settings live under expandable “Thông tin thêm”;
- item entry and order lines receive most of the available space;
- tablet/mobile use responsive cards and never squeeze the desktop grid.

## 2. Customer modes

The UI exposes:

```text
Khách đã có | Khách vãng lai
```

### Existing customer

- searchable by code, name and phone where data supports it;
- active installation-scoped customers only;
- address remains customer-owned and validated by Core.

### Walk-in customer

- pickup may use an installation-configured system walk-in customer;
- never hardcode customer UUID or installation-specific code in application logic;
- order stores optional walk-in display-name and phone snapshots;
- walk-in orders cannot use `CREDIT_TERMS`;
- walk-in pricing does not use customer-specific rules;
- delivery requires quick creation of a real customer and address inside the order flow;
- quick creation performs duplicate-phone lookup before create;
- customer/address create is idempotent, permissioned and audited through Core API;
- one quick-create attempt keeps stable customer/address idempotency keys across retry and rotates them only after complete success or a clearly new attempt;
- do not create anonymous customer records for every cash sale.

If no installation-level walk-in customer configuration exists, add a forward-only migration/config contract and bootstrap/admin validation. Fail closed when the configured customer is missing or inactive.

## 3. Unified item search

Replace the chained parent-product and SKU selects with one search control.

Search keys:

- product name;
- product code;
- SKU;
- barcode.

Results contain only active, orderable, sellable variants with a valid sell unit and show:

```text
SKU — product/variant name — sell unit
```

Keyboard behavior:

- arrows move through results;
- Enter selects;
- quantity receives focus;
- Enter adds the line;
- focus returns to search;
- duplicate SKU follows an explicit merge-or-reject contract and never silently double-counts.

Search must be server-backed when the catalog can exceed a small in-memory list. Do not ship the full catalog to the browser merely to filter locally.

## 4. Server pricing preview

As soon as customer mode/context, SKU, unit, quantity and effective date are known, call a Core pricing-preview boundary.

Display:

- base price;
- channel/customer-group/customer adjustment when applicable;
- applied price list/rule or promotion names;
- ordered adjustment trace;
- final unit price;
- estimated line amount;
- blocked/no-price state.

Rules:

- Core remains authoritative;
- browser does not reproduce pricing logic or use JS float for business money;
- preview and save must share the same resolver and canonical context;
- save/confirm re-resolve and snapshot provenance;
- manual price override is shown only with `core.sales-order.price.override` and requires a reason;
- a preview mismatch at save returns a clear refresh/review state rather than silently changing the commercial result.

## 5. Tax and totals UX

Tax is not a normal per-line data-entry burden.

- remove tax mode and tax rate from the fast-add row;
- Core resolves the default tax treatment from canonical configuration;
- valid explicit tax values from an existing trusted API contract remain compatible; missing/null/blank values use the same Core default regardless of whether an installation settings row already exists;
- backend continues to calculate and snapshot exact per-line tax;
- UI exposes per-line tax detail only in an expandable advanced view;
- order summary shows subtotal, discount, tax and total;
- tax override, if supported, is exceptional, permissioned, reasoned and audited;
- no client-side float arithmetic is authoritative.

## 6. Order lines

Each line shows at minimum:

- SKU and name;
- sell unit;
- quantity;
- base price;
- applied pricing summary;
- final unit price;
- discount;
- tax summary;
- line total;
- remove/edit controls.

The line area must remain usable with many items and must not force whole-modal horizontal scrolling.

## 7. Final actions

```text
Đóng | Lưu nháp | Lưu và xác nhận
```

- `Lưu và xác nhận` appears only with confirm permission;
- it uses the existing idempotent create/update/confirm lifecycle;
- before confirmation the user can review customer, lines, pricing trace, tax and final total;
- document numbering, immutable versions, revision guards and audit/outbox remain unchanged.

## 8. API and persistence expectations

Implementation may add narrowly scoped endpoints/contracts for:

- customer/product/SKU/barcode search;
- duplicate-phone lookup and quick customer creation;
- pricing/tax preview;
- installation walk-in-customer configuration;
- save-and-confirm orchestration without weakening idempotency.

Schema changes require forward-only migrations and PostgreSQL 17 rehearsal tests. Do not mutate production DB manually.

## 9. Tests and acceptance

Required:

- viewport `1366x768`: no whole-modal horizontal scrollbar;
- desktop, tablet and mobile layout contracts;
- walk-in pickup with configured system customer;
- walk-in credit denial;
- delivery quick-customer creation and duplicate-phone handling;
- stable quick-customer/address retry idempotency;
- unified search by name, product code, SKU and barcode;
- keyboard add-line flow;
- pricing preview with base price, applied rules and final price;
- no-price/blocked pricing fail-closed;
- exact scaled arithmetic for per-unit discount preview;
- tax hidden from fast entry and visible in totals/details;
- Core-owned tax defaults remain consistent before and after settings-row creation;
- exact totals from server response;
- save draft and save-and-confirm permission/idempotency flows;
- API regression, web unit tests and browser E2E;
- exact-head CI green;
- `mcp/** changed files = 0`.

## Explicit exclusions

- MCP frontend/backend changes;
- `hung-phat-mcp` deployment;
- inventory reservation, allocation, pick/pack or lot execution;
- Delivery Order, trip or POD;
- receivable, payment, COD or electronic invoice;
- new promotion rule families beyond the existing pricing engine;
- production rollout.
