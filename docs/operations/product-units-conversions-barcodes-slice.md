# Phase 3.3D — Product units, conversions and barcodes

> Status: merged by PR #49 at `623c9ccf9877191b6f9a49dc5df3bed3433e93c5`  
> Production deployment: excluded and intentionally deferred

## Purpose

Extend the Phase 3.3C product catalog with exact, product-specific quantity conversion and barcode identities without introducing prices or inventory transactions.

The product variant remains the canonical SKU/sell-unit identity. Phase 3.3D adds unit metadata and exact `conversion_to_base` to that identity instead of creating a second competing product-unit identity table.

## Source material

- `BANG_GIA_CHUAN_HOA_CAP_NHAT_DS_SP_23.07.26.xlsx` — canonical retail/carton SKU pairs and conversion counts.
- `BANG_GIA_KENH_QUAN_THEM_NHOM_CHI_TIET.xlsx` — normalized venue presentation/mapping context.
- `data/imports/product-units-conversions-2026-07-23-review-required.json` — the two blocked rows preserved for manual review.
- `docs/operations/product-units-data-audit-2026-07-27.md` — source audit, 604 importable rows and review flags.

The 604 clean rows are regenerated and reconciled during the controlled Phase 3 data-load rehearsal rather than committed as an opaque bulk snapshot.

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

The canonical `/products` workspace includes:

- unit catalog administration;
- product-list refresh without page reload;
- unit/conversion assignment per selected SKU;
- exact base-quantity preview;
- barcode list/create/status management;
- backend orderability guard when a sellable SKU lacks unit/conversion metadata.

The browser uses same-origin server-only gateways. It never receives the Core bearer token or database credentials.

## Source audit result

- 606 canonical conversion rows;
- 606 unique base SKUs and 606 unique converted SKUs;
- no duplicate or missing SKU pair;
- all conversion factors are positive integers;
- 604 rows are clean for controlled rehearsal import;
- 2 `THÙNG → THÙNG` rows remain blocked for business review;
- all 606 source barcode values equal the explicit converted SKU and are treated as `INTERNAL`, not inferred EAN/UPC values;
- physical weight differences are warnings only and never define inventory conversion.

## Explicit exclusions

- retail/carton/channel pricing — Phase 3.3E;
- inventory movements, balances or transaction posting;
- purchase/sales documents;
- R2 product media;
- production migration/import/deployment;
- `mcp/**` changes.

## Verification result

The merged code passed:

- migration apply and rerun;
- PostgreSQL API/service tests;
- installation isolation;
- immutable unit/barcode identities;
- exact quantity normalization;
- orderable guard requiring unit/conversion;
- idempotency and transactional audit;
- migration rehearsal;
- Core web typecheck, tests and production build;
- Chromium E2E through category → brand → product → SKU → unit → conversion → barcode → orderable flow;
- `mcp/** = 0`;
- no temporary payload or workbook-export workflow in the final diff.

Merge is not production deployment. Migrations `010` through `013` remain pending for the grouped Phase 3 backend/database rollout.
