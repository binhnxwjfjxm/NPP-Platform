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

### 5.1 Base prices

- Price belongs to an exact product variant/SKU sell unit, never only to the parent product.
- The ordinary retail price is the default/base price for the retail SKU. It is editable data, not a fixed constant in code.
- The carton SKU has its own independent base price.
- Carton price is not required to equal retail price multiplied by conversion quantity.
- Changing a retail or carton price creates/updates price-list data and does not require an application deploy.

### 5.2 Pricing scopes

The engine supports these data-driven price-list types:

- base/default price;
- channel price;
- customer-group price;
- customer-specific price;
- promotion;
- custom administrator- or code-created policy.

Venue-channel pricing from the normalized workbook is represented as a dedicated channel/list, not written onto the product row.

### 5.3 Priority and stacking

Each list has:

- editable numeric priority;
- effective from/to;
- active/inactive state;
- `EXCLUSIVE` or `STACKABLE` processing;
- optional stop-processing behavior;
- optional channel, customer-group and customer scope.

Resolution starts from the active base fixed price. Matching non-base rules are ordered by priority. At most one exclusive rule is applied; matching stackable rules may apply in order until a rule stops processing.

Manual order-line override has the highest precedence, requires a reason and must be visible in the resolution trace. The future order domain will permission-check and snapshot it.

### 5.4 Supported adjustments

- fixed price;
- percentage discount;
- amount discount;
- percentage markup;
- amount markup.

Company-specific prices and campaign amounts must never be hardcoded in application logic. Trusted code may create a `CUSTOM` rule or add a new generic rule type, but the actual amount, percentage, priority, date and scope remain stored data.

### 5.5 Exact money arithmetic

- Money is stored as integer minor units. For VND the minor-unit value is the đồng amount.
- Percentage values are stored as integer basis points.
- Quantity is fixed-scale decimal.
- Money calculations use integer/BigInt arithmetic and deterministic rounding, never JavaScript floating point.
- Discounts cannot produce a negative final unit price.

### 5.6 Historical snapshots

Historical order/document lines must snapshot:

- SKU/variant;
- selected sell unit;
- conversion factor;
- base unit price;
- applied price-list and item IDs;
- each adjustment step;
- manual override and reason when present;
- final unit price and line total.

Later price-list edits must never rewrite historical documents.

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

R2 upload and media management are planned capabilities. They are not part of the immediate pricing implementation.

## 8. Phase 3 sequencing and deployment strategy

Current sequence:

1. Phase 3.3A customer groups, customers and addresses — merged; frontend deployed; production backend/database deferred.
2. Phase 3.3B suppliers and supplier payment terms — merged; production backend/database deferred.
3. Phase 3.3C product catalog foundation — merged; production backend/database deferred.
4. Phase 3.3D units, conversions and barcodes — merged; production backend/database deferred.
5. Phase 3.3E price lists and price resolution by channel and sell unit — current.
6. Phase 3.3F document numbering.

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

Phase 3.3E must include data contracts and tests for:

- installation isolation;
- immutable canonical codes and IDs;
- no hard delete;
- idempotent create and import;
- optimistic concurrency;
- deny-by-default permissions;
- transactional audit and outbox;
- exact money and percentage arithmetic;
- independent retail/carton price resolution;
- channel, customer-group, customer, promotion and manual override resolution;
- priority, stacking, stop-processing, date and quantity-tier behavior;
- safe server-only gateways;
- browser E2E using actual local Core API and PostgreSQL.

Do not implement sales orders, purchasing transactions, inventory posting, R2 media or `mcp/**` changes in Phase 3.3E.
