# Migration Rehearsal

This document describes the Phase 2 migration rehearsal foundation for the Core API.

## Purpose

The migration rehearsal runner verifies that the shared PostgreSQL schema migrations for `npp-core/api`:

- apply cleanly to a fresh database
- are idempotent on a second run
- create the expected `shared.*` tables, constraints, triggers, and indexes
- accept sample rehearsal data
- survive a `pg_dump`/`pg_restore` cycle
- reconcile pre-backup and post-restore schema/data snapshots

## Files added

- `npp-core/api/src/migrations/cli.js`
- `npp-core/api/scripts/rehearse-migrations.js`
- `npp-core/api/test/rehearse-migrations.test.js`
- `npp-core/api/package.json` scripts for migration and rehearsal commands
- `.github/workflows/core-foundation.yml` new job for rehearsal validation

## Usage

Run the rehearsal locally from the `npp-core/api` workspace:

```bash
cd npp-core/api
npm run rehearse:migrations
```

This writes a JSON report to `artifacts/migration-rehearsal-report.json`.

## Environment requirements

- `DATABASE_URL` must point to a PostgreSQL database that accepts temporary database creation
- `NODE_ENV` must not be `production`
- `pg_dump` and `pg_restore` must be available on the runner

Example:

```bash
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
export NODE_ENV=development
npm run rehearse:migrations
```

## CI integration

The workflow includes a `verify-migration-rehearsal` job that:

- starts a PostgreSQL service container
- installs PostgreSQL client tools
- runs the rehearsal script against a temporary database

This validates migration rehearsal as part of the foundation verification workflow.
