# NPP Platform — Latest Handoff

## Current source checkpoint

- Repository: `binhnxwjfjxm/NPP-Platform`.
- Production branch: `main`.
- Exact audited baseline before Phase 6C.0F: `7b93572453e31c7f099b2e0420b5258590c151b9`.
- PR #130 merged Phase 6C.0A repository/data-contract audit.
- PR #136 merged Phase 6C.0B provider-neutral PostgreSQL persistence boundary.
- PR #142 merged the guarded MCP Vercel runtime-source contract.
- PR #144 merged Phase 6C.0C backend-owned writes, authorization, idempotency and audit/outbox contract.
- PR #146 merged Phase 6C.0D MCP PostgreSQL schema, migration runner and write repositories.
- PR #148 merged Phase 6C.0E disposable backup/restore rehearsal and reconciliation evidence.
- Exact latest `main` must be re-audited before PR review, merge or any later operation.

Source merge does not prove production deployment, provider configuration, database attachment, backup, reconciliation, migration or cutover.

## Active work

Issue:

```text
#149 — Phase 6C.0F — prepare guarded MCP provider attachment and cutover evidence
```

Branch:

```text
agent/phase-6c0f-mcp-provider-cutover-prep
```

Scope is source-only:

```text
runtime and migrator credential separation
non-secret provider/cutover plan contract
read-only target identity and privilege preflight
least-privilege runtime-role verification
PostgreSQL 17 positive and over-privileged role tests
sanitized machine-readable evidence
exact-head CI and operator runbook
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

The production runtime connection must use a restricted MCP role. Production migration commands require a separate operator-only migrator credential. The migrator credential must not be stored in the `hung-phat-mcp` runtime environment.

Phase 6C.0F prepares a read-only preflight and an operator plan. It does not attach the shared PostgreSQL database, provision roles, run a migration, deploy the backend or switch field traffic.

## Phase 6C sequence

```text
6C.0A repository/data contract audit                        MERGED
6C.0B provider-neutral persistence boundary                 MERGED
6C.0C backend writes/auth/idempotency/audit-outbox contract MERGED
6C.0D PostgreSQL mcp schema and write repositories          MERGED
6C.0E backup/restore/migration rehearsal and reconciliation MERGED
6C.0F provider attachment and cutover preparation           ACTIVE
6C.1 customer onboarding bridge                             NOT STARTED
```

Do not attach the shared PostgreSQL database, create production roles/grants, request a production backup, run production migrations, import legacy data, deploy `hung-phat-mcp` or switch field traffic without a separately approved operation.

## Separate MCP Vercel blocker

The guarded MCP Vercel production workflow still lacks safe GitHub Actions sources for these variable names:

```text
MCP_BACKEND_API_BASE_URL
MCP_BACKEND_API_TOKEN
MCP_SUPABASE_URL
MCP_SUPABASE_ANON_KEY
```

Do not rerun `/deploy-vercel-mcp-production` until their sources are recovered and configured. This blocker is separate from Phase 6C.0F.

## Production evidence boundary

Not claimed or assumed:

- current MCP Heroku release or runtime configuration;
- current MCP Vercel deployment or environment state;
- current auto-deploy state at either provider without a fresh provider audit;
- shared PostgreSQL attachment to MCP;
- production `mcp` schema, runtime role, migrator role or grants;
- a current production backup;
- a restore rehearsal using a real production backup;
- production migration or live legacy-data reconciliation;
- Core migration `040` production registry state;
- any backend deployment, field-handler switch or traffic cutover.

> Updated: `2026-08-02`  
> Current checkpoint: Phase 6C.0F source implementation on Issue #149.
