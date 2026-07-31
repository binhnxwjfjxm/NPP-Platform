# Phase 6B — Sales Order Foundation Implementation Contract

> Status: **ACTIVE IMPLEMENTATION CONTRACT**  
> Issue: `#118`  
> Source baseline: `main@e972e114f1a17987ba72f5c6b0a3c6ff49043599`  
> Phase 6A approval: `docs/operations/phase-6a-owner-approval.md`  
> Production deploy/migration: **NOT AUTHORIZED**

## 1. Goal

Build the Core Sales Order foundation as one reviewed vertical slice:

```text
migration
-> repository/service
-> Core API
-> NPP operations UI
-> tests and exact-head CI
```

Do not modify `mcp/**` in this task.

## 2. Reuse existing platform foundations

Implementation must reuse, not duplicate:

- request context and deny-by-default permissions;
- PostgreSQL idempotency store and payload mismatch behavior;
- transactional audit/outbox helpers;
- shared customer/address, product/SKU/unit and pricing foundations;
- document-number allocation service;
- exact-decimal patterns already used by Purchase Order;
- same-origin NPP web gateway pattern;
- migration registry and disposable PostgreSQL test pattern.

Purchase Order is a structural reference, not a business model to copy blindly. Sales Order has its own customer, source, pricing, versioning, collection and projection rules.

## 3. Migration

Add migration:

```text
database/migrations/sales/037_sales_order_foundation.sql
```

Register it in the active Core migration registry after `036_supplier_purchase_pricing`.

### 3.1 Permissions

Minimum permission catalog:

```text
core.sales-order.read
core.sales-order.create
core.sales-order.update-draft
core.sales-order.confirm
core.sales-order.amend
core.sales-order.cancel
core.sales-order.price.override
core.sales-order.credit.override
```

All authorization remains deny-by-default. Read and mutation scope must be constrained by the request context and the chosen branch/warehouse/territory contract; clients never send trusted installation or scope.

### 3.2 Stable order identity

Create `sales.sales_orders` as the stable aggregate identity.

Minimum columns:

```text
id uuid primary key
installation_id text
order_number nullable until confirmation
order_number_allocation_id nullable
status: draft | confirmed | cancelled | closed
current_version_number bigint
source_type: MANUAL | IMPORT | API | MCP
source_id nullable for MANUAL, required otherwise
source_outlet_id nullable, required for MCP
customer_id uuid
customer_address_id uuid nullable for approved pickup
warehouse_id uuid
collection_policy: PREPAID | COLLECT_ON_DELIVERY | COLLECT_AFTER_DELIVERY | CREDIT_TERMS
fulfillment_status
delivery_status
settlement_status
currency_code
requested_delivery_date nullable
note nullable
confirmed_at/by nullable
cancelled_at/by/reason nullable
created_at/by
updated_at/by
```

Required constraints/indexes:

- `(installation_id, id)` unique for composite FKs;
- unique `(installation_id, order_number)` where number is not null;
- unique source reference `(installation_id, source_type, source_id)` where source ID is not null;
- MCP source requires `source_outlet_id`;
- customer, address, warehouse and numbering allocation use installation-scoped FKs;
- status/projection/collection values are constrained;
- confirmed shape requires number, allocation, confirmed actor/time and confirmed current version;
- cancelled shape requires actor/time/reason;
- order number and source identity cannot be rewritten.

### 3.3 Immutable commercial versions

Create `sales.sales_order_versions`.

Minimum columns:

```text
id uuid primary key
installation_id
sales_order_id
version_number bigint
version_status: draft | confirmed | superseded | cancelled
customer/address/warehouse snapshots
source snapshots
collection-policy snapshot
currency/date/note snapshots
subtotal
discount_total
tax_total
total
amendment_reason nullable for version > 1
based_on_version_number nullable
created_at/by
confirmed_at/by nullable
```

Rules:

