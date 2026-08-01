# NPP Platform — Latest Handoff

## Current source checkpoint

- Repository: `binhnxwjfjxm/NPP-Platform`.
- Production branch: `main`.
- Exact audited baseline before Phase 6C.0C: `87a3151f8c0897e3418f65fcc76d38abdabbcbf7`.
- PR #130 merged Phase 6C.0A repository/data-contract audit.
- PR #136 merged Phase 6C.0B provider-neutral PostgreSQL persistence boundary.
- PR #142 merged the guarded MCP Vercel runtime-source contract.
- Exact latest `main` must be re-audited before PR review or any later task.

Source merge does not prove production deployment, provider configuration, database migration, backup or cutover.

## Active work

Issue:

```text
#143 — Phase 6C.0C — harden MCP backend-owned writes, auth and audit
```

Branch:

```text
agent/phase-6c0c-mcp-write-hardening
```

Scope is source-only:

```text
server-owned principal/request context
deny-by-default authorization
backend-owned write command contract
idempotency fingerprint and replay semantics
transactional audit/outbox envelope
fixture-based rollback and sanitization tests
```

No production provider or database mutation is authorized.

## Locked runtime conclusions

The active production MCP backend path remains:

```text
bootstrap.js
-> config.js
-> persistence.js
-> postgresql-adapter.js
-> gateway.js
```

Production does not fall back to Supabase. Protected business routes remain fail-closed until PostgreSQL-owned repositories and schema mappings are implemented.

The default service authorization policy is intentionally empty. Future permissions/scopes must be backend-owned configuration or a trusted identity resolver result; browser headers cannot grant identity or access.

## Phase 6C sequence

```text
6C.0A repository/data contract audit                       MERGED
6C.0B provider-neutral persistence boundary                MERGED
6C.0C backend-owned writes/auth/idempotency/audit-outbox   ACTIVE
6C.0D PostgreSQL mcp schema and repositories               NOT STARTED
6C.0E backup/restore/migration rehearsal and reconciliation NOT STARTED
6C.0F provider/cutover preparation                          NOT STARTED
6C.1 customer onboarding bridge                             NOT STARTED
```

Do not start 6C.0D before the 6C.0C exact-head tests and review gate are complete. Do not attach the shared PostgreSQL database, create production roles, migrate data or deploy `hung-phat-mcp` before the later gates and owner approval.

## MCP Vercel blocker

The guarded MCP Vercel production workflow still lacks these GitHub Actions secret sources:

```text
MCP_BACKEND_API_BASE_URL
MCP_BACKEND_API_TOKEN
MCP_SUPABASE_URL
MCP_SUPABASE_ANON_KEY
```

Do not rerun `/deploy-vercel-mcp-production` until their safe sources are recovered and configured. This blocker is separate from Phase 6C.0C.

## Production evidence boundary

Not claimed or assumed:

- MCP Vercel production deployment from `87a3151...`;
- MCP Heroku production deployment;
- shared PostgreSQL attachment to MCP;
- `mcp` production schema/role/grants;
- backup or restore rehearsal;
- migration or legacy-data reconciliation;
- Core migration `040` production registry state;
- any provider cutover.

> Updated: `2026-08-02`  
> Current checkpoint: Phase 6C.0C source implementation on Issue #143.
