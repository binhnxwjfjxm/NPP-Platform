# Phase 3 Slice 1 — Organization and Warehouse

## Purpose

This slice delivers the first NPP Core master-data hierarchy:

```text
installation/company context
→ branches
→ warehouses
→ warehouse locations
```

The installation/company context is server-owned and read-only in this slice. Users can list, create, update, activate, and deactivate branches, warehouses, and warehouse locations.

## Scope

Included:

- PostgreSQL migrations for `shared.branches`, `shared.warehouses`, and `shared.warehouse_locations`
- installation-scoped repositories and services
- authenticated Core API routes
- deny-by-default read/write permissions
- required create idempotency
- optimistic concurrency for PATCH
- transactional audit records
- server-only Next.js gateway
- protected `/organization` browser UI
- PostgreSQL-backed integration tests and Playwright E2E

Not included:

- users/employees/roles UI
- customers, suppliers, products, sales, purchasing, or inventory ledger
- MCP cutover
- production deployment
- asynchronous organization-domain event publication

## Data ownership and constraints

### Branch

- UUID primary key
- unique `(installation_id, code)`
- uppercase code matching `[A-Z0-9_-]{1,64}`
- no hard delete

### Warehouse

- UUID primary key
- unique `(installation_id, code)`
- composite foreign key `(installation_id, branch_id)` to the owning branch
- cannot be created or reactivated under an inactive branch
- a branch cannot be deactivated while it has active warehouses

### Warehouse location

- UUID primary key
- unique `(warehouse_id, code)`
- composite foreign key `(installation_id, warehouse_id)` to the owning warehouse
- cannot be created or reactivated under an inactive warehouse
- a warehouse cannot be deactivated while it has active locations

Parent reads used by child create/reactivation take `FOR SHARE` locks. Parent deactivation takes `FOR UPDATE` before checking active children. This serializes concurrent create/reactivate and deactivate operations so an inactive parent cannot commit with a newly active child.

## Core API

```text
GET    /api/branches
POST   /api/branches
GET    /api/branches/:id
PATCH  /api/branches/:id

GET    /api/warehouses
POST   /api/warehouses
GET    /api/warehouses/:id
PATCH  /api/warehouses/:id

GET    /api/warehouse-locations
POST   /api/warehouse-locations
GET    /api/warehouse-locations/:id
PATCH  /api/warehouse-locations/:id
```

Query parameters:

- list routes: `active`, `limit`, `offset`
- warehouses: optional `branchId`
- warehouse locations: optional `warehouseId`

Malformed UUID path or parent-filter values are rejected before PostgreSQL is queried. GET-by-ID returns not found; mutation and invalid-filter requests return a client error rather than a retryable 500.

## Permissions

- `core.branch.read`
- `core.branch.write`
- `core.warehouse.read`
- `core.warehouse.write`
- `core.warehouse.location.read`
- `core.warehouse.location.write`

Authentication and request context are server-owned. Installation, actor, source application, and permissions cannot be supplied through business payloads.

## Browser gateway security

The browser calls only same-origin routes:

```text
/organization
/api/organization/:resource
/api/organization/:resource/:id
```

The Next.js gateway attaches `CORE_API_SERVER_TOKEN` only on the server. That token is never sent to browser JavaScript or HTML.

The organization page and gateway require HTTP Basic authentication before the privileged backend token is attached. Configure server-only variables:

```text
CORE_WEB_ADMIN_USERNAME
CORE_WEB_ADMIN_PASSWORD
CORE_API_INTERNAL_URL
CORE_API_SERVER_TOKEN
```

Rules:

- missing web-admin credentials deny access with 503
- invalid or missing Basic credentials return 401
- production access requires HTTPS
- browser responses use `Cache-Control: no-store`
- these variables must not use the production database URL and must not be exposed as `NEXT_PUBLIC_*`

This Basic Auth boundary is an interim internal-admin gate. A later user/employee authentication slice may replace it with the canonical NPP Core session flow without changing the Core API authorization contract.

## Idempotency

Every POST requires an `Idempotency-Key` header.

The key is scoped by installation, actor, and route. The request body is fingerprinted:

- same key and same payload returns the stored response
- same key and different payload returns conflict
- missing or malformed key is rejected

## Optimistic concurrency

Every PATCH requires `expectedUpdatedAt`.

- matching value allows the update
- stale value returns `409 CONFLICT`
- invalid or missing value returns a client error
- timestamps are normalized to millisecond precision so values returned through JSON can be reused safely

## Transaction and audit contract

Every successful mutation performs the entity change and exactly one audit insert in the same PostgreSQL transaction. The response is sent only after commit.

Audit data includes:

- installation and actor
- request ID and source application
- action: create, update, activate, or deactivate
- resource type and resource ID
- before/after snapshots where applicable
- code metadata

An audit failure rolls back the entity mutation.

## Outbox decision

This slice intentionally does **not** create organization-domain outbox events.

There is no approved consumer or event contract for branch, warehouse, or location changes yet. Emitting pending events without a consumer would create an operational queue with no delivery ownership. Outbox publication must be introduced in a later slice together with:

- named consumer(s)
- versioned event schemas
- retry/dead-letter policy
- replay and monitoring ownership
- regression tests for delivery semantics

The shared transaction helper permits audit-only mutations for this reason. Documentation and tests must not claim one outbox event per organization mutation.

## Validation and CI

Core API verification runs against a disposable PostgreSQL service and applies registered migrations before tests.

Coverage includes:

- installation isolation
- composite parent ownership
- required idempotency
- audit rollback and before/after data
- required and stale `expectedUpdatedAt`
- malformed UUID rejection
- hierarchy row-lock queries
- parent-active reactivation rules
- migration rehearsal

Browser E2E runs the actual Next.js app, Core API, and PostgreSQL. It verifies:

- anonymous organization gateway access is rejected
- authenticated `/organization` loads
- create branch → create warehouse → create location
- deactivate location
- browser assets and console remain clean

Primary commands:

```bash
npm --workspace npp-core-api run build
npm --workspace npp-core-api run verify
npm run migration:rehearse
npm run verify:core-web
npm run test:core-ui-e2e
```

Required PR workflows:

- Foundation F0.2
- Core Foundation
- Core UI and Browser E2E

## Deployment safety

Merging this slice does not deploy production or run production migrations.

Production rollout remains a separate explicit operation and requires:

- provider configuration audit
- server-only web-admin credentials
- confirmed database backup and restore readiness before migration
- manual Heroku deployment and health checks
- separate Vercel production deployment command and route verification
