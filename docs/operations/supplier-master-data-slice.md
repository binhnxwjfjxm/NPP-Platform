# Phase 3.3B — Supplier Master Data

> Status: merge candidate on PR #46  
> Branch: `agent/supplier-master-data`  
> Production backend/database rollout: deferred with the larger Phase 3 master-data group

## Scope

This slice establishes canonical, installation-scoped supplier master data for NPP Core:

- suppliers;
- supplier contacts;
- supplier addresses;
- supplier payment terms;
- optional purchase-owner employee;
- active/inactive lifecycle without hard delete;
- permissions, idempotency, optimistic concurrency and transactional audit;
- same-origin Core web gateway and Vietnamese supplier administration page.

It does not implement products, SKU, purchase orders, goods receipts, payables, supplier payments or production deployment.

## Database

Migration:

```text
database/migrations/shared/011_supplier_master_data.sql
```

Tables:

```text
shared.suppliers
shared.supplier_contacts
shared.supplier_addresses
shared.supplier_payment_terms
```

Rules:

- UUID canonical IDs;
- `installation_id` is server-owned text, consistent with the existing platform model;
- supplier code is normalized uppercase and unique per installation;
- child foreign keys include both `installation_id` and `supplier_id`;
- optional purchase-owner employee must belong to the same installation;
- no `ON DELETE CASCADE` and no hard-delete API;
- contacts, addresses and payment terms support one active primary record per supplier;
- all tables have timestamps, actor fields and active/inactive lifecycle fields;
- permissions `core.supplier.read` and `core.supplier.write` are registered idempotently.

The slice uses the existing shared audit/outbox foundation. It does not create a supplier-specific audit table.

## Core API

Supplier endpoints:

```text
GET   /api/suppliers
POST  /api/suppliers
GET   /api/suppliers/:supplierId
PATCH /api/suppliers/:supplierId
```

Contact endpoints:

```text
GET   /api/suppliers/:supplierId/contacts
POST  /api/suppliers/:supplierId/contacts
PATCH /api/suppliers/:supplierId/contacts/:contactId
```

Address endpoints:

```text
GET   /api/suppliers/:supplierId/addresses
POST  /api/suppliers/:supplierId/addresses
PATCH /api/suppliers/:supplierId/addresses/:addressId
```

Payment-term endpoints:

```text
GET   /api/suppliers/:supplierId/payment-terms
POST  /api/suppliers/:supplierId/payment-terms
PATCH /api/suppliers/:supplierId/payment-terms/:paymentTermId
```

Contracts:

- GET requires `core.supplier.read`;
- POST and PATCH require `core.supplier.write`;
- POST requires `Idempotency-Key`;
- PATCH requires `expectedUpdatedAt`;
- every query is installation-scoped;
- invalid or cross-installation relationships fail closed;
- child records cannot be added to an inactive supplier;
- public errors are sanitized;
- successful mutations write `shared.core_audit_records` in the same transaction;
- audit resource types are `supplier`, `supplier_contact`, `supplier_address` and `supplier_payment_term`.

## Core web

Canonical administration route:

```text
/suppliers
```

Legacy route:

```text
/organization/suppliers -> /suppliers
```

The Core web provides:

- server-only gateway using `CORE_API_INTERNAL_URL` and `CORE_API_SERVER_TOKEN`;
- browser-visible same-origin routes under `/api/suppliers/**`;
- no privileged token or database connection exposed to the browser;
- supplier list, search, active/inactive filter, create, edit and status toggle;
- Vietnamese labels and conflict reload behavior;
- Basic Auth middleware coverage for `/suppliers/**` and `/api/suppliers/**`.

Contacts, addresses and payment terms have complete Core API and same-origin gateway contracts in this slice. Their dedicated admin subforms are not exposed on the current supplier list screen and must not be described as already delivered.

## Validation

Automated coverage includes:

- clean PostgreSQL migration execution;
- migration rehearsal and second-run no-op verification;
- supplier code normalization and installation isolation;
- optional employee assignment in the same installation;
- contact/address/payment-term creation;
- one active primary contact per supplier;
- optimistic concurrency conflict;
- inactive-parent rejection;
- authenticated and idempotent supplier/child creation;
- shared audit-record verification;
- Core web typecheck, unit tests and production build;
- Playwright supplier create/search/filter/edit/deactivate flow.

## Deployment boundary

Migrations `010` and `011` and their Core API code are not productionized yet. Do not apply production migrations or deploy Heroku from this slice alone.

After the agreed Phase 3 master-data group is complete on `main`, Codex must run one controlled backend/database rollout:

1. audit actual Heroku/PostgreSQL state;
2. create a new backup;
3. restore rehearsal to temporary PostgreSQL 17;
4. apply pending migrations in order;
5. verify and reconcile before/after;
6. exercise real APIs against rehearsal data;
7. deploy Heroku manually from `main`;
8. verify live/ready and all Phase 3 API smoke tests;
9. create a post-migration backup;
10. keep automatic deploy disabled.
