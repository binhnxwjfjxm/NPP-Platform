# Migration Rehearsal

This runbook describes the Phase 2 migration rehearsal foundation for the NPP Core API. It verifies migrations against disposable PostgreSQL databases only. It does **not** confirm that any production backup exists or that production is ready for migration.

## Purpose

The rehearsal proves that the current Core migrations:

- apply cleanly to a fresh database;
- apply nothing on a second run;
- create the required `shared` tables, constraints, indexes, and audit append-only trigger;
- accept non-sensitive sample foundation data;
- survive a logical custom-format `pg_dump` and `pg_restore` cycle;
- reconcile migration IDs, row counts, data checksums, constraints, indexes, and triggers;
- clean up source and restored rehearsal databases even after failure.

## Commands

From the repository root:

```bash
npm run migration:rehearse
```

From `npp-core/api`:

```bash
npm run migration:status
npm run migration:migrate
npm run migration:verify
npm run migration:rehearse
```

The API server never runs migrations automatically during startup.

## Local prerequisites

- PostgreSQL with permission to create and drop disposable databases.
- PostgreSQL client tools: `pg_dump` and `pg_restore`.
- Node.js and npm versions declared by the repository.
- A backend-only connection variable pointing to a temporary PostgreSQL instance.

Required variable names:

```text
DATABASE_URL=postgresql://<user>:<password>@<temporary-host>:<port>/<admin-database>
NODE_ENV=test
MIGRATION_REHEARSAL_CONFIRM=temporary-database
```

Do not use a production connection string. The rehearsal creates randomly named source and restore databases on the supplied PostgreSQL cluster.

Production migration commands are blocked unless both explicit confirmations are present:

```text
MIGRATION_ALLOW_PRODUCTION=true
MIGRATION_PRODUCTION_CONFIRM=I_UNDERSTAND_THIS_TARGETS_PRODUCTION
```

Those production confirmations must not be used for this rehearsal task.

## Report

The runner writes:

```text
npp-core/artifacts/migration-rehearsal-report.json
```

The runtime report is ignored by Git and uploaded by CI whether the rehearsal succeeds or fails. It contains:

- start and finish timestamps;
- success or failure status;
- PostgreSQL server version;
- hashed source and restored database identifiers;
- first-run and second-run migration IDs;
- pre-backup and post-restore snapshots;
- reconciliation results;
- source, restore, and backup cleanup results;
- sanitized errors without raw connection strings, usernames, passwords, or hostnames.

A passing report requires:

- all expected migrations applied on the first run;
- no migrations applied on the second run;
- all required schema objects present;
- backup and restore completed;
- every reconciliation field equal;
- both temporary databases dropped;
- temporary dump removed;
- no report errors.

## CI

The `verify-migration-rehearsal` job in `.github/workflows/core-foundation.yml` starts a disposable PostgreSQL 16 service, installs PostgreSQL client tools, runs the full rehearsal, and uploads the JSON report with `if: always()`.

The workflow has no deployment permission and does not call Heroku, Supabase, Vercel, or any production database.

## Production gate before a real migration

A production migration remains blocked until all of the following are separately confirmed:

- a current production backup is verifiably available;
- restore rehearsal has completed successfully;
- pre/post reconciliation criteria are approved;
- an accountable operator has approved the change;
- a maintenance window is scheduled;
- rollback criteria and the rollback decision owner are documented.

This runbook and its CI result are rehearsal evidence only. They are not evidence that production backup, restore, or cutover readiness has been completed.
