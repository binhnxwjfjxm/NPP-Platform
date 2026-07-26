# NPP Platform — Latest Handoff

> Updated: 2026-07-26  
> Current checkpoint: Phase 3.2A and Phase 3.2B production closeout complete on `main`; Phase 3.2C implementation is under review in PR #41.

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

Phase 3.2 closeout evidence:

- Main SHA: `12eb33551b9210fa9d1dd7d5e828bf4d611fef18`.
- Vercel production deployment commit: `6661d82785ef17510093e66f77eb06f5976e374e`.
- Vercel production deployment ID: `dpl_AmoRj8DMe5z6WYbrPqZTUzbPCTDy`.
- Commit `12eb335` only re-locked Vercel Auto Deploy.
- Pre-migration backup: `b005`.
- Restore rehearsal: PASS.
- Migrations `002` through `008`: applied.
- `migration:verify`: `true`, `issues=[]`.
- Post-migration backup: `b006`.
- Heroku release `v17`: source `b932ecb5` and Phase 3.2A only.
- Heroku release `v18`: release ID `c694af5f-aed3-4ccb-9fa7-ffcdfcf0cd78`, current production backend release from `main` at `12eb33551b9210fa9d1dd7d5e828bf4d611fef18`.
- Smoke tests for Employee, Role and Permission routes: PASS.
- Vercel Auto Deploy: OFF.
- Heroku Auto Deploy: OFF.

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

Production evidence for migrations `007` and `008` is recorded in `docs/operations/phase-3-2-production-closeout.md`. Audit the provider again before any later production migration or deployment.

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

Still excluded and deferred after Phase 3.2B:

- user identities and employee-user links;
- passwords, password hashes, sessions and MFA;
- role-user assignment;
- branch, warehouse and territory scope assignment;
- replacing Vercel Basic Auth;
- customers, suppliers, products, inventory, sales, purchasing and MCP cutover.

## Phase 3.2 production closeout

Production closeout for Phase 3.2A and Phase 3.2B is complete.

Key production evidence:

- Production database was already verified through migrations `002` to `008`.
- Restore rehearsal used backup `b005` against temporary PostgreSQL and passed.
- Post-migration backup `b006` completed successfully.
- Heroku release `v18` is the current backend release, release ID `c694af5f-aed3-4ccb-9fa7-ffcdfcf0cd78`, and was deployed from `main`.
- Direct Heroku API smoke passed for `/health/live`, `/health/ready`, `/api/access/permissions`, and `/api/access/roles`.
- Vercel smoke passed for `/api/access/permissions`, `/api/access/roles`, `/access/roles`, and `/access/employees`.
- Browser HTML did not expose `CORE_API_SERVER_TOKEN`, `CORE_API_INTERNAL_URL`, `BACKEND_API_TOKEN`, or `DATABASE_URL`.
- Vercel production deployment remains `READY` and still points at the approved production commit.

## Phase 3.2C implementation under review

PR #41 on branch `agent/core-user-role-assignment` implements the next explicitly approved access slice.

Current implementation scope:

- migration `009_access_users_role_assignments`;
- canonical `shared.users` and `shared.user_roles` tables;
- installation-scoped user records linked one-to-one with employees;
- normalized immutable `login_name` and immutable employee link;
- active/inactive user lifecycle;
- zero-role users with deny-by-default semantics;
- dedicated `core.user.read`, `core.user.write` and `core.user-role.write` permissions;
- atomic role replacement with optimistic concurrency;
- Core API routes and server-only Core web gateway;
- Vietnamese `/access/users` administration UI;
- transaction audit, idempotency and regression tests.

Security and product boundaries that remain unchanged:

- no password or password hash exists;
- login/session management is not implemented;
- MFA and recovery flows are not implemented;
- no external authentication provider has been selected;
- branch, warehouse and territory scopes are not implemented;
- Basic Auth and backend bootstrap token remain active;
- no production migration or deployment has occurred for Phase 3.2C.

PR #41 must not merge until migration rehearsal, Core Foundation, Core UI/Browser E2E and review gates are green. See `docs/operations/user-role-assignment-slice.md`.

## Next checkpoint

Complete review and CI for Phase 3.2C. After merge, production closeout remains a separate explicitly approved task requiring a fresh provider audit, verified backup, restore rehearsal and reconciliation. Do not begin login/session management or data scopes inside the Phase 3.2C PR.

## Backups and migration evidence

```text
Phase 3.1 pre-migration backup: b1
Phase 3.1 restore rehearsal: PASS
Phase 3.1 production migration verify: PASS
Phase 3.1 post-migration backup: b002
```

These are historical Phase 3.1 artifacts only. Do not use them as evidence for migration `007`, `008` or `009`. Before any later production migration, audit the provider again and create a new verified backup plus restore rehearsal.

## Rules that remain active

- Branch from `main` as `agent/<task>`.
- CI green before merge.
- Production deploy remains separate after merge.
- Vercel production only through exact Issue #5 comment `/deploy-vercel-production`.
- No manual production DB edits.
- No migration without verified backup, restore rehearsal and reconciliation.
- No secrets in frontend, GitHub, chat, logs or screenshots.
