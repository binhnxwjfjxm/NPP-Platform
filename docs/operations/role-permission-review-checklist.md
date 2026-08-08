# Role & Permission Review Checklist

> Historical evidence: this checklist records the Phase 2 implementation review.  
> Phase 9.0 decision lock: role/preset semantics are governed by #386 and `docs/operations/phase-9-0-readiness-audit.md`.

## Phase 9 clarification

The earlier implementation may use immutable role codes/default-role behavior internally, but that must **not** be read as the Phase 9 product rule that businesses are forced to use a fixed role list.

Phase 9 target:

- owner/admin can create a business role and name it for the organization;
- preset/template is only a suggested starting permission set;
- a permitted administrator can add/remove permissions before saving and edit permissions later;
- backend authorization is based on actual permission + scope and remains deny-by-default;
- role name is never an authorization shortcut;
- Phase 9.1 reconciles the backend permission registry, route/action use and permission-management UI.

The items below remain historical verification of the original implementation unless a later Phase 9 slice explicitly changes them.

- [x] Migration 008 creates `shared.permission_catalog`, `shared.roles`, and `shared.role_permissions`.
- [x] Permission catalog rows match the registry exactly.
- [x] Role code is uppercase, immutable, and unique per installation.
- [x] Permission assignments are installation-scoped and atomic.
- [x] Unknown permission keys are rejected before write.
- [x] Duplicate role code races return 409, not 500.
- [x] `expectedUpdatedAt` is required on PATCH.
- [x] Stale updates and stale no-op updates both conflict.
- [x] Audit records are written for create and patch.
- [x] Audit actions are derived from persisted before/after changes.
- [x] Permission-only replacement advances the role concurrency token.
- [x] Malformed role IDs are rejected before PostgreSQL access.
- [x] Permission catalog GET remains read-only.
- [x] API responses do not expose SQL, provider internals, or secrets.
- [x] Frontend `/access/roles` is Vietnamese and uses same-origin gateway routes.
- [x] AppShell menu contains `Vai trò & phân quyền` under `Nhân sự & phân quyền`.
- [x] Playwright covers unauthenticated 401, authenticated CRUD, conflict, and refresh behavior.
- [x] No fallback memory repository or production DB bypass was introduced.

## Historical CI evidence

```text
Foundation F0.2         PASS
Core Foundation         PASS
Migration rehearsal     PASS
Core UI/Browser E2E     PASS
```

Reviewed head:

```text
6b34ac7af1346ef80a8b648cbc72c211ae7ecd4e
```

Squash merge:

```text
f4cdb1e555dff2dc265ea95179a481b21bbba3d1
```

Production migration and deployment were not performed as part of that review.
