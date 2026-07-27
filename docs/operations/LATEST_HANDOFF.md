# NPP Platform — Latest Handoff

> Updated: 2026-07-27  
> Current checkpoint: Phase 3 master data is in progress. Phase 3.3A customer and Phase 3.3B supplier are complete on `main`; Phase 3.3C product catalog foundation is verified in PR #47 and pending merge. The grouped production Core backend/database rollout remains intentionally deferred.

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
- Migration `010_customer_master_data` is not applied to production.
- Migration `011_supplier_master_data` is not applied to production.
- Migration `012_product_catalog_foundation` is not applied to production.
- Phase 3.3A/3.3B/3.3C Core API code is not deployed to production Heroku.
- The `/products` source route is not claimed as deployed to production Vercel.
- Do not claim customer, supplier or product production APIs are live until the grouped Phase 3 backend/database rollout is completed and verified.

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

Application code was merged by PR #44 at commit:

```text
d4b2a17a3cd9c9f701f0674aadab836d7faa4d38
```

Delivered in source:

- migration `010_customer_master_data`;
- customer groups, customers and customer addresses;
- installation scoping, read/write permissions and no hard delete;
- idempotent POST, optimistic-concurrency PATCH and transactional audit/outbox;
- Core API routes and server-only web gateways;
- canonical Vietnamese `/customers` UI;
- migration rehearsal, API tests and browser E2E in CI.

Frontend production deployment is complete. Backend/database production rollout remains deferred.

## Phase 3.3B — Suppliers

Implementation is complete and merged by PR #46.

Delivered in source:

- migration `011_supplier_master_data`;
- suppliers, supplier contacts, supplier addresses and supplier payment terms;
- installation-scoped normalized supplier codes;
- optional purchase-owner employee in the same installation;
- one active primary contact, address and payment term per supplier;
- active/inactive lifecycle without hard delete or cascade delete;
- permissions `core.supplier.read` and `core.supplier.write`;
- idempotent POST and optimistic-concurrency PATCH;
- transactional shared audit records for suppliers and child resources;
- complete Core API contracts for suppliers, contacts, addresses and payment terms;
- server-only same-origin Core web gateway;
- canonical Vietnamese `/suppliers` administration UI for supplier list/create/edit/status;
- `/organization/suppliers` redirects to `/suppliers`;
- PostgreSQL service/API tests, Core web verification, migration rehearsal and Chromium E2E.

Dedicated contact/address/payment-term admin subforms are not shown on the current supplier list screen. Their database, Core API and same-origin gateway contracts are available for a later UI expansion.

Production migration `011` and supplier Core API deployment remain deferred with the larger Phase 3 rollout.

See `docs/operations/supplier-master-data-slice.md`.

## Phase 3.3C — Product catalog foundation

Implementation is verified in PR #47 and pending merge.

Delivered in source:

- migration `012_product_catalog_foundation`;
- installation-scoped product categories with guarded hierarchy;
- product brands;
- canonical products;
- product variants with immutable installation-scoped SKUs;
- explicit active, catalog-visible, sellable, inventory-base and orderable states;
- one active inventory-base variant per product;
- product orderability requires an active sellable SKU;
- product/category/brand/variant lifecycle without hard delete or cascade delete;
- permissions `core.product.read` and `core.product.write`;
- idempotent POST, optimistic-concurrency PATCH and sanitized failures;
- normalized JSON import capped at 500 products, atomic and idempotent;
- import identity resolution by canonical UUID or installation-scoped product code/SKU without silent remapping;
- transactional shared audit records;
- complete Core API and same-origin web gateway contracts;
- canonical Vietnamese `/products` administration workspace;
- `/organization/products` redirects to `/products`;
- Basic Auth protects product pages and proxy routes;
- PostgreSQL service/API tests, duplicate race coverage, migration rehearsal, Core web verification and Chromium E2E.

The following remain intentionally excluded:

