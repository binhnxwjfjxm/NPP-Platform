# Phase 3 Database and Backup Rollout Prep

> Status: `READY_FOR_OPERATOR_ROLLOUT`
> Production mutation: prohibited in this repository task

## Purpose

Prepare the Phase 3 database and backup rollout without touching production. This prep adds read-only audit tooling, a fresh-backup contract, restore rehearsal support on disposable PostgreSQL 17, reconciliation reporting, and a reviewable runbook for the later operator-driven rollout.

## Included tooling

- read-only provider audit report
- migration registry manifest with per-migration checksums
- fresh backup contract builder with explicit confirmation
- restore rehearsal report with:
  - source, restore, and regression disposable databases
  - second-run idempotency
  - migration verification
  - before/after reconciliation
  - full Core API regression on a cloned rehearsal database
- machine-readable summary for operator review

## Commands

From the repo root:

```bash
npm --workspace npp-core-api run migration:audit
npm --workspace npp-core-api run migration:backup-contract
npm run migration:rehearse
```

### Read-only provider audit

Requires explicit confirmation:

```text
PHASE_3_AUDIT_CONFIRM=I_UNDERSTAND_THIS_IS_READ_ONLY
DATABASE_URL=postgresql://<temporary-or-approved-read-only-target>
```

The audit report records:

- PostgreSQL server version;
- database identity;
- current and session user;
- applied, pending, and unexpected migration IDs;
- repository-side migration checksums;
- migration verification result.

### Fresh backup contract

Requires explicit confirmation:

```text
PHASE_3_BACKUP_CONFIRM=I_UNDERSTAND_THIS_IS_A_FRESH_PRODUCTION_BACKUP
```

The contract captures:

- provider label;
- Heroku app name when supplied;
- optional backup ID;
- optional capture timestamp;
- optional source fingerprint;
- optional checksum;
- the documented capture command template.

This repository task does not execute the backup.

### Restore rehearsal

The rehearsal uses disposable PostgreSQL only. It:

1. creates separate source, restore, and regression databases;
2. applies migrations `002` through `016`;
3. reruns migrations and confirms no-op idempotency;
4. verifies the schema;
5. captures a pre-backup snapshot;
6. creates a logical backup artifact;
7. restores that artifact to a separate target;
8. compares snapshots, constraints, indexes, triggers, and table checksums;
9. runs the full Core API verify suite against the regression clone;
10. removes all temporary databases and artifacts.

## CI

The rehearsal workflow uses disposable PostgreSQL 17 and does not touch Heroku or Vercel deployments.

## Operator handoff

A human operator may use the generated reports to decide whether to move on to the production rollout. This repository task stops at:

```text
READY_FOR_OPERATOR_ROLLOUT
```

and does not perform production deployment.

