# NPP Platform — Latest Handoff

> Updated: 2026-07-27  
> Current checkpoint: Phase 3 master data is in progress. Phase 3.3A through Phase 3.3D are merged on `main`; Phase 3.3E pricing is verified in PR #51 and pending merge. The grouped production Core backend/database rollout remains intentionally deferred.

## Production status

```text
Frontend Core: https://npp-platform.vercel.app
Backend Core: https://hung-phat-945da1547594.herokuapp.com
Database: Heroku PostgreSQL
Core web deployment: READY
Core API live/ready: 200/200 at last verified backend closeout
Basic Auth gate: active
Vercel Auto Deploy: OFF
Heroku Automatic Deploy: OFF
Production migrations applied: 002 through 009
Current production backend release: v19
```

Important separation:

- Phase 3.3A frontend is deployed to Vercel.
- Migrations `010_customer_master_data` through `014_price_lists_channel_resolution` are not applied to production.
- Phase 3.3A–3.3E Core API code is not deployed to production Heroku.
- `/products`, its Phase 3.3D UI and `/pricing` are not claimed as deployed to production Vercel.
- Do not claim customer, supplier, product, unit, conversion, barcode or pricing production APIs are live until the grouped Phase 3 rollout is completed and verified.

## Delivered and productionized foundations

### Phase 3.1 — Organization and warehouse structure

- branches, warehouses and warehouse locations;
- migrations `002` through `006`;
- idempotency, optimistic concurrency and transactional audit;
- Vietnamese Core UI and server-only gateways.

### Phase 3.2A — Employees

- migration `007_hr_employees`;
- employee directory and active/inactive lifecycle;
- optional branch assignment;
- API, Core web gateway, UI and PostgreSQL/browser coverage.

### Phase 3.2B — Roles and permissions

- migration `008_access_roles_permissions`;
- canonical permission catalog;
- installation-scoped roles and permission assignments;
- deny-by-default authorization foundation;
- permission matrix UI and regression coverage.

### Phase 3.2C — Users and role assignment

- migration `009_access_users_role_assignments`;
- installation-scoped users linked one-to-one with employees;
- atomic role replacement;
- zero-role deny-by-default behavior;
- `/access/users` UI and PostgreSQL/browser coverage.

Historical backups `b007` and `b008` must not be reused as evidence for a future migration.

## Phase 3.3A — Customers

Merged by PR #44 at commit:

```text
d4b2a17a3cd9c9f701f0674aadab836d7faa4d38
```

Delivered in source:

- migration `010_customer_master_data`;
- customer groups, customers and addresses;
- installation scoping, permissions and lifecycle without hard delete;
- idempotent POST, optimistic-concurrency PATCH and transactional audit/outbox;
- Core API, server-only web gateway, Vietnamese `/customers` UI and CI coverage.

Frontend production deployment is complete. Backend/database rollout remains deferred.

## Phase 3.3B — Suppliers

Merged by PR #46 at commit:

```text
135f308379a7198100b2205be12155f1e047c8de
```

Delivered in source:

- migration `011_supplier_master_data`;
- suppliers, contacts, addresses and payment terms;
- installation-scoped codes and optional purchase owner;
- one active primary child record per supplier where applicable;
- no hard delete/cascade delete;
- permissions, idempotency, optimistic concurrency and shared audit;
- Core API, same-origin gateway, Vietnamese `/suppliers` UI and CI coverage.

Production migration/backend deployment remains deferred.

See `docs/operations/supplier-master-data-slice.md`.

## Phase 3.3C — Product catalog foundation

Merged by PR #47 at commit:

```text
f08ef5a69f303e5dae75bad997239e9750ac99e6
```

Delivered in source:

- migration `012_product_catalog_foundation`;
- guarded product-category hierarchy and product brands;
- canonical products and immutable installation-scoped variant/SKU identities;
- explicit active, catalog-visible, sellable, inventory-base and orderable states;
- one active inventory-base variant per product;
- product/category/brand/variant lifecycle without hard delete/cascade delete;
- permissions `core.product.read/write`;
- idempotent POST, optimistic-concurrency PATCH and transactional audit;
- normalized atomic JSON import capped at 500 products;
- Core API, same-origin gateway, Vietnamese `/products` workspace and Chromium coverage.

