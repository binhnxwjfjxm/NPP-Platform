# NPP Platform — Latest Handoff

## Current source checkpoint

- Repository: `binhnxwjfjxm/NPP-Platform`.
- Production branch: `main`.
- Exact audited baseline before Phase 6C.0D: `a22e9d7890222daef1738f805f2542c4c793c9da`.
- PR #130 merged Phase 6C.0A repository/data-contract audit.
- PR #136 merged Phase 6C.0B provider-neutral PostgreSQL persistence boundary.
- PR #142 merged the guarded MCP Vercel runtime-source contract.
- PR #144 merged Phase 6C.0C backend-owned writes, authorization, idempotency and audit/outbox contract.
- Exact latest `main` must be re-audited before PR review, merge or any later task.

Source merge does not prove production deployment, provider configuration, database migration, backup, reconciliation or cutover.

## Active work

Issue:

```text
#145 — Phase 6C.0D — add MCP PostgreSQL schema, migrations and write repositories
```

Branch:

```text
agent/phase-6c0d-mcp-postgresql-foundation
```

Scope is source-only:

```text
MCP-owned migration runner and guarded CLI
mcp idempotency, audit and outbox source migration
PostgreSQL transaction boundary
repository-backed write-command ports
PostgreSQL 17 disposable integration verification
```

No production provider or database mutation is authorized.

## Locked runtime conclusions

The target installation topology remains five Vercel frontends, two Heroku backends and one shared PostgreSQL cluster.

The active MCP backend startup boundary remains:

```text
bootstrap.js
-> config.js
-> persistence.js
-> postgresql-adapter.js
-> gateway.js
```

Production does not fall back to Supabase. Protected business routes remain fail-closed until reviewed field-domain repositories are implemented and cut over.

The default MCP service authorization policy is intentionally empty. Browser headers cannot grant installation identity, employee identity, roles, permissions or scopes.

Phase 6C.0D does not create a production runtime role. The later provider operation must keep the MCP role restricted to reviewed MCP-owned objects, with `mcp` first in `search_path` and no direct write privilege on Core-owned schemas.

## Phase 6C sequence

```text
6C.0A repository/data contract audit                        MERGED
6C.0B provider-neutral persistence boundary                 MERGED
6C.0C backend writes/auth/idempotency/audit-outbox contract MERGED
6C.0D PostgreSQL mcp schema and write repositories          ACTIVE
6C.0E backup/restore/migration rehearsal and reconciliation NOT STARTED
6C.0F provider attachment and cutover preparation           NOT STARTED
6C.1 customer onboarding bridge                             NOT STARTED
```

Do not attach the shared PostgreSQL database, create production roles/grants, run migrations, import legacy data or deploy `hung-phat-mcp` before the later gates and explicit owner approval.

## Separate MCP Vercel blocker

The guarded MCP Vercel production workflow still lacks safe GitHub Actions sources for these variable names:

```text
MCP_BACKEND_API_BASE_URL
MCP_BACKEND_API_TOKEN
MCP_SUPABASE_URL
MCP_SUPABASE_ANON_KEY
```

Do not rerun `/deploy-vercel-mcp-production` until their sources are recovered and configured. This blocker is separate from Phase 6C.0D.

## Production evidence boundary

Not claimed or assumed:

- MCP Vercel production deployment from the current `main`;
- MCP Heroku production deployment;
- shared PostgreSQL attachment to MCP;
- `mcp` production schema, role or grants;
- backup or restore rehearsal;
- production migration or legacy-data reconciliation;
- Core migration `040` production registry state;
- any provider cutover.

> Updated: `2026-08-02`  
> Current checkpoint: Phase 6C.0D source implementation on Issue #145.
