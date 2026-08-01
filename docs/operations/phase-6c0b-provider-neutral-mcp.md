# Phase 6C.0B — Provider-neutral MCP backend runtime

Base source: `main@4708ca861433e283660f338f33fe34885cde8561`

This change supersedes the transitional Supabase runtime contract introduced by PR #133. It is a code and deployment-contract change only. It does not attach a database, create the `mcp` schema, run a migration, deploy either Heroku app, or mutate production data.

## Locked runtime boundary

Production MCP backend uses:

`MCP frontend -> hung-phat-mcp -> PostgreSQL installation database -> mcp-owned schema/domain`

Production requires `PERSISTENCE_PROVIDER=postgresql`. `MCP_LEGACY_RUNTIME_ENABLED` must be false. The frontend cannot select the persistence provider and never receives `DATABASE_URL` or database credentials.

The PostgreSQL adapter owns pool construction, connection timeout, idle timeout, statement timeout, role verification, schema availability and `search_path` verification. The intended boundary is an MCP-specific runtime role whose first `search_path` entry is the configured MCP schema. Exact role creation and privileges remain Phase 6C.0D migration work.

## Health semantics

- `/health/live` and `/` report process/gateway liveness and do not depend on PostgreSQL.
- `/health/ready`, `/health`, and `/api/health` return 200 only when the persistence adapter confirms the configured PostgreSQL schema, role and `search_path` boundary.
- Missing or unreachable database configuration returns a sanitized 503 readiness response. SQL, connection details, provider diagnostics and stack traces are not exposed.

## Supabase reference classification

### Active production runtime

The active production import graph is `bootstrap.js -> persistence.js -> postgresql-adapter.js -> gateway.js`. It does not read Supabase environment variables, build `/rest/v1` or `/rpc` URLs, or load the legacy server.

### Transitional compatibility adapter

`foundation/supabase-adapter.js`, `foundation/legacy-supabase-adapter.js`, `foundation/legacy-runtime.js`, and `server.js` remain for controlled non-production reconciliation and regression evidence. They are not statically imported by the production path. Production config rejects the legacy provider and rejects enabling the legacy runtime.

### Existing handler layer

Existing handler and mutation modules retain their API, request context, authorization, idempotency and canonical error behavior. Direct REST/RPC construction and service-role handling remain confined to the legacy adapter/server boundary. Until PostgreSQL domain repositories are mapped in later phases, production business requests fail closed rather than silently falling back to Supabase.

### Frontend server code

Historical frontend server utilities and old Supabase references are not deleted in this phase. They remain subject to the existing direct-mutation retirement contracts and migration reconciliation. No frontend is allowed to connect directly to PostgreSQL.

### Migration and documentation history

`mcp/supabase/**`, migration inventories, audit files and prior runbooks are retained as source-system history. They are not evidence that Supabase remains the target runtime.

## Packaging and deployment contract

- `mcp/apps/backend/package.json` declares `pg` directly.
- `mcp/apps/backend/package-lock.json` provides a standalone locked container install.
- Docker builds install production dependencies with `npm ci` and do not receive Supabase environment variables.
- The manual Heroku workflow requires PostgreSQL runtime variables and no longer forbids `DATABASE_URL`.
- Auto Deploy remains off and this phase performs no production deployment.

## Remaining gates

Phase 6C.0C: backend-owned writes, authentication/authorization, idempotency and audit/outbox hardening.

Phase 6C.0D: repository migrations for the `mcp` schema, tables, indexes, constraints, runtime role, privileges and `search_path`.

Phase 6C.0E: confirmed backup, restore rehearsal, migration rehearsal, legacy mapping, reconciliation and rollback/forward-fix evidence.

Only after those gates may the owner approve attaching the shared `DATABASE_URL`, configuring the MCP database role, deploying exact `main`, scaling the web process and performing production smoke/cutover.