See `docs/operations/product-catalog-foundation-slice.md`.

## Phase 3.3D — Units, conversions and barcodes

Merged by PR #49 at commit:

```text
623c9ccf9877191b6f9a49dc5df3bed3433e93c5
```

Delivered in source:

- migration `013_product_units_conversions_barcodes`;
- installation-scoped `shared.units_of_measure` catalog;
- product variant/SKU remains the canonical sell/purchase-unit identity;
- exact `conversion_to_base numeric(20,6)` on each configured variant;
- inventory-base variant conversion must equal `1`;
- product orderability requires an active sellable SKU with unit/conversion metadata;
- barcode identity belongs to a variant/SKU and is unique per installation;
- at most one active primary barcode per variant;
- exact fixed-scale quantity normalization without JavaScript floating-point arithmetic;
- atomic reviewed unit/conversion import with idempotency and shared transactional audit;
- same-origin web proxies protected by Basic Auth;
- `/products` includes unit catalog, SKU conversion, barcode management and quantity preview;
- PostgreSQL API/service tests, migration rehearsal, Core web verification and Chromium E2E.

Source-data audit:

- 606 canonical base/converted SKU pairs;
- 604 rows clean for controlled rehearsal import;
- two `THÙNG → THÙNG` rows blocked for business review;
- no generated carton-SKU assumptions;
- physical weight differences never define stock conversion.

See:

```text
docs/operations/product-units-conversions-barcodes-slice.md
docs/operations/product-units-data-audit-2026-07-27.md
data/imports/product-units-conversions-2026-07-23-review-required.json
```

## Phase 3.3E — Price lists and channel resolution

Implementation is verified in PR #51 and pending merge.

Verified code head:

```text
8ef61b69e9c97f42063fbb56ef4ed1f9926b69ad
```

Delivered in source:

- migration `014_price_lists_channel_resolution`;
- permissions `core.price.read` and `core.price.write`;
- installation-scoped sales-channel catalog;
- price lists for `BASE`, `CHANNEL`, `CUSTOMER_GROUP`, `CUSTOMER`, `PROMOTION` and `CUSTOM` policies;
- exact price items targeting one canonical product variant/SKU;
- retail/base SKU and carton SKU prices are independent editable data;
- fixed-price, percentage/amount discount and percentage/amount markup rules;
- integer VND minor-unit storage and basis-point percentages;
- BigInt money arithmetic with deterministic half-up rounding;
- quantity tiers, effective dates, numeric priority, exclusive/stackable processing and stop-processing;
- explicit manual override requiring a reason;
- explainable resolver returning base price, applied/skipped rules, final unit price and line total;
- source-key idempotent reviewed import for administrator, workbook and trusted-code rules;
- idempotent POST, optimistic-concurrency PATCH, deny-by-default permission checks and shared transactional audit;
- server-only same-origin gateways protected by Basic Auth;
- canonical Vietnamese `/pricing` administration workspace;
- product/SKU/unit administration remains on `/products`;
- `/pricing` supports channels, price lists/programs, SKU rules and a price simulator with trace;
- Core navigation includes `Giá bán & khuyến mãi`;
- Playwright project `catalog` now runs both `products.spec.ts` and `pricing.spec.ts`;
- fixed the pre-existing product-unit UI race and detached-workspace sidebar overlap exposed by the newly active browser coverage;
- Foundation F0.2, migration apply/rerun, PostgreSQL API/service tests, source workbook audit, Core web typecheck/tests/build, Heroku process contract, migration rehearsal and Chromium E2E all passed;
- `mcp/** = 0` and no temporary diagnostic workflow remains in the final diff.

Locked pricing behavior:

- ordinary retail price is the editable base price for the exact retail SKU, not a code constant;
- carton price is independently maintained on the carton SKU and is never derived from retail price × conversion;
- channel, customer-group, customer-specific, promotion and custom policies are stored as data;
- trusted code may create a generic/custom rule through the same API, but company-specific amounts, rates, dates and priority are not hardcoded;
- manual override has highest precedence and requires a reason;
- future document lines must snapshot SKU, sell unit, conversion, base price, applied rules, override and final price.

