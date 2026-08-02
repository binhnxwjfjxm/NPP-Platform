# NPP Platform — Latest Handoff

## Current source checkpoint

- Repository: `binhnxwjfjxm/NPP-Platform`.
- Production branch: `main`.
- Exact audited baseline before Phase 6C.0E: `fdad65c3eba8c9b296b4c59c1c6e66da3f0dfba5`.
- PR #130 merged Phase 6C.0A repository/data-contract audit.
- PR #136 merged Phase 6C.0B provider-neutral PostgreSQL persistence boundary.
- PR #142 merged the guarded MCP Vercel runtime-source contract.
- PR #144 merged Phase 6C.0C backend-owned writes, authorization, idempotency and audit/outbox contract.
- PR #146 merged Phase 6C.0D MCP PostgreSQL schema, migration runner and write repositories.
- Exact latest `main` must be re-audited before PR review, merge or any later task.

Source merge does not prove production deployment, provider configuration, database attachment, backup, reconciliation or cutover.

## Active work

Issue:

```text
#147 — Phase 6C.0E — add guarded MCP backup/restore rehearsal and reconciliation evidence
```

Branch:

```text
agent/phase-6c0e-mcp-migration-rehearsal
```

Scope is source-only:

```text
disposable source/restore/regression database runner
Core + MCP migration coexistence proof
custom-format backup and restore
schema/data/checksum reconciliation
append-only audit proof
legacy-order fixture alignment
sanitized machine-readable evidence
PostgreSQL 17 exact-head CI
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

Production does not fall back to Supabase. Protected field-domain routes remain fail-closed until reviewed repositories are implemented and explicitly cut over.

The default MCP service authorization policy remains empty. Browser headers cannot grant installation identity, employee identity, roles, permissions or scopes.

Phase 6C.0E does not attach a production database or create a production runtime role. Rehearsal defaults to localhost/disposable PostgreSQL; a remote isolated target requires a separate dual confirmation and still must not be production.

## Phase 6C sequence

```text
6C.0A repository/data contract audit                        MERGED
6C.0B provider-neutral persistence boundary                 MERGED
6C.0C backend writes/auth/idempotency/audit-outbox contract MERGED
6C.0D PostgreSQL mcp schema and write repositories          MERGED
6C.0E backup/restore/migration rehearsal and reconciliation ACTIVE
6C.0F provider attachment and cutover preparation           NOT STARTED
6C.1 customer onboarding bridge                             NOT STARTED
```

Do not attach the shared PostgreSQL database, create production roles/grants, run production migrations, import legacy data or deploy `hung-phat-mcp` before the later gates and explicit owner approval.

## Separate MCP Vercel blocker

The guarded MCP Vercel production workflow still lacks safe GitHub Actions sources for these variable names:

```text
MCP_BACKEND_API_BASE_URL
MCP_BACKEND_API_TOKEN
MCP_SUPABASE_URL
MCP_SUPABASE_ANON_KEY
```

Do not rerun `/deploy-vercel-mcp-production` until their sources are recovered and configured. This blocker is separate from Phase 6C.0E.

## Production evidence boundary

Not claimed or assumed:

- MCP Vercel production deployment from the current `main`;
- MCP Heroku production deployment;
- shared PostgreSQL attachment to MCP;
- `mcp` production schema, role or grants;
- a current production backup;
- a restore rehearsal using a real production backup;
- production migration or live legacy-data reconciliation;
- Core migration `040` production registry state;
- any provider cutover.

> Updated: `2026-08-02`  
> Current checkpoint: Phase 6C.0E source implementation on Issue #147.
