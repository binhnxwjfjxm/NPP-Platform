# Phase 3.3D — Product units, conversions and barcodes

> Status: implementation in progress on `agent/product-units-conversions-barcodes`  
> Production deployment: excluded and intentionally deferred

## Purpose

Extend the Phase 3.3C product catalog with exact, product-specific quantity conversion and barcode identities without introducing prices or inventory transactions.

The product variant remains the canonical SKU/sell-unit identity. Phase 3.3D adds unit metadata and exact `conversion_to_base` to that identity instead of creating a second competing product-unit identity table.

## Source material

- `BANG_GIA_CHUAN_HOA_CAP_NHAT_DS_SP_23.07.26.xlsx` — canonical retail/carton SKU pairs and conversion counts.
- `BANG_GIA_KENH_QUAN_THEM_NHOM_CHI_TIET.xlsx` — normalized venue presentation/mapping context.
- `data/imports/product-units-conversions-2026-07-23-review-required.json` — the two blocked rows preserved for manual review.
- `docs/operations/product-units-data-audit-2026-07-27.md` — source audit, 604 importable rows and review flags.

The full 604-row normalized payload is intentionally generated and reconciled during the controlled Phase 3 data-load rehearsal rather than committed as an opaque bulk snapshot.

## Data model

### `shared.units_of_measure`

Installation-scoped unit catalog:

- immutable normalized `code`;
- display name and optional symbol;
- `unit_kind`: `COUNT`, `WEIGHT`, `VOLUME`, `PACKAGE`, `OTHER`;
- `allows_fractional` controls quantity validation;
- active/inactive lifecycle; no hard delete.

### Extended `shared.product_variants`

Each SKU/variant may carry:

- `unit_id`;
- exact `conversion_to_base numeric(20,6)`;
- `is_purchasable`;
- optional net-content value/unit;
- original source unit label and package description;
- source metadata.

Rules:

- unit and conversion are assigned together;
- conversion is positive;
- the active inventory-base variant uses conversion `1`;
- one product cannot have two active variants using the same canonical unit;
- one active inventory-base variant remains enforced by Phase 3.3C;
- an orderable product requires an active sellable variant with a valid unit/conversion assignment.

### `shared.product_barcodes`

- barcode belongs to a product variant/SKU;
- installation-scoped normalized barcode uniqueness;
- optional barcode type;
- at most one active primary barcode per variant;
- lifecycle only; no hard delete or reuse by another SKU.

## Quantity normalization

`baseQuantity = enteredQuantity × conversionToBase`

Both operands are validated decimal strings. Calculation uses exact fixed-scale integer arithmetic, not JavaScript floating point. The normalization endpoint returns the entered quantity, conversion snapshot and exact base quantity. Future document lines must persist those snapshots.

## API contract

Units:

```text
GET    /api/units
POST   /api/units
GET    /api/units/:id
PATCH  /api/units/:id
```

Variant unit assignment and normalization:

```text
GET    /api/products/:productId/variants/:variantId/unit
PATCH  /api/products/:productId/variants/:variantId/unit
POST   /api/products/:productId/variants/:variantId/normalize-quantity
```

Barcodes:

```text
GET    /api/products/:productId/variants/:variantId/barcodes
POST   /api/products/:productId/variants/:variantId/barcodes
PATCH  /api/products/:productId/variants/:variantId/barcodes/:barcodeId
```

Reviewed import:

```text
POST   /api/product-units/import
```

All mutating POST routes require `Idempotency-Key`. All PATCH routes require `expectedUpdatedAt`. The import is atomic and rejects rows with non-empty `blockingReview`.

## Authorization and audit

- reads require `core.product.read`;
- mutations/import require `core.product.write`;
- all queries are installation scoped;
- successful mutations write one shared transactional audit record;
- idempotency replay does not duplicate rows or audit;
- public errors are sanitized.

## Frontend

The canonical `/products` workspace gains:

- unit catalog administration;
- unit/conversion assignment per selected SKU;
- exact base-quantity preview;
- barcode list/create/status management;
- clear warning when a product cannot be orderable because a sellable SKU lacks unit/conversion metadata.

The browser uses same-origin server-only gateways. It never receives the Core bearer token or database credentials.

## Explicit exclusions

- retail/carton/channel pricing — Phase 3.3E;
- inventory movements, balances or transaction posting;
- purchase/sales documents;
- R2 product media;
- production migration/import/deployment;
- `mcp/**` changes.

## Verification gate

Before merge:

- migration apply, rerun no-op, verify and rehearsal;
- installation isolation;
- unit-code and barcode duplicate races;
- immutable unit codes and barcode ownership;
- one active primary barcode per variant;
- base conversion exactly `1`;
- exact decimal normalization without floating-point drift;
- orderable guard requires unit/conversion;
- atomic reviewed import and idempotent replay;
- transactional audit coverage;
- Core web typecheck/unit/build;
- Chromium E2E against actual isolated PostgreSQL and Core API;
- `mcp/** = 0`;
- temporary workbook-export workflow removed from the final diff.

Merge is not production deployment. Migrations `010` through `013` remain pending for the grouped Phase 3 backend/database rollout.