Pricing source audit:

Canonical workbook:

- 606 product rows, 606 unique retail SKUs and 606 unique carton SKUs;
- 563 positive retail prices after update;
- 43 missing/zero retail prices blocked from unattended import;
- 563 positive normalized carton prices;
- 168 positive original carton retail prices.

Venue-channel workbook:

- 343 mapped rows and 342 unique SKUs;
- one repeated SKU requiring deterministic source-key/business review;
- 338 positive channel prices;
- five missing/zero prices blocked from import;
- 69 rows marked `CẦN DUYỆT - NHIỀU SKU KHÁC QUY CÁCH/GIÁ` and blocked from unattended import.

See:

```text
docs/operations/price-lists-channel-resolution-slice.md
docs/operations/pricing-source-audit-2026-07-27.md
docs/operations/product-catalog-pricing-decisions.md
npp-core/api/scripts/audit-pricing-workbooks.py
```

Production migration `014`, price import and backend/frontend deployment remain deferred.

## Current Phase 3 sequence

```text
3.3A customers/customer groups/addresses       MERGED PR #44; frontend deployed; backend/DB deferred
3.3B suppliers/contacts/addresses/terms         MERGED PR #46; backend/DB deferred
3.3C products/variants/SKUs/categories/brands  MERGED PR #47; backend/DB deferred
3.3D units/conversions/barcodes                 MERGED PR #49; backend/DB deferred
3.3E price lists/channel price resolution       VERIFIED PR #51; merge pending; backend/DB deferred
3.3F document numbering                         NEXT
```

Do not start inventory ledger, purchasing transactions, sales transactions or MCP cutover before the Phase 3 master-data gate is closed.

## Next task — Phase 3.3F document numbering

Required boundaries:

- installation-scoped number-series definitions;
- explicit document type, prefix/template, period reset policy and next counter;
- concurrency-safe allocation without duplicate numbers;
- idempotent allocation contract;
- no business transaction posting in the numbering slice;
- historical numbers remain immutable;
- no production migration or deployment until the grouped Phase 3 rollout.

Before coding, read:

```text
NPP_PLATFORM_MASTER_PLAN.md
docs/operations/LATEST_HANDOFF.md
docs/operations/product-catalog-pricing-decisions.md
docs/operations/price-lists-channel-resolution-slice.md
docs/operations/pricing-source-audit-2026-07-27.md
```

## Phase 3 grouped backend/database rollout

Do not deploy each Phase 3 backend/migration slice separately. After the agreed Phase 3 master-data group is complete on `main`, run one controlled rollout:

1. Audit actual Heroku/PostgreSQL provider state.
2. Create a new production backup.
3. Restore rehearsal to a temporary PostgreSQL 17 target.
4. Apply all pending Phase 3 migrations in order.
5. Run migration verification and before/after reconciliation.
6. Test real Core APIs against the rehearsal database.
7. Deploy Heroku manually from `main`.
8. Verify `/health/live` and `/health/ready`.
9. Run smoke tests for all Phase 3 APIs.
10. Create a post-migration backup.
11. Keep automatic deploy disabled.

Never reuse historical backup/restore evidence for this rollout.

## Workflow rules

- Read `NPP_PLATFORM_MASTER_PLAN.md` first and this handoff second.
- Check actual `main`, open PRs/branches and latest CI before acting.
- Branch from `main` as `agent/<task>`.
- Copilot may write rough CRUD scaffolding only when the domain is not numerically sensitive.
- Numerically sensitive unit, conversion, pricing, inventory and accounting logic is implemented directly by ChatGPT/Codex.
- CI must be green before merge.
- Verify `mcp/** = 0` for Core-only tasks.
- Merge only after clean review and green checks, then verify `main` and delete the branch.
- Production deployment is always a separate explicit task.
- Vercel production only through exact Issue #5 comment `/deploy-vercel-production`.
- No manual production DB edits.
- No migration without a newly verified backup, restore rehearsal and reconciliation.
- Never expose secrets, tokens, provider credentials or `DATABASE_URL` in frontend, GitHub, chat, logs or screenshots.
