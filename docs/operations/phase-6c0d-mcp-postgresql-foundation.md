# Phase 6C.0D — MCP PostgreSQL schema and write repositories

> Status: **SOURCE IMPLEMENTATION — NO PRODUCTION MUTATION**  
> Issue: `#145`  
> Branch: `agent/phase-6c0d-mcp-postgresql-foundation`  
> Baseline: `main@a22e9d7890222daef1738f805f2542c4c793c9da`  
> Date: `2026-08-02`

## 1. Purpose

Phase 6C.0C locked the backend-owned write command, authorization, idempotency, audit and outbox contract. Phase 6C.0D supplies the PostgreSQL implementation behind that contract without attaching production, migrating production data or cutting any legacy field handler over.

The target runtime remains:

```text
MCP frontend
-> MCP API
-> backend-owned command
-> MCP repository transaction
-> shared PostgreSQL cluster / mcp schema
```

The MCP backend may write only MCP-owned data. Official customers, Sales Orders, inventory, logistics and accounting remain Core-owned and are reached later through canonical Core APIs.

## 2. Migration ownership

MCP migrations live under:

```text
database/migrations/mcp/
```

They use MCP-prefixed IDs in the installation-wide registry:

```text
shared.schema_migrations
mcp_001_write_foundation
```

A separate MCP migration runner is kept under `mcp/apps/backend/foundation/migrations`. It does not import the Core migration list or make the MCP service responsible for Core-owned migrations.

The canonical SQL remains under `database/migrations/mcp/`. An exact byte-for-byte packaged mirror is kept under the backend migration directory because the MCP container build context is intentionally limited to `mcp/apps/backend`. A source-contract test rejects any drift between the canonical and packaged copies.

The runner:

- validates migration IDs and bodies;
- orders migrations deterministically;
- takes a transaction-scoped PostgreSQL advisory lock;
- applies pending MCP migrations and their registry row in one transaction;
- rolls back on failure;
- supports `status`, `migrate` and `verify`;
- redacts database URLs and connection details;
- denies production commands unless two explicit operator confirmations are present.

Production execution is not part of this phase.

## 3. Write-foundation schema

Migration `mcp_001_write_foundation` creates only:

```text
mcp.idempotency_records
mcp.audit_events
mcp.outbox_events
```

### Idempotency

The unique scope is:

```text
installation_id + command_name + idempotency_key
```

A record stores the canonical SHA-256 fingerprint and one of:

```text
in_progress
completed
```

The transaction repository maps that persisted state to the Phase 6C.0C outcomes:

```text
inserted                         -> claimed
completed + same fingerprint     -> replay
same key + different fingerprint -> conflict
in_progress + same fingerprint   -> in_progress
```

A failed command transaction rolls back its new claim. Completion stores the original response in the same transaction as the domain mutation, audit event and outbox event.

### Audit

`mcp.audit_events` stores the event/aggregate, installation, actor, request, idempotency, action, permission, scope and payload evidence required by the command contract.

A trigger rejects update and delete. Corrections must be represented by later events, not by rewriting audit history.

### Outbox

`mcp.outbox_events` begins in `pending` state and includes a pending/available index for a future publisher. Publication processing is deliberately not added in this phase.

## 4. Runtime role and grant boundary

The migration revokes public access to the MCP schema objects. It deliberately does not create, alter or grant a named production role.

Role provisioning is a provider operation and remains gated until Phase 6C.0F. The expected runtime contract is:

```text
current_user = configured MCP_DB_ROLE
search_path begins with mcp
USAGE on schema mcp
only reviewed runtime privileges on MCP-owned objects
no write privilege on shared, sales, purchasing, inventory, logistics or accounting
```

The PostgreSQL readiness adapter checks the configured role, schema availability and active search path. The write repository additionally refuses any persistence adapter whose schema is not exactly `mcp`.

## 5. Transaction repository boundary

`createPostgresqlWriteTransaction` exposes only:

```text
tx.idempotency.claim
tx.idempotency.complete
tx.audit.append
tx.outbox.enqueue
tx.repositories
```

Business command handlers do not receive the raw pool, client or query function. Domain repositories must be explicitly composed by backend code and are frozen before use. Top-level generic `client`, `pool`, `query`, `sql`, `table`, `rpc` and `provider` capabilities are rejected at every nested repository level.

The PostgreSQL adapter performs:

```text
BEGIN
SET LOCAL search_path TO mcp, public
command callback
COMMIT
```

Any error causes `ROLLBACK`, and the checked-out client is always released.

## 6. Verification

The source gate covers:

- migration ordering, registry namespace, advisory lock and rollback;
- canonical/package SQL equality and migration ownership;
- production migration guard and diagnostic redaction;
- readiness role/schema/search-path checks;
- transaction commit, rollback and client release;
- fixed repository surface and generic capability rejection;
- claim, completion, replay, conflict and in-progress behavior;
- PostgreSQL 17 clean apply, rerun no-op and structural verification;
- atomic rollback across audit and outbox;
- append-only audit enforcement;
- full existing MCP backend verification.

The dedicated workflow uses a disposable PostgreSQL 17 service. It never connects to production.

## 7. Deliberate non-scope

This phase does not:

- execute a production migration;
- attach a database to `hung-phat-mcp`;
- create or alter production roles/grants;
- deploy Heroku or Vercel;
- import Supabase/VPS data;
- cut existing field-domain handlers over to PostgreSQL;
- implement the outbox publisher;
- retry the separate MCP Vercel blocker;
- change Core source or Core migrations;
- implement customer onboarding.

## 8. Next gate

After source review and merge, Phase 6C.0E must prove backup, restore and migration rehearsal with before/after reconciliation. Provider attachment and cutover preparation remain Phase 6C.0F and require separate owner approval.
