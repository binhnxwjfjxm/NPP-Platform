# Phase 3.2 - Production Closeout

## Final status

```text
Phase: 3.2A + 3.2B
Status: CLOSED
Main SHA: 12eb33551b9210fa9d1dd7d5e828bf4d611fef18
Vercel production: READY
Heroku backend: READY
Auto Deploy: OFF
```

## Production evidence

- Production web deployment commit: `6661d82785ef17510093e66f77eb06f5976e374e`.
- Production backend release before closeout: `v17`, source `b932ecb5`.
- Current production backend release: `v18`, release ID `c694af5f-aed3-4ccb-9fa7-ffcdfcf0cd78`, deployed from `main` at `12eb33551b9210fa9d1dd7d5e828bf4d611fef18`.
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

## Security checks

- Browser HTML did not expose `CORE_API_SERVER_TOKEN`.
- Browser HTML did not expose `CORE_API_INTERNAL_URL`.
- Browser HTML did not expose `BACKEND_API_TOKEN`.
- Browser HTML did not expose `DATABASE_URL`.

## Deferred scope

- user identity
- login/session
- role-user assignment
- branch, warehouse, and territory scope assignment
- customers, suppliers, products, inventory, sales, purchasing