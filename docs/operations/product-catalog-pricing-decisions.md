# Phase 3 Master Data — Product Catalog, Units, Pricing and Media Decisions

> Status: LOCKED FOR IMPLEMENTATION  
> Updated: 2026-07-27  
> Scope: NPP Core product master data and future customer self-ordering catalog

## 1. Business goal

Build one canonical product catalog that serves both:

- NPP Core admin workflows for filtering products and creating orders manually;
- a future customer self-ordering app;
- future product-image mapping to Cloudflare R2;
- inventory, purchasing, sales and pricing without duplicating product identities.

The catalog must not be designed as a UI-only spreadsheet copy. It must preserve stable canonical IDs, unit conversions and channel-specific prices.

## 2. Source workbooks

The current repository contains these business source files:

- `BANG_GIA_CHUAN_HOA_CAP_NHAT_DS_SP_23.07.26.xlsx`
- `BANG_GIA_KENH_QUAN_THEM_NHOM_CHI_TIET.xlsx`

Their roles are different and must remain explicit.

### 2.1 Canonical price/product workbook

Use `BANG_GIA_CHUAN_HOA_CAP_NHAT_DS_SP_23.07.26.xlsx` as the source for the detailed sellable-unit relationship where available, including:

- retail/base SKU;
- carton SKU;
- quantity of base units per carton;
- retail/base unit;
- carton unit;
- retail price;
- carton price and other price columns present in the workbook.

Do not generate carton SKU by appending `T` when the workbook already supplies a carton SKU. The `T` suffix is only a fallback suggestion for missing data and must remain editable and reviewable.

### 2.2 Normalized venue-channel workbook

Use `BANG_GIA_KENH_QUAN_THEM_NHOM_CHI_TIET.xlsx` as the normalized classification and presentation source for the venue channel, including:

- normalized product name;
- retail/base SKU;
- normalized category/group;
- base-unit description;
- conversion description;
- base unit;
- venue-channel price;
- matching/mapping hints;
- review status where present.

This workbook supports admin filtering, manual order creation and the future customer ordering catalog. It is not the sole source of carton SKU or carton conversion data.

## 3. Canonical unit model

### 3.1 Inventory source of truth

Inventory quantity is always stored and posted in the smallest inventory unit for each SKU/product variant.

Examples:

- bottle;
- can;
- pack;
- sachet;
- piece.

No inventory balance may be stored independently in both retail and carton units.

### 3.2 Product-specific conversions

Each product defines its own conversion. Examples:

- product A: `1 carton = 24 bottles`;
- product B: `1 carton = 12 packs`;
- product C: `1 carton = 50 sachets`.

Conversion quantity must be positive and must not be assumed globally by category or unit name.

### 3.3 Transaction conversion

All purchasing, sales, return, transfer, stocktake and adjustment quantities must be normalized to the smallest inventory unit before posting to the inventory ledger.

A sale of `2 cartons + 3 bottles` with `1 carton = 24 bottles` posts `51 bottles` to inventory.

Historical documents must snapshot the selected sell unit, conversion factor and normalized base quantity so later conversion changes do not rewrite history.

## 4. SKU and barcode model

- A retail/base sell unit and a carton sell unit may have different SKUs.
- Each sell unit may have its own barcode.
- Carton SKU is not derived automatically when an explicit source value exists.
- SKU and barcode uniqueness are installation-scoped.
- Canonical product identity is separate from sell-unit SKU identity.
- Product names may change without changing canonical product IDs or historical document references.

## 5. Pricing model

- Retail/base-unit price and carton price are stored separately.
- Carton price is not required to equal retail price multiplied by conversion quantity.
- Prices are resolved by sell unit and channel/price list.
- Venue-channel pricing from the normalized workbook must be represented as a dedicated channel or price list, not written directly onto the product row.
- Future price lists may include retail, wholesale, venue, member or other channels.
- Historical order lines must snapshot resolved unit price, sell unit and conversion factor.

## 6. Product classification and customer catalog

The normalized group/category data is intended for:

- NPP Core admin filters;
- manual order-entry product search;
- customer app categories and browsing;
- consistent product discovery across Core and customer-facing experiences.

The customer app must read a safe catalog projection from Core APIs. It must not query product tables or R2 directly.

Catalog visibility, active status, ordering availability and channel price eligibility must be explicit fields or policies rather than inferred from missing prices or images.

## 7. Product media and R2

Product images will be stored in Cloudflare R2 through the existing server-side storage boundary.

Rules:

- media links attach to canonical product or variant IDs, never product names;
- database stores object key and safe metadata, not provider secrets;
- browser receives only approved public URLs or short-lived signed URLs;
- image replacement must preserve audit history where required;
- one product may support a primary image plus additional gallery images later;
- missing image must not block product creation or inventory operations.

R2 upload and media management are planned capabilities. They are not part of the immediate raw product-master implementation unless explicitly approved in that slice.

## 8. Phase 3 sequencing and deployment strategy

Current sequence:

1. Phase 3.3A customer groups, customers and addresses — application code merged; frontend deployed; production backend and database migration intentionally deferred.
2. Phase 3.3B suppliers and supplier payment terms.
3. Product catalog foundation: products, variants/SKUs, categories and brands.
4. Units, conversions and barcodes.
5. Price lists and price resolution by channel and sell unit.
6. Document numbering.

Production backend and database work for these Phase 3 master-data slices is intentionally grouped. Do not deploy each individual backend or migration slice to production.

Before the combined Phase 3 backend/database rollout, Codex must follow the production procedure:

- audit actual provider state;
- create a new verified backup;
- restore rehearsal on a temporary PostgreSQL 17 target;
- apply all pending Phase 3 migrations in order;
- run migration verification and reconciliation;
- test real Core APIs against the rehearsal database;
- deploy Heroku manually from `main`;
- verify `/health/live` and `/health/ready`;
- run Phase 3 API smoke tests;
- create a post-migration backup;
- keep automatic deploy disabled.

Vercel frontend deployment remains separate and only through the exact Issue #5 production command.

## 9. Implementation boundaries

The next supplier slice must not prematurely implement products or pricing.

The later product slice must include data contracts and tests for:

- installation isolation;
- immutable canonical IDs;
- no hard delete;
- idempotent create and import;
- optimistic concurrency;
- deny-by-default permissions;
- transactional audit and outbox;
- duplicate SKU and barcode races;
- unit-conversion validation;
- base-quantity normalization;
- price resolution by channel and sell unit;
- safe server-only gateways;
- browser E2E using actual local Core API and PostgreSQL.

Do not modify `mcp/**` during Core master-data slices.
