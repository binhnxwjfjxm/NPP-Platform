# NPP Platform — Latest Handoff

> Updated: 2026-07-27  
> Current checkpoint: Phase 3.2C production closeout is complete on `main`.

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
Production migrations applied: 002 through 009
Current backend release: v19
```

Phase 3.2A/3.2B production closeout evidence:

- Main SHA at closeout: `12eb33551b9210fa9d1dd7d5e828bf4d611fef18`.
- Vercel production deployment commit: `6661d82785ef17510093e66f77eb06f5976e374e`.
- Vercel production deployment ID: `dpl_AmoRj8DMe5z6WYbrPqZTUzbPCTDy`.
- Pre-migration backup: `b005`.
- Restore rehearsal: PASS.
- Migrations `002` through `008`: applied.
- `migration:verify`: `true`, `issues=[]`.
- Post-migration backup: `b006`.
- Heroku release `v18`: release ID `c694af5f-aed3-4ccb-9fa7-ffcdfcf0cd78`.
- Smoke tests for Employee, Role and Permission routes: PASS.
- Vercel Auto Deploy: OFF.
- Heroku Auto Deploy: OFF.

Phase 3.2C production closeout evidence:

- Main SHA at closeout: `e7122dc634dac51281727e294218a59819fd8863`.
- Pre-migration backup: `b007`.
- Restore rehearsal target: temporary PostgreSQL 17.
- Restore rehearsal result: PASS.
- Migration `009_access_users_role_assignments` applied on rehearsal: PASS.
- Production migration `009_access_users_role_assignments`: PASS.
- `migration:verify`: `true`, `issues=[]`.
- Current production backend release: `v19`, release ID `ad257db1-1c50-4b24-a48b-08386008b977`.
- Direct Heroku backend smoke for users, roles and employees: PASS.
- Vercel production smoke for `/dashboard`, `/access/users`, `/api/access/users` and assets: PASS.
- Browser HTML did not expose `CORE_API_SERVER_TOKEN`, `CORE_API_INTERNAL_URL`, `BACKEND_API_TOKEN` or `DATABASE_URL`.
- Post-migration backup: `b008`.
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

## Phase 3.2A delivered and productionized

- Employee directory migration `007_hr_employees`.
- Installation-scoped employee CRUD and active/inactive lifecycle.
- Optional branch assignment, idempotent create, optimistic concurrency and transactional audit.
- Server-only Core web gateway and `/access/employees` administration UI.
- PostgreSQL integration and Playwright regression coverage.
- Merged by PR #33.

## Phase 3.2B delivered and productionized

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

Production closeout evidence is recorded in `docs/operations/phase-3-2-production-closeout.md`.

## Phase 3.2C delivered and productionized

PR #41 was squash-merged to `main` at:

```text
082a26dfefdcab5dccb51bea6e6726e0e4f9ad82
```

Delivered scope:

- migration `009_access_users_role_assignments`;
- canonical `shared.users` and `shared.user_roles` tables;
- installation-scoped user records linked one-to-one with employees;
- normalized immutable `login_name` and immutable employee link;
- active/inactive user lifecycle without deletion;
- zero-role users with deny-by-default semantics;
- dedicated `core.user.read`, `core.user.write` and `core.user-role.write` permissions;
- separate permission boundary for atomic role replacement;
- idempotency, optimistic concurrency and transactional before/after audit;
- Core API routes and server-only Core web gateway;
- Vietnamese `/access/users` administration UI;
- viewport-safe responsive modal and conflict reload flow;
- PostgreSQL repository/API regression tests and Browser E2E.

Merge gate evidence:

```text
Foundation F0.2         PASS
Core Foundation         PASS
Migration rehearsal     PASS
Core UI/Browser E2E     PASS
Review threads          RESOLVED
```

Production closeout evidence:

- Pre-migration backup: `b007`.
- Restore rehearsal on temporary PostgreSQL 17: PASS.
- Production migration `009_access_users_role_assignments`: PASS.
- `migration:verify`: `true`, `issues=[]`.
- Current production backend release: `v19`, release ID `ad257db1-1c50-4b24-a48b-08386008b977`, deployed from `main` at `e7122dc634dac51281727e294218a59819fd8863`.
- Smoke for `/api/access/users`, `/api/access/roles`, `/api/access/employees`: PASS.
- Smoke for Vercel protected routes and static assets: PASS.
- Browser HTML did not expose `CORE_API_SERVER_TOKEN`, `CORE_API_INTERNAL_URL`, `BACKEND_API_TOKEN` or `DATABASE_URL`.
- Post-migration backup: `b008`.
- Vercel Auto Deploy: OFF.
- Heroku Auto Deploy: OFF.

Security and product boundaries that remain unchanged:

- no password or password hash exists;
- login/session management is not implemented;
- MFA and recovery flows are not implemented;
- no external authentication provider has been selected;
- branch, warehouse and territory scopes are not implemented;
- Basic Auth and backend bootstrap token remain active;

See `docs/operations/user-role-assignment-slice.md`.

## Next checkpoint

Phase 3.2C production closeout is complete. Future slices must begin with a fresh provider audit and a newly verified backup plus restore rehearsal before any later production migration.

Do not begin login/session management, MFA, authentication-provider integration or branch/warehouse/territory scope assignment until the next slice is explicitly approved and its contract is locked.

## Backups and migration evidence

```text
Phase 3.1 pre-migration backup: b1
Phase 3.1 restore rehearsal: PASS
Phase 3.1 production migration verify: PASS
Phase 3.1 post-migration backup: b002
Phase 3.2 pre-migration backup: b005
Phase 3.2 restore rehearsal: PASS
Phase 3.2 post-migration backup: b006
```

These are historical artifacts only. Do not use them as evidence for migration `009`. Before any later production migration, audit the provider again and create a new verified backup plus restore rehearsal.

## Rules that remain active

- Branch from `main` as `agent/<task>`.
- CI green before merge.
- Production deploy remains separate after merge.
- Vercel production only through exact Issue #5 comment `/deploy-vercel-production`.
- No manual production DB edits.
- No migration without verified backup, restore rehearsal and reconciliation.
- No secrets in frontend, GitHub, chat, logs or screenshots.
