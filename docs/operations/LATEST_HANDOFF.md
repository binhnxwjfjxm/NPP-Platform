# NPP Platform — Latest Handoff

> Updated: 2026-07-27  
> Current checkpoint: Phase 3 master data is in progress. Phase 3.3A through Phase 3.3D are merged on `main`. Phase 3.3E price lists/channel resolution is next. The grouped production Core backend/database rollout remains intentionally deferred.

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
- Migrations `010_customer_master_data`, `011_supplier_master_data`, `012_product_catalog_foundation` and `013_product_units_conversions_barcodes` are not applied to production.
- Phase 3.3A–3.3D Core API code is not deployed to production Heroku.
- `/products` and its Phase 3.3D UI are not claimed as deployed to production Vercel.
- Do not claim customer, supplier, product, unit, conversion or barcode production APIs are live until the grouped Phase 3 rollout is completed and verified.

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
- product list can refresh inside the unit workspace without page reload;
- PostgreSQL API/service tests, migration rehearsal, Core web verification and Chromium E2E all passed;
- `mcp/** = 0` and no temporary workflow/payload remains in the merged diff.

Source-data audit:

- 606 canonical base/converted SKU pairs;
- 606 unique base SKUs and 606 unique converted SKUs;
- no missing/duplicate SKU pair and all conversion factors are positive integers;
- 604 rows are clean for controlled rehearsal import;
- 2 `THÙNG → THÙNG` rows are blocked for business review and preserved separately;
- all 606 source barcode values equal the explicit converted SKU and are classified as `INTERNAL` rather than inferred EAN/UPC values;
- 159 rows have missing/zero descriptive net-content metadata;
- physical weight differences never define stock conversion.

See:

```text
docs/operations/product-units-conversions-barcodes-slice.md
docs/operations/product-units-data-audit-2026-07-27.md
data/imports/product-units-conversions-2026-07-23-review-required.json
```

Production migration, data import and backend/frontend deployment remain deferred.

## Product and pricing source files

Commit `e19b7f8d2b13d3b9f45fd871849980f6e2068fe1` added:

- `BANG_GIA_CHUAN_HOA_CAP_NHAT_DS_SP_23.07.26.xlsx`;
- `BANG_GIA_KENH_QUAN_THEM_NHOM_CHI_TIET.xlsx`.

Locked rules:

- inventory is stored and posted in the smallest inventory unit;
- conversion is product/SKU-specific;
- explicit retail and carton SKUs win over generated assumptions;
- retail/carton prices are independent and belong to sell unit + price list/channel;
- normalized venue groups support Core admin filtering and the future customer app;
- future R2 images attach to canonical product/variant IDs;
- historical transaction lines snapshot sell unit, conversion and resolved price.

See `docs/operations/product-catalog-pricing-decisions.md`.

## Current Phase 3 sequence

```text
3.3A customers/customer groups/addresses       MERGED PR #44; frontend deployed; backend/DB deferred
3.3B suppliers/contacts/addresses/terms         MERGED PR #46; backend/DB deferred
3.3C products/variants/SKUs/categories/brands  MERGED PR #47; backend/DB deferred
3.3D units/conversions/barcodes                 MERGED PR #49; backend/DB deferred
3.3E price lists/channel price resolution       NEXT
3.3F document numbering                         PLANNED
```

Do not start inventory ledger, purchasing transactions, sales transactions or MCP cutover before the Phase 3 master-data gate is closed.

## Next task — Phase 3.3E price lists and channel resolution

Phase 3.3E is numerically and financially sensitive and must be implemented directly by ChatGPT/Codex rather than delegated as rough Copilot code.

Required boundaries:

- price belongs to an exact variant/SKU sell unit, not only a product;
- retail and carton prices remain independent;
- price lists/channels and effective-date lifecycle are explicit;
- no floating-point money arithmetic;
- source workbook rows are reconciled and ambiguous mappings are reported, never silently guessed;
- historical documents snapshot the resolved price and unit/conversion;
- do not implement sales orders, purchasing transactions or inventory posting in 3.3E.

Before coding, read:

```text
NPP_PLATFORM_MASTER_PLAN.md
docs/operations/LATEST_HANDOFF.md
docs/operations/product-catalog-pricing-decisions.md
docs/operations/product-units-conversions-barcodes-slice.md
docs/operations/product-units-data-audit-2026-07-27.md
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