- `(installation_id, sales_order_id, version_number)` is unique;
- version 1 is created with the order;
- one order has at most one draft version;
- confirmed/superseded/cancelled versions are immutable by trigger;
- draft version lines are editable only while the parent order/version is draft;
- confirming an amendment supersedes the previous confirmed version and advances the aggregate pointer atomically;
- historical versions and lines are never updated to reflect later master-data changes.

### 3.4 Version lines

Create `sales.sales_order_version_lines`.

Minimum columns:

```text
id uuid primary key
installation_id
sales_order_version_id
line_number
variant_id
sku_snapshot
item_name_snapshot
unit_id
unit_code_snapshot
conversion_to_base
ordered_quantity
base_quantity
price_list_id nullable
price_rule_id nullable
price_source
unit_price
discount_mode
discount_value
discount_amount
tax_mode: EXCLUSIVE | INCLUSIVE
tax_rate
tax_amount
line_subtotal
line_total
note nullable
created_at/by
updated_at/by
```

Rules:

- canonical active/orderable SKU and active unit are validated in service before write;
- all quantity/money columns are exact numeric, no JS float business arithmetic;
- one version may not contain duplicate line numbers;
- whether duplicate SKU lines are allowed must follow existing NPP line-entry UX; default implementation should merge/reject duplicates rather than silently double count;
- confirmed version lines are immutable;
- totals reconcile exactly through constraints compatible with the service rounding contract.

### 3.5 Source and replay facts

The aggregate stores canonical source reference. Idempotency remains command-level in shared Core idempotency storage.

Rules:

- same source reference cannot create a second order;
- same idempotency key + same canonical payload returns the same response;
- same key + different payload returns conflict;
- lost response cannot duplicate an order, confirmation, amendment or cancellation;
- source reference and command idempotency are separate protections.

## 4. Customer/address eligibility

Before create/update/confirm:

- customer must belong to the installation and be active;
- delivery address must belong to that customer and installation, unless an explicit pickup mode is used by the API contract;
- MCP source requires an already linked official Core customer and source outlet reference;
- this task does not read or mutate legacy MCP tables;
- inactive customer/address fails closed with stable public codes.

Suggested errors:

```text
CUSTOMER_NOT_FOUND
CUSTOMER_INACTIVE
CUSTOMER_ADDRESS_NOT_FOUND
CUSTOMER_ADDRESS_INACTIVE
CUSTOMER_ADDRESS_MISMATCH
CUSTOMER_NOT_LINKED
```

## 5. Pricing, discount and tax

Core is authoritative.

### 5.1 Price resolution

For each line, resolve price using the existing sales-pricing foundation and canonical context:

```text
installation
customer/customer group when supported
channel when supported
variant/SKU
unit
quantity
order date/effective time
currency
```

Snapshot price provenance on the version line. Manual override requires `core.sales-order.price.override` and a non-empty reason captured in audit/version metadata.

Do not use supplier purchase prices.

### 5.2 Tax and rounding

Locked Phase 6A behavior:

```text
tax_mode: EXCLUSIVE | INCLUSIVE
VND currency scale: 0
rounding: HALF_UP per line
document totals: sum of rounded line amounts
```

Use integer/scaled-decimal or a verified decimal implementation. Do not use JavaScript floating-point values as the source of posted totals.

For exclusive tax:

```text
raw gross = quantity × unit price
discount = resolved exact discount
taxable base = raw gross - discount
tax = HALF_UP(taxable base × tax rate, currency scale)
line total = HALF_UP(taxable base + tax, currency scale)
```

For inclusive tax, derive the tax component from the inclusive discounted amount and preserve deterministic line reconciliation.

## 6. Lifecycle API

Minimum Core endpoints:

```text
GET    /api/sales-orders
POST   /api/sales-orders
GET    /api/sales-orders/:id
PUT    /api/sales-orders/:id/draft
POST   /api/sales-orders/:id/confirm
POST   /api/sales-orders/:id/amendments
PUT    /api/sales-orders/:id/amendments/:version/draft
POST   /api/sales-orders/:id/amendments/:version/confirm
POST   /api/sales-orders/:id/cancel
```

Exact endpoint names may be simplified if the same capabilities and immutable-version contract remain clear and tests cover them.

