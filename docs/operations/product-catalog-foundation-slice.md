# Phase 3.3C — Product Catalog Foundation

> Status: implementation in progress on `agent/product-catalog-foundation`  
> Production deployment: excluded

## Purpose

Create stable product master identities for NPP Core and future catalog consumers without prematurely implementing units, conversions, barcodes, prices or R2 media.

Business source material:

- `BANG_GIA_CHUAN_HOA_CAP_NHAT_DS_SP_23.07.26.xlsx`;
- `BANG_GIA_KENH_QUAN_THEM_NHOM_CHI_TIET.xlsx`;
- `docs/operations/product-catalog-pricing-decisions.md`.

The workbooks are source material, not the database schema. Import must use a reviewed normalized JSON contract and must not parse Excel in the browser.

## Scope

Tables:

- `shared.product_categories`;
- `shared.product_brands`;
- `shared.products`;
- `shared.product_variants`.

Permissions:

- `core.product.read`;
- `core.product.write`.

Canonical route:

- `/products`.

## Locked data rules

- Canonical product IDs and variant IDs are immutable UUIDs.
- Product code and SKU are immutable after creation.
- Codes and SKUs are normalized uppercase and unique per installation.
- Category, brand, product and variant queries are installation scoped.
- No hard-delete endpoint and no cascading delete.
- Category hierarchy must reject self-parenting and cycles.
- An inactive category or brand cannot be newly assigned.
- A category or brand cannot be deactivated while active products depend on it.
- A product cannot be deactivated while it still has active variants.
- A product may have at most one active inventory-base variant.
- An inventory-base variant must have `variant_kind=BASE`.
- A catalog-visible variant must be sellable.
- A product cannot be made orderable without an active sellable variant.
- Catalog visibility and ordering availability are explicit; missing price or image does not imply either state.

## Explicit exclusions

Phase 3.3C does not create:

- units or conversion factors;
- barcodes;
- retail/carton price columns;
- price lists or channel price resolution;
- inventory balances or movements;
- supplier-product purchasing terms;
- R2 upload or product media management;
- production migration or deployment;
- MCP changes.

Those capabilities remain in Phase 3.3D, 3.3E or later slices.

## API contract

Categories:

```text
GET    /api/product-categories
POST   /api/product-categories
GET    /api/product-categories/:id
PATCH  /api/product-categories/:id
```

Brands:

```text
GET    /api/product-brands
POST   /api/product-brands
GET    /api/product-brands/:id
PATCH  /api/product-brands/:id
```

Products and variants:

```text
GET    /api/products
POST   /api/products
GET    /api/products/:id
PATCH  /api/products/:id
GET    /api/products/:id/variants
POST   /api/products/:id/variants
PATCH  /api/products/:id/variants/:variantId
POST   /api/products/import
```

All POST routes require `Idempotency-Key`. All PATCH routes require `expectedUpdatedAt`.

The import endpoint accepts normalized JSON only. It is atomic, installation scoped, idempotent and capped at 500 product rows per request. Existing codes/SKUs must match their immutable identity and parent relation; conflicts reject the transaction rather than silently remapping data.

## Authorization and audit

- Authentication uses the existing request context.
- Read routes require `core.product.read`.
- POST/PATCH/import routes require `core.product.write`.
- The client cannot supply installation ID, actor or permissions.
- Successful mutations write shared audit records in the same transaction.
- Idempotency replay must not duplicate rows or audit records.
- Public errors must not expose SQL, table/column names, stack traces, secrets or provider details.

## Frontend

The Vietnamese `/products` workspace must provide:

- product search and active/catalog/orderable filters;
- product create/edit/status;
- category and brand administration;
- variant/SKU administration under a product;
- clear disabled reasons and conflict reload;
- same-origin server-only gateway;
- no direct database or Core bearer-token access from the browser.

## Verification gate

Required before merge:

- migration apply, verify, rerun no-op and rehearsal;
- category hierarchy/cycle tests;
- duplicate code and SKU race coverage;
- installation isolation;
- immutable code/SKU behavior;
- stale `expectedUpdatedAt` conflicts;
- relation and deactivation guards;
- idempotent create and import;
- transactional audit coverage;
- deny-by-default 401/403 tests;
- Core web typecheck/unit/build;
- Chromium E2E against actual isolated PostgreSQL and Core API;
- `mcp/** = 0`;
- all PR review threads resolved.

Merge is not production deployment. Migrations `010`, `011` and `012` remain pending for the grouped Phase 3 backend/database rollout.
