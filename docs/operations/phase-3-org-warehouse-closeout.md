# Phase 3.1 Organization and Warehouse Closeout

## Merge record

NPP Core Phase 3.1 was squash-merged into `main` by PR #26.

```text
PR: #26
Main commit: a8038bfcdead3c6dc2b51b97a690974c30b5475c
Scope: branches -> warehouses -> warehouse locations
```

## Verified gates

Before merge, the exact PR head passed:

- Foundation F0.2
- Core Foundation
- Core UI and Browser E2E
- PostgreSQL-backed Core API integration tests
- migration rehearsal
- authenticated organization gateway regression tests
- branch, warehouse, and location browser flow

All automated review threads were resolved before merge.

## Security and transaction decisions

- browser organization routes are protected before the server attaches the privileged Core API token
- production organization access requires HTTPS
- mutations use required create idempotency and PATCH optimistic concurrency
- hierarchy changes use row locks to serialize child creation/reactivation against parent deactivation
- malformed UUIDs are rejected before PostgreSQL queries
- entity mutation and audit are committed in one transaction
- organization outbox events remain deferred until a consumer, versioned contract, retry policy, and operational owner are approved

## Production status

This merge did not perform:

- a Vercel production deployment
- a Heroku production deployment
- a production database migration
- a production provider configuration change

Production rollout remains a separate explicit operation after provider, backup, restore, migration, and runtime configuration checks.
