# Phase 3.3A — Customer master data slice

## Scope

This slice belongs to NPP Core and shared master data only.

Included:

- customer groups;
- customers;
- customer addresses;
- active/inactive lifecycle;
- optional responsible employee;
- payment terms and credit limit as master-data attributes;
- server-side authorization, idempotency, optimistic concurrency and audit;
- same-origin Core web gateway and Vietnamese UI.

Excluded:

- MCP changes;
- route-assignment mutation;
- sales orders, receivable posting and payments;
- supplier or product master data;
- login/session, MFA and scope assignment;
- production migration or deployment.

## Locked domain contract

- `shared.customers.id` is the immutable canonical customer identifier.
- Every row is installation-scoped; the API never accepts `installationId` from the browser body.
- Customer-group and customer codes are trimmed, upper-cased and unique within one installation.
- There is no hard-delete API. Lifecycle changes use `is_active`.
- `group_id` and `responsible_employee_id` are nullable.
- A newly assigned group or responsible employee must exist in the same installation and be active.
- Existing records may keep a relation that later becomes inactive; assigning a different inactive relation is rejected.
- Every address belongs to exactly one customer in the same installation.
- At most one active default address exists for a customer.
- `payment_terms_days` is an integer from 0 through 3650.
- `credit_limit` is an exact non-negative `numeric(18,2)` master-data value. It is not the receivable balance and does not post accounting entries.
- POST mutations require `Idempotency-Key`.
- PATCH mutations require `expectedUpdatedAt` and reject stale writes with a conflict.
- Authorization is deny-by-default with `core.customer.read` and `core.customer.write`.
- Mutations run in a transaction and write before/after audit data through the existing audit/outbox layer.
- The browser only calls the same-origin NPP Core web gateway. The gateway adds backend credentials server-side.
- No database connection string or backend token is exposed to the browser.

## Canonical API

Customer groups:

- `GET /api/customer-groups`
- `POST /api/customer-groups`
- `GET /api/customer-groups/:id`
- `PATCH /api/customer-groups/:id`

Customers:

- `GET /api/customers`
- `POST /api/customers`
- `GET /api/customers/:id`
- `PATCH /api/customers/:id`

Addresses:

- `GET /api/customers/:id/addresses`
- `POST /api/customers/:id/addresses`
- `PATCH /api/customers/:id/addresses/:addressId`

## List and search rules

`GET /api/customers` supports:

- `search`: case-insensitive customer code, name, phone or tax-code search;
- `active`: `true` or `false`;
- `groupId`: customer-group UUID;
- `limit`: 0 through 1000;
- `offset`: 0 through 10000.

`GET /api/customer-groups` supports `search`, `active`, `limit` and `offset` with the same validation style.

## UI contract

Canonical NPP Core route: `/customers`.

The page provides:

- total, active and inactive counts;
- search and filters for status and group;
- create/edit and active/inactive actions;
- group management;
- address management;
- conflict reload messaging;
- explicit disabled reasons;
- `cursor: not-allowed` for ordinary disabled controls and `cursor: wait` only while a request is in progress.

## Verification gate

Before merge:

- migration applies on a clean PostgreSQL 17 database;
- migration verification passes and a second run is a no-op;
- backend tests cover CRUD, installation isolation, 401/403, validation, duplicate races, idempotency, stale writes, audit and rollback;
- browser E2E covers the canonical `/customers` route and same-origin gateway;
- `git diff --name-only main...HEAD` contains no `mcp/**` path;
- CI is green.
