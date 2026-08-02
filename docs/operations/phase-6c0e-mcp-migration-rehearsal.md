# Phase 6C.0E — MCP backup, restore and migration rehearsal

> Status: **SOURCE REHEARSAL TOOLING — NO PRODUCTION OPERATION**  
> Issue: `#147`  
> Branch: `agent/phase-6c0e-mcp-migration-rehearsal`  
> Baseline: `main@fdad65c3eba8c9b296b4c59c1c6e66da3f0dfba5`  
> Date: `2026-08-02`

## 1. Purpose

Phase 6C.0D added the MCP-owned PostgreSQL migration and write repositories. Phase 6C.0E adds a guarded rehearsal runner that proves those migrations can coexist with the current Core migrations in one installation database, survive a logical backup and restore, and produce machine-readable reconciliation evidence.

This slice does not request, download or inspect a production backup. It does not attach PostgreSQL to `hung-phat-mcp`, create a production role, run a production migration, import Supabase/VPS data, or change a provider.

## 2. Rehearsal topology

The runner uses one explicitly supplied administrative connection to a disposable PostgreSQL cluster. It creates three randomly named databases:

```text
source
restore
regression
```

The supplied administrative database is never migrated. It is used only to create and drop the randomly named rehearsal databases.

The sequence is:

```text
create source database
-> apply current Core migrations
-> apply current MCP migrations
-> prove second run is a no-op
-> verify Core and MCP contracts
-> seed non-sensitive MCP fixture rows
-> prove audit is append-only
-> capture source snapshot
-> pg_dump custom-format backup
-> calculate SHA-256

create restore database
-> pg_restore backup
-> prove Core and MCP migrations are no-op
-> verify contracts and append-only audit
-> capture restore snapshot
-> reconcile source and restore

create regression database
-> apply current Core and MCP migrations from clean state
-> prove second run is a no-op
-> verify both contracts

validate Phase 6C.0A legacy-order fixture
-> clean up all three databases and the dump
-> write report
```

## 3. Safety boundary

The runner fails closed unless:

```text
NODE_ENV is not production
MCP_MIGRATION_REHEARSAL_CONFIRM=temporary-database
DATABASE_URL is a PostgreSQL URL with a database name
```

Any Core production migration confirmation variable is forbidden during rehearsal.

Localhost is the default permitted target:

```text
localhost
127.0.0.1
::1
```

A remote target is allowed only when both of these are supplied:

```text
MCP_MIGRATION_REHEARSAL_ALLOW_REMOTE=true
MCP_MIGRATION_REHEARSAL_REMOTE_CONFIRM=isolated-non-production-cluster
```

Those values mean the operator has already verified that the remote cluster is isolated and non-production. They do not authorize use of the live installation database.

Generated database names are fixed to the `npp_mcp6c0e_*` prefix. The runner never accepts a source, restore or regression database name from user input.

## 4. Commands

From the repository root:

```bash
NODE_ENV=test \
DATABASE_URL='postgresql://<user>:<password>@127.0.0.1:5432/postgres' \
MCP_MIGRATION_REHEARSAL_CONFIRM=temporary-database \
node mcp/apps/backend/scripts/rehearse-mcp-migrations.js
```

The PostgreSQL client tools must match the server major version. The runner uses `pg_dump` and `pg_restore` by default. Exact binaries may be selected with:

```text
MCP_PG_DUMP_BIN
MCP_PG_RESTORE_BIN
```

No migration is run automatically by MCP backend startup.

## 5. Reconciliation

The source and restored snapshots compare:

- every installation migration ID in `shared.schema_migrations`;
- every table in the `mcp` schema;
- row counts for each MCP table;
- deterministic SHA-256 checksums of sorted JSON rows;
- MCP constraints;
- MCP indexes;
- MCP triggers.

All fields must match. The audit mutation trigger must reject an update both before backup and after restore.

The runner also validates the Phase 6C.0A fixture against exactly these five classes:

```text
OFFICIAL_ORDER_MIGRATION_CANDIDATE
FIELD_ORDER_INTENT
SAMPLE_TEST_DEMAND
HISTORICAL_DISPLAY_ONLY
INVALID_ORPHAN_RECONCILIATION_REQUIRED
```

This fixture check proves the source contract remains aligned. It is not a reconciliation of live legacy records.

## 6. Evidence report

The runner writes:

```text
mcp/artifacts/migration-rehearsal-phase-6c0e-report.json
```

The report schema is:

```text
mcp/audit/phase-6c0e/rehearsal-report.schema.json
```

The report contains:

- exact source commit or `local`;
- start and finish timestamps;
- success or failure;
- hashed source, restore and regression database identifiers;
- Core and MCP first/second migration results;
- verification results;
- PostgreSQL server version;
- backup format, size and SHA-256;
- reconciliation booleans;
- source and restored append-only proof;
- locked legacy-order classification summary;
- cleanup results;
- sanitized errors.

It does not contain:

- a database URL;
- username, password or hostname;
- raw database names;
- provider tokens;
- production identifiers.

A successful report requires full reconciliation, append-only proof, zero unclassified fixture records, all temporary databases dropped, the dump removed and no errors.

## 7. CI

`.github/workflows/phase-6c0e-mcp-migration-rehearsal.yml` uses PostgreSQL 17 and matching PostgreSQL 17 client tools. It:

- checks out the exact PR head;
- rejects Core source, migration and production release-workflow changes;
- syntax-checks the runner;
- runs the Phase 6C.0E contract tests;
- runs the full MCP backend verification against disposable PostgreSQL;
- runs source → backup → restore → reconciliation;
- validates and scans the report for sensitive values;
- uploads the report whether the job succeeds or fails.

The workflow has read-only repository permission and no provider credentials.

## 8. What this proves

A green exact-head run proves that the current repository source can:

- apply Core and MCP migrations together on a fresh PostgreSQL 17 database;
- rerun both migration sets without applying duplicates;
- survive logical custom-format backup and restore;
- preserve MCP schema and fixture data exactly;
- preserve the append-only audit control;
- produce sanitized evidence and clean up disposable resources.

## 9. What this does not prove

A green CI run does not prove:

- that a current production backup exists;
- that a production backup can be downloaded;
- that a real production-sized restore fits the maintenance window;
- that live Supabase/VPS data passes read-only audit;
- that identity, SKU/unit and legacy-order mappings are complete;
- that production roles and grants are correct;
- that provider attachment or cutover is safe.

Those facts must be audited using real provider evidence in a separately authorized operation before Phase 6C.0F.

## 10. Next gate

After this source PR is reviewed and merged, the next work is Phase 6C.0F provider attachment and cutover preparation. It remains blocked until a real backup is verified, a restore rehearsal is run on an isolated target, reconciliation evidence is reviewed and an operator/rollback window is approved.
