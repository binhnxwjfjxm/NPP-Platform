# Phase 6C.0F — MCP provider attachment and cutover preparation

> Status: **SOURCE PREPARATION — NO PROVIDER MUTATION**  
> Issue: `#149`  
> Branch: `agent/phase-6c0f-mcp-provider-cutover-prep`  
> Baseline: `main@7b93572453e31c7f099b2e0420b5258590c151b9`  
> Date: `2026-08-02`

## 1. Purpose

Phase 6C.0E proved the current Core and MCP migrations on disposable PostgreSQL 17, including backup, restore, reconciliation and cleanup. Phase 6C.0F prepares the evidence and read-only preflight required before an accountable operator may propose a real provider attachment or migration window.

No production mutation is authorized by this source phase.

This phase does not:

- inspect or claim current Heroku configuration without operator evidence;
- request or download a production backup;
- create a PostgreSQL role or grant;
- attach a database to `hung-phat-mcp`;
- run a production migration;
- deploy either Heroku backend or any Vercel frontend;
- switch field traffic or retire the legacy source.

## 2. Locked runtime topology

```text
5 Vercel frontends
2 Heroku backends
1 shared PostgreSQL installation
```

Runtime ownership remains:

```text
npp-core/** -> hung-phat
mcp/**      -> hung-phat-mcp
```

The MCP runtime role may write only reviewed MCP-owned objects. Core-owned schemas remain outside the MCP write boundary.

## 3. Runtime and migrator credential separation

The runtime application receives only the restricted runtime connection through:

```text
DATABASE_URL
```

Production migration commands require a separate operator-only connection through:

```text
MCP_MIGRATION_DATABASE_URL
```

The migration credential must not be persisted in the `hung-phat-mcp` runtime configuration. Backend production startup rejects `MCP_MIGRATION_DATABASE_URL` if it is present in the runtime environment.

The migration CLI rejects production execution unless:

1. `DATABASE_URL` is present so runtime identity can be compared;
2. `MCP_MIGRATION_DATABASE_URL` is present;
3. runtime and migrator credential identities differ;
4. the existing production migration dual confirmation is present.

The separation check compares role, host, port and database identity. A different password for the same role is not accepted as separation.

## 4. Restricted runtime privilege contract

The current write repositories require this exact runtime surface:

```text
schema mcp
  USAGE                            required
  CREATE                           forbidden

mcp.idempotency_records
  SELECT, INSERT, UPDATE           required
  DELETE                           forbidden

mcp.audit_events
  INSERT                           required
  SELECT, UPDATE, DELETE           forbidden

mcp.outbox_events
  INSERT                           required
  SELECT, UPDATE, DELETE           forbidden
```

The runtime role must have no `CREATE` privilege on `shared`, `sales`, `purchasing`, `inventory`, `logistics`, `accounting` or `reporting`, and no table write privilege in those schemas.

The migrator role is a separate operator credential. It is not loaded by normal backend startup and is not exposed to business handlers.

## 5. Read-only preflight

The preflight uses two connections supplied only in an approved operator shell:

```text
runtime connection -> verify actual current_user and active search_path
migrator/audit connection -> inspect schema, migrations, objects and runtime-role grants
```

Both sessions set transaction read-only mode. The source implementation issues only:

```text
BEGIN READ ONLY
SELECT ...
ROLLBACK
```

It does not execute DDL, DML, provider API calls or deployment commands.

The preflight verifies:

- both connections point to the same hashed database identity;
- runtime `current_user` equals the approved MCP role;
- active `search_path` starts with `mcp`;
- `mcp_001_write_foundation` is the exact expected MCP migration set;
- idempotency, audit and outbox objects exist;
- append-only audit trigger exists;
- pending outbox index exists;
- runtime grants match the least-privilege contract;
- no Core-schema create or Core-table write privilege exists.

Reports include only hashed database identity and non-secret evidence. URLs, usernames, passwords and hosts are redacted.

## 6. Cutover-plan evidence

The repository fixture is intentionally:

```text
DRAFT_NOT_AUTHORIZED
```

A real plan cannot be considered ready until an accountable operator supplies:

- exact current `main` commit;
- current MCP Heroku release evidence;
- current MCP Vercel deployment evidence;
- proof both auto-deploy settings remain off;
- a current verified production backup reference;
- restore-rehearsal evidence;
- distinct runtime and migrator role names;
- approved maintenance window;
- accountable operator and rollback owner;
- previous release and configuration evidence;
- abort criteria.

The plan stores names and opaque evidence references only. It must never contain tokens, passwords, database URLs, connection strings, provider attachment values or API keys.

## 7. Required operation order

```text
audit-provider-state
verify-current-backup
verify-restore-rehearsal
provision-separate-migrator-role
provision-restricted-runtime-role
attach-runtime-database
run-mcp-migrations
run-read-only-preflight
deploy-mcp-backend
smoke-health-live
smoke-health-ready
hold-field-traffic-cutover
```

`hold-field-traffic-cutover` is deliberate. Phase 6C.0F prepares provider attachment and backend readiness only. Existing field-domain handlers are not switched by this phase.

## 8. Health verification boundary

After a separately authorized MCP backend deployment, the operator must verify:

```text
/health/live
/health/ready
```

`/health/ready` must prove the expected role, `mcp`-first search path and schema readiness. A Heroku release status alone is not sufficient. No Core backend deployment is implied by MCP-only source changes.

## 9. Abort and rollback model

The operation must stop before mutation when any evidence is missing or stale.

Rollback is triggered when:

- readiness does not recover inside the approved window;
- runtime role or search path differs from the approved plan;
- MCP migration verification fails;
- the runtime role has any forbidden Core write privilege;
- live or ready smoke fails;
- reconciliation differs from the approved baseline.

The migration is additive. The rollback database strategy is:

```text
LEAVE_ADDITIVE_MCP_SCHEMA_INERT
```

Rollback means restoring the previous backend release and approved runtime configuration. It does not mean running an unreviewed destructive down migration.

## 10. Source commands

Structural validation:

```bash
npm --prefix mcp/apps/backend run cutover:validate
```

Focused tests:

```bash
npm --prefix mcp/apps/backend run test:provider-cutover
npm --prefix mcp run test:phase-6c0f-cutover
```

A later explicitly approved operator window may run:

```bash
node mcp/apps/backend/scripts/provider-cutover-preflight.js verify-target
```

The operator must inject `DATABASE_URL` and `MCP_MIGRATION_DATABASE_URL` from an approved secure source without storing or printing their values. Production access also requires the dedicated read-only preflight confirmations.

## 11. Acceptance

The source phase is accepted when:

- runtime startup rejects a persisted migrator credential;
- production migration commands require distinct runtime and migrator identities;
- plan validation rejects secrets and claims that production mutations occurred;
- read-only preflight accepts the restricted test role;
- read-only preflight rejects DDL or Core-write privilege;
- PostgreSQL 17 integration coverage passes;
- exact-head CI and existing MCP regressions are green;
- no provider or production mutation occurred.

## 12. Next gate

Phase 6C.1 may start only after Phase 6C.0F source is merged. Customer onboarding work must keep field outlets separate from official Core customers until explicit reconciliation and approval.
