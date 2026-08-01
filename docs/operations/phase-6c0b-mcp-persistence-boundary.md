# Phase 6C.0B — MCP backend persistence boundary

## Scope and evidence base

- Base commit: `4708ca861433e283660f338f33fe34885cde8561`
- Issue: #135
- Runtime in scope: `mcp/apps/backend/**` and the isolated MCP Heroku workflows
- Production mutations in this phase: none
- Database attachment, schema migration, data migration, deploy and cutover: not performed

PR #133 established a transitional container/deploy contract while the MCP backend still depended on Supabase. This Phase 6C.0B contract supersedes that runtime dependency; PR #133 remains historical deployment evidence.

## Runtime boundary

The production bootstrap path is now:

`bootstrap.js -> config.js -> persistence.js -> postgresql-adapter.js -> gateway.js`

The production path does not import `server.js`, the legacy business handler bundle, or the legacy Supabase adapter. `PERSISTENCE_PROVIDER=postgresql` is mandatory in production. Legacy provider selection and `MCP_LEGACY_RUNTIME_ENABLED=true` are rejected by production configuration.

Legacy behavior remains available only as an explicitly selected, non-production compatibility path:

`bootstrap.js -> dynamic import legacy-runtime.js -> legacy handlers/server -> legacy-supabase-adapter.js`

There is no automatic fallback from PostgreSQL to Supabase. A frontend request cannot select a persistence provider.

## PostgreSQL contract

Backend-only settings:

- `DATABASE_URL`
- `MCP_DB_SCHEMA` (default `mcp`)
- `MCP_DB_ROLE` (expected runtime role)
- `MCP_DB_POOL_MAX`
- `MCP_DB_CONNECT_TIMEOUT_MS`
- `MCP_DB_IDLE_TIMEOUT_MS`
- `MCP_DB_STATEMENT_TIMEOUT_MS`

The adapter:

- uses a bounded `pg.Pool`;
- sets `search_path=mcp,public` and a statement timeout at connection time;
- checks the current database role when `MCP_DB_ROLE` is configured;
- checks that the `mcp` schema exists before reporting ready;
- closes the pool during graceful shutdown;
- returns stable readiness codes without exposing connection strings, SQL errors, hostnames, roles or stack traces through the public API.

The database role and privilege grants are not created here. They belong to Phase 6C.0D migrations and must be rehearsed before production.

## Health behavior

- `/health/live` and `/` report process/gateway liveness and do not query the database.
- `/health/ready`, `/health` and `/api/health` return `200` only when the persistence adapter is ready.
- Missing or unreachable database configuration returns a sanitized `503 PROVIDER_UNAVAILABLE` readiness response while liveness remains `200`.

The Docker CI smoke intentionally omits `DATABASE_URL` and verifies live `200` plus ready `503`. The manual production workflow still requires ready `200`, so it cannot deploy successfully until the shared database contract is configured and the schema gate is complete.

## Business route state

Existing Supabase-backed handlers and `server.js` are retained for audit/reconciliation and non-production compatibility only. They are not part of the active production import graph. Protected business routes fail closed until PostgreSQL-owned repositories and schema mappings are introduced under the subsequent Phase 6C gates.

This is deliberate: silently falling back to Supabase or translating arbitrary table/RPC calls into SQL would preserve the wrong provider coupling.

## Reference classification

| Classification | Examples | Phase 6C.0B treatment |
| --- | --- | --- |
| Active production runtime | `bootstrap.js`, `gateway.js`, `persistence.js`, `postgresql-adapter.js` | PostgreSQL only; no Supabase REST/RPC/service-role handling |
| Transitional compatibility | `legacy-runtime.js`, `supabase-adapter.js`, `legacy-supabase-adapter.js`, existing handler modules, `server.js` | Explicit non-production selection only; no production fallback |
| Test fixture | Foundation tests and Heroku runtime/contract fixtures | Updated for PostgreSQL readiness and no Supabase env in Docker |
| Migration/audit history | `mcp/supabase/**`, historical runbooks, retirement evidence | Preserved for reconciliation; not treated as active runtime |
| Frontend/server legacy | `mcp/src/server/**` references and prior frontend integration evidence | Audited but not removed in this backend-only phase |
| Obsolete transitional deploy contract | Supabase requirements in the PR #133 workflow | Replaced by DATABASE_URL/schema/role preflight |

Machine-readable evidence is recorded in `mcp/audit/phase-6c0b/runtime-dependency-inventory.json`.

## Remaining gates

Phase 6C.0B does not authorize production deployment. Before runtime cutover:

1. Phase 6C.0C must harden backend-owned writes, authorization, idempotency and audit/outbox behavior.
2. Phase 6C.0D must add repository-owned migrations for the `mcp` schema, tables, constraints, indexes, role, grants and search path.
3. Phase 6C.0E must provide confirmed backup evidence, restore rehearsal, migration rehearsal, legacy mapping, pre/post reconciliation and rollback/forward-fix evidence.
4. Only after owner approval may `DATABASE_URL` and the runtime role be configured on `hung-phat-mcp`, followed by an exact-main deploy and real live/ready smoke.
