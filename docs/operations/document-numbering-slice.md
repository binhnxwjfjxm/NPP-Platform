# Phase 3.3F — Document numbering

> Status: implementation in progress on `agent/document-numbering`  
> Production deployment: excluded and intentionally deferred

## Purpose

Provide installation-scoped, concurrency-safe, idempotent number allocation without creating or posting any business document.

The slice owns number-series configuration, period counters and immutable allocation history. Sales, purchasing, inventory and accounting domains will call this allocator later and snapshot the returned number on their own documents.

## Locked business decisions

- Number-series codes and document types are administrator-managed data, not hardcoded business prices or document numbers.
- A series is selected explicitly by ID; document type alone never silently chooses a series.
- Supported reset policies are `NONE`, `YEARLY` and `MONTHLY`.
- Counter state is stored separately per reset period:
  - `NONE` uses period key `ALL`;
  - `YEARLY` uses `YYYY`;
  - `MONTHLY` uses `YYYY-MM`.
- Backdated allocation uses the supplied document date and its own period counter. It cannot reset or corrupt another period.
- Allocation is serialized with a PostgreSQL row lock on the exact series/period counter.
- The same installation + series + idempotency key always returns the same immutable allocation and never consumes another counter.
- Document numbers are unique across one installation.
- Allocation history is append-only. There is no update/delete API for an allocation.
- Once a series has any allocation, its identity and formatting fields are immutable. To change prefix, template, reset policy, width or start counter, create a new series and deactivate the old one.
- Name, description and active state may still be updated with optimistic concurrency.
- Inactive series cannot allocate new numbers.
- No transaction posting, inventory movement, receivable/payable entry or invoice generation is included.

## Template contract

Supported tokens:

```text
{PREFIX}
{YYYY}
{YY}
{MM}
{SEQ}
```

Rules:

- `{SEQ}` must appear exactly once;
- unsupported braces/tokens are rejected;
- literals are limited to uppercase ASCII letters, digits, `.`, `_`, `/` and `-`;
- prefix is stored separately and inserted by `{PREFIX}`;
- sequence is zero-padded to `sequence_width`;
- rendered output must fit 160 characters;
- the counter must fit the configured width; overflow is rejected without advancing the counter.

Example:

```text
prefix: SO-
template: {PREFIX}{YYYY}{MM}-{SEQ}
width: 6
result: SO-202607-000001
```

## Data model

### `shared.document_number_series`

Stores installation-scoped configuration:

- immutable `code` and `document_type`;
- `name`, description and active state;
- prefix and number template;
- reset policy;
- sequence width and start counter;
- timezone metadata for future date-context expansion;
- actor and timestamps.

### `shared.document_number_counters`

Stores one mutable counter row per installation + series + period key. This is internal allocator state and is not a historical document.

### `shared.document_number_allocations`

Append-only allocation history:

- series;
- idempotency key;
- document date and period;
- counter value and rendered document number;
- actor, request ID, source app and metadata;
- immutable allocation timestamp.

Unique constraints protect:

- one allocation per idempotency key in a series;
- one counter value per series/period;
- one rendered document number per installation.

## API contract

Series:

```text
GET    /api/document-number-series
POST   /api/document-number-series
GET    /api/document-number-series/:id
PATCH  /api/document-number-series/:id
GET    /api/document-number-series/:id/allocations
POST   /api/document-number-series/:id/allocate
```

POST mutations require `Idempotency-Key`. PATCH requires `expectedUpdatedAt`.

Allocation payload:

```text
documentDate: YYYY-MM-DD
metadata?: JSON object
```

Allocation response includes:

```text
allocationId
seriesId
seriesCode
documentType
documentDate
periodKey
counterValue
documentNumber
allocatedAt
replayed
```

The HTTP idempotency store and the domain allocation table both protect retries. Domain idempotency remains effective even after an HTTP replay record is no longer available.

## Authorization and audit

- reads require `core.document-number.read`;
- configuration mutations and allocation require `core.document-number.write`;
- all queries are installation scoped;
- successful series changes and allocations write shared transactional audit records;
- no hard delete or cascade delete;
- public errors are sanitized;
- browser traffic uses same-origin server-only gateways.

## Administration UI

Canonical page: `/document-numbering` with Vietnamese label `Số chứng từ`.

The page supports:

- list and filter series;
- create a series with document type, prefix, template, reset policy, width and start counter;
- edit allowed metadata and activate/deactivate a series;
- display whether the format is locked by allocation history;
- issue an explicitly labelled test allocation with a document date and idempotency key;
- show immutable recent allocation history;
- explain that business documents are not created by this screen.

## Verification gate

Before merge:

- migration apply/rerun/verify/rehearsal;
- installation isolation;
- template validation and deterministic rendering;
- no-reset, yearly and monthly period behavior;
- backdated allocation isolation;
- concurrency test with parallel allocations and no duplicate/gap caused by successful requests;
- same-key replay returns the same number without consuming another counter;
- inactive-series guard;
- sequence-width overflow rolls back without counter advancement;
- format lock after first allocation;
- immutable allocation history;
- transactional audit and deny-by-default permissions;
- Core web typecheck/tests/build;
- Chromium E2E against PostgreSQL and Core API;
- `mcp/** = 0`.

## Phase 3 closeout test requirement

After Phase 3.3F merges, Phase 3 must not be treated as rollout-ready from one combined green check alone. The rehearsal and acceptance plan must split validation into these independent packs:

1. customers;
2. suppliers;
3. product catalog;
4. units, conversions and barcodes;
5. **pricing — mandatory isolated financial test pack and owner review**;
6. document numbering;
7. cross-domain integration and grouped migration rollout.

The pricing pack must run independently from general master-data tests and cover workbook reconciliation, retail/carton independence, channel/group/customer/promotion precedence, quantity/effective-date rules, stacking, manual overrides, integer-money rounding and blocked ambiguous rows.

Merge is not production deployment. Migrations `010` through `015`, source imports and backend/frontend production deployments remain pending for the controlled Phase 3 rollout.
