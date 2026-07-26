# Phase 3.2B - Role & Permission Foundation

> Branch: `agent/core-role-permission-foundation`  
> Status: in progress  
> Parent roadmap item: users / employees / roles / scopes

## Goal

Build the first production-grade role and permission foundation for NPP Core after the employee directory slice.

## In scope

- Canonical permission catalog seeded from code registry.
- Installation-scoped roles.
- Role permission assignments with atomic replace semantics.
- Core API routes for permissions and roles.
- Core web `/access/roles` administration UI.
- Vietnamese copy across the flow.
- Idempotency, optimistic concurrency, audit, and deny-by-default authorization.

## Out of scope

- User identities and employee-user links.
- Passwords, password hashes, login sessions, MFA, or reset flows.
- Role-user assignment.
- Branch / warehouse / territory scope assignment.
- Customers, suppliers, products, inventory, sales, purchasing, or accounting modules.
- Production migration or deployment in this slice.

## Canonical permissions

Minimum new permissions:

- `core.permission.read`
- `core.role.read`
- `core.role.write`

## Backend routes

- `GET /api/access/permissions`
- `GET /api/access/roles`
- `GET /api/access/roles/:id`
- `POST /api/access/roles`
- `PATCH /api/access/roles/:id`

## Frontend routes

- `/access/roles`

## Acceptance criteria

- Migration 008 applies cleanly and is idempotent.
- Permission catalog matches the canonical registry.
- Role create, update, activate/deactivate, and permission replacement work atomically.
- Duplicate code races return a clean 409.
- Stale `expectedUpdatedAt` returns conflict, including no-op updates.
- Browser never receives backend token, database URL, or other secrets.
- Playwright covers auth, menu nesting, CRUD, permission matrix, and conflict handling.

## Review notes

- Keep permission keys canonical and installation-scoped.
- Do not fall back to memory repositories or bypass PostgreSQL.
- Do not introduce role-user, password, or auth-provider changes here.