- units, conversions and barcodes;
- price lists and channel price resolution;
- product media/R2;
- inventory, purchasing and sales transactions;
- production migration or deployment.

See `docs/operations/product-catalog-foundation-slice.md`.

## Product and pricing source files

Commit `e19b7f8d2b13d3b9f45fd871849980f6e2068fe1` added:

- `BANG_GIA_CHUAN_HOA_CAP_NHAT_DS_SP_23.07.26.xlsx`;
- `BANG_GIA_KENH_QUAN_THEM_NHOM_CHI_TIET.xlsx`.

Their roles are different:

- the canonical workbook supplies detailed retail/carton SKU relationships, carton conversion and price columns where available;
- the normalized venue-channel workbook supplies standardized naming, grouping and filtering for Core admin order entry and the future customer self-ordering catalog.

Locked decisions are documented in `docs/operations/product-catalog-pricing-decisions.md`.

Key rules:

- inventory is stored and posted in the smallest inventory unit;
- carton conversion is product-specific;
- retail and carton SKUs may differ;
- explicit carton SKU from source data wins over a generated `T` suffix;
- retail and carton prices are stored separately by sell unit and price list/channel;
- normalized venue groups support admin filters and the future customer app;
- future R2 images attach to canonical product or variant IDs, never product names;
- historical documents snapshot sell unit, conversion and resolved price.

## Current Phase 3 sequence

```text
3.3A customers/customer groups/addresses       SOURCE COMPLETE; frontend deployed; backend/DB deferred
3.3B suppliers/contacts/addresses/terms         MERGED PR #46; backend/DB deferred
3.3C products/variants/SKUs/categories/brands  VERIFIED PR #47; merge pending; backend/DB deferred
3.3D units/conversions/barcodes                 NEXT
3.3E price lists/channel price resolution       PLANNED
3.3F document numbering                         PLANNED
```

Do not start inventory ledger, purchasing transactions, sales transactions or MCP cutover before the Phase 3 master-data gate is closed.

## Next task — Phase 3.3D units, conversions and barcodes

Before coding, read:

```text
NPP_PLATFORM_MASTER_PLAN.md
docs/operations/LATEST_HANDOFF.md
docs/operations/product-catalog-pricing-decisions.md
docs/operations/product-catalog-foundation-slice.md
```

Phase 3.3D is numerically sensitive and must be implemented directly by ChatGPT/Codex rather than delegated as rough Copilot code.

Required business rules:

- the inventory source of truth is the smallest inventory unit;
- each product has its own retail/carton conversion quantity;
- explicit retail and carton SKUs from the source workbook are authoritative;
- do not generate a `T` suffix when an explicit carton SKU exists;
- each sell unit may have its own barcode;
- SKU and barcode uniqueness are installation scoped;
- conversion quantity must be positive and cannot be assumed globally by category or unit name;
- transaction normalization and historical snapshot rules must be testable before inventory or pricing work begins;
- the two committed workbooks must be reconciled, with ambiguous mappings reported rather than silently guessed.

Phase 3.3D must not implement prices. Price lists and channel price resolution remain Phase 3.3E.

## Phase 3 grouped backend/database rollout

Do not deploy each Phase 3 backend/migration slice separately. After the agreed Phase 3 master-data group is complete on `main`, Codex must run one controlled rollout:

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
- ChatGPT/Codex reviews the actual diff, fixes defects and runs CI.
- Numerically sensitive unit, conversion, pricing, inventory and accounting logic is implemented directly by ChatGPT/Codex.
- CI must be green before merge.
- Verify `mcp/**` changes equal zero for Core-only tasks.
- Merge only after clean review and green checks, then verify `main` and delete the branch.
- Production deployment is always a separate explicit task.
- Vercel production only through exact Issue #5 comment `/deploy-vercel-production`.
- No manual production DB edits.
- No migration without a newly verified backup, restore rehearsal and reconciliation.
- Never expose secrets, tokens, provider credentials or `DATABASE_URL` in frontend, GitHub, chat, logs or screenshots.
