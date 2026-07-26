# NPP Platform — Latest Handoff

> Updated: 2026-07-26  
> Current checkpoint: Phase 3.2B merged to `main`; production migration and deployment are pending separate safety gates.

## Production status

```text
Frontend Core: https://npp-platform.vercel.app
Backend Core: https://hung-phat-945da1547594.herokuapp.com
Database: Heroku PostgreSQL
Core web deployment: READY
Core API live/ready: 200/200
Organization canonical API: active
Organization Basic Auth gate: active
Auto Deploy: locked
```

No Phase 3.2B production migration or deployment has been performed from this checkpoint.

## Phase 3.1 delivered

- Branch management.
- Warehouse management.
- Warehouse-location management.
- PostgreSQL migrations `002` through `006` applied and verified in production.
- Idempotency, optimistic concurrency, transactional audit and hierarchy constraints.
- Vietnamese AppShell, dashboard and organization administration routes.
- Server-side organization gateway with no privileged token exposed to the browser.
- Canonical Vercel routes from project root `npp-core/web`.
- Office-style shell polish, fixed/collapsible sidebar, nested navigation and Hưng Phát branding merged by PR #32.

## Phase 3.2A delivered

- Employee directory migration `007_hr_employees`.
- Installation-scoped employee CRUD and active/inactive lifecycle.
- Optional branch assignment, idempotent create, optimistic concurrency and transactional audit.
- Server-only Core web gateway and `/access/employees` administration UI.
- PostgreSQL integration and Playwright regression coverage.
- Merged by PR #33.

Production evidence for migration `007` must still be audited directly before it is reused as a dependency for any later production migration.

## Phase 3.2B merged

PR #34 was squash-merged to `main` at:

```text
f4cdb1e555dff2dc265ea95179a481b21bbba3d1
```

Delivered scope:

- canonical permission catalog;
- installation-scoped roles and role-permission assignments;
- migration `008_access_roles_permissions`;
- list/get/create/update/activate/deactivate APIs;
- role code immutability and duplicate-race handling;
- atomic permission replacement;
- idempotent mutations and optimistic concurrency;
- transactional audit with action derived from persisted before/after state;
- server-only Core web gateway;
- `/access/roles` Vietnamese administration UI and permission matrix;
- regression tests for validation, malformed IDs, read-only catalog access and permission concurrency.

GitHub CI on the reviewed head passed:

```text
Foundation F0.2         PASS
Core Foundation         PASS
Migration rehearsal     PASS
Core UI/Browser E2E     PASS
```

Still excluded and deferred:

- user identities and employee-user links;
- passwords, password hashes, sessions and MFA;
- role-user assignment;
- branch, warehouse and territory scope assignment;
- replacing Vercel Basic Auth;
- customers, suppliers, products, inventory, sales, purchasing and MCP cutover.

See `docs/operations/role-permission-slice.md` and `docs/operations/role-permission-review-checklist.md`.

## Next checkpoint

Before migration `008` or a new Core release reaches production:

1. audit the actual Heroku provider state;
2. verify a fresh pre-migration backup;
3. complete a restore rehearsal with evidence;
4. record pre-migration reconciliation counts;
5. run migration through the repository migration runner;
6. verify migration and post-migration counts;
7. deploy Core API manually from `main` and check `/health/live` plus `/health/ready`;
8. deploy Core web separately through the exact Issue #5 command;
9. smoke `/`, `/login`, `/dashboard`, `/access/employees`, `/access/roles` and the corresponding API routes;
10. re-lock all deployment gates and record provider evidence.

Do not select the next business-domain slice until the product owner decides whether to productionize Phase 3.2B first or continue with another non-production foundation slice.

## Backups and migration evidence

```text
Phase 3.1 pre-migration backup: b1
Phase 3.1 restore rehearsal: PASS
Phase 3.1 production migration verify: PASS
Phase 3.1 post-migration backup: b002
```

These are historical Phase 3.1 artifacts only. Do not use them as evidence for migration `007` or `008`. Before any later production migration, audit the provider again and create a new verified backup plus restore rehearsal.

## Rules that remain active

- Branch from `main` as `agent/<task>`.
- CI green before merge.
- Production deploy remains separate after merge.
- Vercel production only through exact Issue #5 comment `/deploy-vercel-production`.
- No manual production DB edits.
- No migration without verified backup, restore rehearsal and reconciliation.
- No secrets in frontend, GitHub, chat, logs or screenshots.