### 6.1 Create draft

- requires idempotency key;
- creates stable order + version 1 + lines atomically;
- no document number yet;
- projections initialize independently;
- emits audit/outbox.

### 6.2 Update draft

- requires revision/version precondition;
- allowed only for active draft version;
- revalidates customer/address/SKU/unit/pricing/tax;
- replaces or deterministically updates draft lines in one transaction;
- emits before/after audit and outbox.

### 6.3 Confirm

- requires idempotency key;
- locks aggregate/version;
- revalidates eligibility and resolved commercial values;
- allocates `SALES_ORDER` document number through existing numbering service;
- marks version/order confirmed atomically;
- does not post inventory, receivable, delivery or payment;
- emits `sales.sales_order.confirmed` transactionally.

### 6.4 Amendment

- allowed only for a confirmed order without a conflicting draft amendment;
- creates a new draft version copied from the latest confirmed version;
- requires amendment reason;
- confirmed amendment revalidates and supersedes the prior version atomically;
- does not erase history;
- source aggregate identity and original order number remain stable.

### 6.5 Cancellation

- requires permission, reason and idempotency;
- full cancellation is allowed before later execution facts exist;
- Phase 6B has no delivery/settlement execution tables, but the service must expose a repository check hook for future child facts and fail closed when such facts exist;
- cancellation does not delete versions or lines;
- emits audit/outbox.

## 7. Independent projections

Sales Order stores only projections for later domains:

```text
order status
a separate fulfillment status
a separate delivery status
a separate settlement status
```

Phase 6B initializes and reads these projections. It does not implement fulfillment, delivery or accounting mutations.

## 8. Repository/service boundaries

Suggested files:

```text
npp-core/api/src/db/repositories/sales-order.js
npp-core/api/src/services/sales-order.js
npp-core/api/src/routes/sales-orders.js
```

Rules:

- SQL stays in repository;
- validation, exact arithmetic, lifecycle and mapping stay in service;
- authentication, permission, idempotency, audit/outbox and HTTP mapping stay in route;
- all mutations that change domain state and emit audit/outbox run in one database transaction;
- public errors are sanitized and stable.

## 9. NPP web boundary

Add NPP operations UI, not Admin and not MCP:

```text
Sales Order list
create/edit draft
order detail with version history
confirm
create/edit/confirm amendment
cancel with reason
independent status display
server-resolved pricing/tax explanation
```

Use the existing same-origin gateway pattern. Browser code never calls Heroku directly and never accesses PostgreSQL.

The UI must be responsive, but it remains the full NPP operations surface. Admin control-tower views are a separate frontend project and are not implemented here.

## 10. Tests

Minimum test groups:

```text
migration clean apply
migration rerun no-op
schema/constraint/trigger contract
customer/address eligibility
SKU/unit eligibility
price/tax snapshot determinism
idempotency replay and mismatch
source-reference duplicate prevention
create/update/confirm lifecycle
concurrent confirm allocates one number
immutable confirmed version and lines
amendment creates/supersedes version correctly
cancel reason and future-child fail-closed hook
permission and scope denial
audit/outbox transaction rollback
Core API regression
web gateway and interaction tests
exact-head CI
mcp/** changed files = 0
```

## 11. Explicit exclusions

Do not implement in this task:

```text
customer portal authentication or self-registration
website-order employee attribution
MCP frontend changes
inventory reservation/allocation execution
pick/pack and lot selection execution
Delivery Order/trips/POD
receivable/payment/COD posting
production deployment/migration
provider, DNS or environment changes
```

## 12. Codex execution instructions

```text
git fetch origin
git switch agent/phase-6b-sales-order-foundation
git pull --ff-only
```

Then:

1. audit current `main` patterns before editing;
2. implement migration → backend → UI → tests;
3. use disposable PostgreSQL 17 for migration/integration tests;
4. do not use production `DATABASE_URL`;
5. commit and push only to `agent/phase-6b-sales-order-foundation`;
6. report exact files, commands, test results, unresolved decisions and head SHA;
7. do not deploy or run production migration.
