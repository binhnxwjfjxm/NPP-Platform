# NPP Platform — Latest Handoff

> Updated: 2026-07-27  
> Current checkpoint: Phase 3 master data is in progress. Phase 3.3A application code is merged; production Core backend/database rollout is intentionally deferred until the larger Phase 3 master-data group is complete.

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

- Phase 3.3A frontend has been deployed to Vercel.
- Migration `010_customer_master_data` has not been applied to production.
- Phase 3.3A Core API has not been deployed to production Heroku.
- Do not claim customer production APIs are live until the grouped Phase 3 backend/database rollout is completed and verified.

## Delivered phases

### Phase 3.1 — Organization and warehouse structure

Delivered and productionized:

- branches;
- warehouses;
- warehouse locations;
- migrations `002` through `006`;
- idempotency, optimistic concurrency and transactional audit;
- Vietnamese Core UI and server-only gateways.

### Phase 3.2A — Employees

Delivered and productionized:

- migration `007_hr_employees`;
- employee directory and active/inactive lifecycle;
- optional branch assignment;
- API, Core web gateway, UI and PostgreSQL/browser coverage.

### Phase 3.2B — Roles and permissions

Delivered and productionized:

- migration `008_access_roles_permissions`;
- canonical permission catalog;
- installation-scoped roles and permission assignments;
- deny-by-default authorization foundation;
- permission matrix UI and regression coverage.

### Phase 3.2C — Users and role assignment

Delivered and productionized:

- migration `009_access_users_role_assignments`;
- installation-scoped users linked one-to-one with employees;
- atomic role replacement;
- zero-role deny-by-default behavior;
- `/access/users` UI and PostgreSQL/browser coverage.

Production closeout evidence remains recorded in the existing Phase 3.2 operation documents. Historical backups `b007` and `b008` must not be reused as evidence for a future migration.

### Phase 3.3A — Customers

Application code was merged by PR #44 at commit:

```text
d4b2a17a3cd9c9f701f0674aadab836d7faa4d38
```

Delivered on `main`:

- migration `010_customer_master_data`;
- customer groups;
- customers;
- customer addresses;
- installation scoping;
- read/write permissions;
- idempotent create;
- optimistic concurrency;
- transactional audit/outbox behavior;
- Core API routes;
- server-only web gateways;
- Vietnamese `/customers` UI;
- migration rehearsal, API tests and browser E2E in CI.

Frontend production deployment was completed and the Vercel one-shot gate was re-locked. The customer navigation currently appears inside the **Tổ chức & kho hàng** menu. Backend/database production rollout remains deferred.

## Product and pricing source files

Commit `e19b7f8d2b13d3b9f45fd871849980f6e2068fe1` added:

- `BANG_GIA_CHUAN_HOA_CAP_NHAT_DS_SP_23.07.26.xlsx`;
- `BANG_GIA_KENH_QUAN_THEM_NHOM_CHI_TIET.xlsx`.

The two files have different purposes:

- the canonical workbook supplies detailed product/sell-unit relationships where available, including retail SKU, carton SKU, carton conversion and price columns;
- the normalized venue-channel workbook supplies standardized naming, grouping and filtering for Core admin order entry and the future customer self-ordering catalog.

Locked product decisions are documented in:

```text
docs/operations/product-catalog-pricing-decisions.md
```

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
3.3A customers/customer groups/addresses       MERGED; frontend deployed; backend/DB deferred
3.3B suppliers/supplier payment terms          BRANCH: agent/supplier-master-data (raw code complete, pending merge)
3.3C products/variants/SKUs/categories/brands  PLANNED
3.3D units/conversions/barcodes                 PLANNED
3.3E price lists/channel price resolution       PLANNED
3.3F document numbering                         PLANNED
```

Do not start inventory ledger, purchasing transactions, sales transactions or MCP cutover before the Phase 3 master-data gate is closed.

## Phase 3.3B — Suppliers (in progress)

Application code is on branch `agent/supplier-master-data`:

Application code implemented:

- migration `011_supplier_master_data`;
- suppliers with installation-scoped normalized code;
- supplier contacts, addresses, payment terms;
- optional purchase owner employee reference;
- active/inactive lifecycle (no hard delete);
- read/write permissions `core.supplier.read` and `core.supplier.write`;
- idempotent create with `Idempotency-Key` header;
- optimistic concurrency with `expectedUpdatedAt` on PATCH;
- transactional audit/outbox behavior;
- Core API routes (GET/POST/PATCH);
- server-only web gateways;
- Vietnamese `/organization/suppliers` admin UI;
- Playwright E2E test suite;
- full PostgreSQL/API/browser coverage.

**Status**: Raw code branch ready; backend/database production rollout remains deferred until Phase 3 master-data group completes.

**Next task**: Merge `agent/supplier-master-data` to `main` after review, then proceed to Phase 3.3C.

## Next task — Phase 3.3C products

## Phase 3 grouped backend/database rollout

Do not deploy each Phase 3 backend/migration slice separately. After the agreed Phase 3 master-data group is complete on `main`, Codex must run the production procedure as one controlled rollout:

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

- Read `NPP_PLATFORM_MASTER_PLAN.md` first.
- Read this handoff second.
- Check actual `main`, open PRs/branches and latest CI before acting.
- Branch from `main` as `agent/<task>`.
- Copilot may write the raw slice and push the feature branch.
- ChatGPT/Codex reviews the actual diff, fixes defects and runs CI.
- CI must be green before merge.
- Verify `mcp/**` changes equal zero for Core-only tasks.
- Merge only after clean review and green checks, then verify `main` and delete the branch.
- Production deployment is always a separate explicit task.
- Vercel production only through exact Issue #5 comment `/deploy-vercel-production`.
- No manual production DB edits.
- No migration without a newly verified backup, restore rehearsal and reconciliation.
- Never expose secrets, tokens, provider credentials or `DATABASE_URL` in frontend, GitHub, chat, logs or screenshots.
