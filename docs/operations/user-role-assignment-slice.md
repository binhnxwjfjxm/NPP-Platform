# Phase 3.2C — User Identity and Role Assignment

> Status: merged to `main` by PR #41  
> Merge commit: `082a26dfefdcab5dccb51bea6e6726e0e4f9ad82`  
> Production status: not migrated and not deployed

## Objective

Add canonical internal user accounts for NPP Core, link each account to one business employee and manage installation-scoped role assignments without introducing real login credentials or sessions.

## Delivered scope

- Migration `009_access_users_role_assignments`.
- Canonical `shared.users` table.
- Canonical `shared.user_roles` assignment table.
- Lowercase installation-scoped `login_name` uniqueness.
- One user per employee within an installation.
- Immutable `login_name` and employee link.
- Active/inactive user lifecycle without deletion.
- Zero-role users with deny-by-default semantics.
- Dedicated permissions:
  - `core.user.read`;
  - `core.user.write`;
  - `core.user-role.write`.
- Core API list/get/create/status routes.
- Dedicated atomic role replacement endpoint.
- Server-only Core web gateway.
- Vietnamese `/access/users` administration UI.
- Idempotency, optimistic concurrency and transactional audit.
- PostgreSQL integration, permission-boundary and browser regression coverage.

## Explicitly excluded

- Passwords and password hashes.
- Login credential verification.
- Sessions and refresh tokens.
- MFA and recovery flows.
- OAuth or any external authentication provider.
- Replacing the current Basic Auth and backend bootstrap token gates.
- Branch, warehouse or territory scope assignment.
- Production migration or deployment.

## Canonical data contract

### `shared.users`

- `id` UUID.
- `installation_id`.
- `employee_id`.
- normalized lowercase `login_name`.
- `is_active`.
- creation/update timestamps and actors.
- unique `(installation_id, id)` for scoped foreign keys.
- unique `(installation_id, employee_id)`.
- unique `(installation_id, login_name)`.

`login_name` and `employee_id` cannot be changed after creation. Deactivation preserves the record and its role assignments.

### `shared.user_roles`

- `installation_id`.
- `user_id`.
- `role_id`.
- creation timestamp and actor.
- unique installation/user/role assignment.

Role replacement is atomic. Empty role sets are valid. Inactive or cross-installation roles are rejected.

## API contract

- `GET /api/access/users`
- `GET /api/access/users/:id`
- `POST /api/access/users`
- `PATCH /api/access/users/:id`
- `PATCH /api/access/users/:id/roles`

Creation produces a zero-role user. Role assignment is only accepted by the dedicated role endpoint protected by `core.user-role.write`.

## Authorization boundary

- Reads require `core.user.read`.
- Create and active/inactive changes require `core.user.write`.
- Role replacement requires `core.user-role.write`.
- `authenticateRequest` remains the current server-owned bootstrap token mechanism.
- Employee IDs, roles, permissions and scopes from request bodies are never trusted to construct an authenticated principal.

## UI rules

- Only active employees without an existing user are offered during creation.
- Only active roles may be newly assigned.
- An inactive role already assigned remains visible only so it can be revoked.
- Technical permission keys and role codes are not shown in the product-facing role selector.
- Modal backdrops are viewport-fixed, cover the topbar and keep headers visible while modal bodies scroll.
- Stale concurrency errors expose a reload action.

## Merge gate evidence

```text
migration 009 clean apply and rerun     PASS
API/repository regression tests         PASS
permission separation tests             PASS
Core web typecheck/test/build            PASS
browser E2E                              PASS
Foundation F0.2                          PASS
Core Foundation                          PASS
migration rehearsal                      PASS
review threads resolved                  PASS
squash merge                              PASS
```

Production closeout is a separate activity and requires a newly verified backup, restore rehearsal, migration reconciliation, backend/frontend deployment approvals and production smoke tests.
