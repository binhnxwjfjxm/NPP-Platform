# Phase 3.2 - Production Closeout

## Final status

```text
Phase: 3.2A + 3.2B + 3.2C
Status: CLOSED
Main SHA: e7122dc634dac51281727e294218a59819fd8863
Vercel production: READY
Heroku backend: READY
Auto Deploy: OFF
```

## Production evidence

- Production web deployment commit: `6661d82785ef17510093e66f77eb06f5976e374e`.
- Production backend release before closeout: `v17`, source `b932ecb5`.
- Production backend release before Phase 3.2C closeout: `v18`, release ID `c694af5f-aed3-4ccb-9fa7-ffcdfcf0cd78`, deployed from `main` at `12eb33551b9210fa9d1dd7d5e828bf4d611fef18`.
- Vercel production deployment ID: `dpl_AmoRj8DMe5z6WYbrPqZTUzbPCTDy`.
- Vercel Auto Deploy remained OFF after closeout.
- Heroku Auto Deploy remained OFF after closeout.

## Backup and restore

- Pre-migration backup: `b005`.
- Restore rehearsal target: temporary PostgreSQL 17.
- Restore rehearsal result: PASS.
- Migration runner on rehearsal:
  - first run applied `008_access_roles_permissions`
  - second run was a no-op
- Migration verify on rehearsal: `true`, `issues=[]`.
- Post-migration backup: `b006`.

## Smoke results

### Direct Heroku backend

- `/health/live`: `200`
- `/health/ready`: `200`
- `GET /api/access/permissions` with bearer token: `200`
- `GET /api/access/roles` with bearer token: `200`
- `GET /api/access/permissions` without auth: `401`
- `GET /api/access/roles` without auth: `401`

### Vercel production

- `/api/access/permissions` without auth: `401`
- `/api/access/roles` without auth: `401`
- `/access/roles` without auth: `401`
- `/api/access/permissions` with Basic Auth: `200`
- `/api/access/roles` with Basic Auth: `200`
- `/access/roles` with Basic Auth: `200`
- `/access/employees` with Basic Auth: `200`
- CSS asset: `200`
- JS asset: `200`

## Phase 3.2C production closeout

- Pre-migration backup: `b007`.
- Restore rehearsal target: temporary PostgreSQL 17.
- Restore rehearsal result: PASS.
- Rehearsal migration `009_access_users_role_assignments`: applied once, second run no-op.
- Rehearsal verify: `true`, `issues=[]`.
- Production migration `009_access_users_role_assignments`: applied once, second run no-op.
- Production verify: `true`, `issues=[]`.
- Current production backend release: `v19`, release ID `ad257db1-1c50-4b24-a48b-08386008b977`, deployed from `main` at `e7122dc634dac51281727e294218a59819fd8863`.
- Direct Heroku smoke:
  - `/health/live`: `200`
  - `/health/ready`: `200`
  - `GET /api/access/users` with bearer token: `200`
  - `GET /api/access/users?limit=10&offset=0` with bearer token: `200`
  - `GET /api/access/roles?active=true` with bearer token: `200`
  - `GET /api/employees?active=true` with bearer token: `200`
  - unauthorized access to those routes: `401`
- Vercel smoke:
  - `/`: `307`
  - `/login`: `200`
  - `/dashboard` without auth: `401`
  - `/access/users` without auth: `401`
  - `/api/access/users` without auth: `401`
  - `/dashboard` with Basic Auth: `200`
  - `/access/users` with Basic Auth: `200`
  - `/api/access/users` with Basic Auth: `200`
  - CSS asset: `200`
  - JS asset: `200`
- Browser HTML did not expose `CORE_API_SERVER_TOKEN`, `CORE_API_INTERNAL_URL`, `BACKEND_API_TOKEN`, or `DATABASE_URL`.
- Post-migration backup: `b008`.
- Vercel Auto Deploy: OFF.
- Heroku Auto Deploy: OFF.

## Security checks

- Browser HTML did not expose `CORE_API_SERVER_TOKEN`.
- Browser HTML did not expose `CORE_API_INTERNAL_URL`.
- Browser HTML did not expose `BACKEND_API_TOKEN`.
- Browser HTML did not expose `DATABASE_URL`.

## Deferred scope

- login/session
- MFA and recovery flows
- branch, warehouse, and territory scope assignment
- customers, suppliers, products, inventory, sales, purchasing
