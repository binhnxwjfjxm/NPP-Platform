# Phase 3.2B - Role & Permission Foundation

> Original branch: `agent/core-role-permission-foundation`  
> Pull request: `#34`  
> Merge commit: `f4cdb1e555dff2dc265ea95179a481b21bbba3d1`  
> Status: merged to `main`; production migration and deployment pending  
> Parent roadmap item: users / employees / roles / scopes

## Goal

Build the first production-grade role and permission foundation for NPP Core after the employee directory slice.

## Delivered scope

- Canonical permission catalog seeded from code registry.
- Installation-scoped roles.
- Role permission assignments with atomic replace semantics.
- Core API routes for permissions and roles.
- Core web `/access/roles` administration UI.
- Vietnamese copy across the flow.
- Idempotency, optimistic concurrency, audit, and deny-by-default authorization.
- Migration `008_access_roles_permissions`.
- PostgreSQL integration tests and Playwright browser coverage.

## Out of scope

- User identities and employee-user links.
- Passwords, password hashes, login sessions, MFA, or reset flows.
- Role-user assignment.
- Branch / warehouse / territory scope assignment.
- Customers, suppliers, products, inventory, sales, purchasing, or accounting modules.
- Production migration or deployment in this slice.

## Canonical permissions

New permissions:

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
- `/api/access/permissions`
- `/api/access/roles`
- `/api/access/roles/:id`

## Acceptance results

- Migration 008 applies cleanly and reruns as a no-op.
- Permission catalog matches the canonical registry.
- Role create, update, activate/deactivate, and permission replacement work atomically.
- Duplicate code races return a clean 409.
- Stale `expectedUpdatedAt` returns conflict, including no-op updates.
- Permission-only replacement advances the role concurrency token.
- Browser never receives backend token, database URL, or other secrets.
- Playwright covers auth, menu nesting, CRUD, permission matrix, and conflict handling.
- GitHub CI passed Foundation F0.2, Core Foundation, migration rehearsal and Core UI/Browser E2E.

## Review fixes

- Audit actions now come from persisted before/after changes rather than request-field presence.
- Non-boolean `isActive` values are rejected.
- Supplied role codes are validated before immutability checks.
- Permission catalog GET is read-only.
- Malformed UUIDs are rejected before PostgreSQL access.
- Permission-only replacement advances `updated_at`.
- Duplicate post-update reads were removed.
- Null PATCH payloads return a controlled validation error.
- Focused regression tests cover the review findings.

## Production boundary

The merge does not prove that migration `008` is applied in production. Before production migration or deployment, obtain fresh provider evidence for backup, restore rehearsal, reconciliation, migration verification, release health and smoke tests.
