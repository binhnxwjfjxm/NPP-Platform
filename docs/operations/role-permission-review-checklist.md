# Role & Permission Review Checklist

- [ ] Migration 008 creates `shared.permission_catalog`, `shared.roles`, and `shared.role_permissions`.
- [ ] Permission catalog rows match the registry exactly.
- [ ] Role code is uppercase, immutable, and unique per installation.
- [ ] Permission assignments are installation-scoped and atomic.
- [ ] Unknown permission keys are rejected before write.
- [ ] Duplicate role code races return 409, not 500.
- [ ] `expectedUpdatedAt` is required on PATCH.
- [ ] Stale updates and stale no-op updates both conflict.
- [ ] Audit records are written for create and patch.
- [ ] API responses do not expose SQL, provider internals, or secrets.
- [ ] Frontend `/access/roles` is Vietnamese and uses same-origin gateway routes.
- [ ] AppShell menu contains `Vai trò & phân quyền` under `Nhân sự & phân quyền`.
- [ ] Playwright covers unauthenticated 401, authenticated CRUD, conflict, and refresh behavior.
- [ ] No fallback memory repository or production DB bypass was introduced.
