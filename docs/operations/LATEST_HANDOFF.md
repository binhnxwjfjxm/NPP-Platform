# NPP Platform — Latest Handoff

> Updated: 2026-07-26  
> Current checkpoint: Phase 3.2B role and permission foundation in progress.

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

## Current Phase 3.2B work

Phase 3.2A employee directory is complete on `main`. The next master-data slice is the role and permission foundation.

Active branch:

```text
agent/core-role-permission-foundation
```

Scope:

- canonical permission catalog and role records;
- installation-scoped role membership and permission assignment;
- list/get/create/update/activate/deactivate;
- idempotent create, optimistic concurrency and transactional audit;
- server-only Core web gateway;
- `/access/roles` administration UI;
- API integration and Playwright browser tests.

Explicitly excluded from this slice:

- passwords and password hashes;
- authentication-provider integration;
- user identities and employee-user links;
- role-user assignment and data scopes;
- replacing Vercel Basic Auth;
- production migration or deployment before CI and migration safety gates.

See `docs/operations/role-permission-slice.md`.

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
