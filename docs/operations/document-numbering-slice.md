# Phase 3.3F — Document numbering

> Source status: implemented and under final closeout validation in PR #53  
> Evidence rule: every acceptance artifact records the exact PR head SHA  
> Production deployment: excluded and intentionally deferred

## Purpose

Provide installation-scoped, concurrency-safe and idempotent number allocation without creating or posting any business document.

The slice owns number-series configuration, period counters and immutable allocation history. Sales, purchasing, inventory and accounting domains will call this allocator later and snapshot the returned number on their own documents.

## Delivered migrations

- `015_document_numbering` creates permissions, number-series configuration, period counters and append-only allocation history.
- `016_permission_catalog_alignment` is a forward-only closeout migration that reconciles canonical permission metadata found drifting during migration verification. Previously applied migrations are not rewritten.

Production migrations `010` through `016` remain pending for the separately authorized grouped rollout.

## Locked business decisions

- Number-series codes and document types are administrator-managed data.
- A series is selected explicitly by ID; document type alone never silently chooses a series.
- Supported reset policies are `NONE`, `YEARLY` and `MONTHLY`.
- Counter state is separated by period:
  - `NONE` uses `ALL`;
  - `YEARLY` uses `YYYY`;
  - `MONTHLY` uses `YYYY-MM`.
- Backdated allocation uses the supplied document date and cannot reset another period.
- Allocation is serialized with PostgreSQL row locks on the exact series and period counter.
- The same installation + series + idempotency key returns the same immutable allocation.
- Reusing an idempotency key with a different date or metadata is rejected.
- Replay transactions must be read-only and cannot hide business writes without audit.
- Allocation history is append-only at API and PostgreSQL-trigger levels.
- Once a series has an allocation, identity and formatting fields are immutable. A new format requires a new series.
- Name, description and active state remain editable with optimistic concurrency.
- Inactive series cannot allocate new numbers.
- No sales, purchasing, inventory, receivable, payable or accounting posting is included.

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

- `{SEQ}` appears exactly once;
- unsupported braces and tokens are rejected;
- literals are limited to uppercase ASCII letters, digits, `.`, `_`, `/` and `-`;
- sequence values are zero-padded to `sequence_width`;
- rendered output is limited to 160 characters;
- `YEARLY` requires `{YYYY}` or `{YY}`;
- `MONTHLY` requires `{MM}` and a year token;
- reset/template compatibility is enforced by both service validation and a database constraint;
- `start_counter` must leave room for the next counter value and is enforced by both service and database constraints.

Example:

```text
prefix: SO-
template: {PREFIX}{YYYY}{MM}-{SEQ}
width: 6
result: SO-202607-000001
```

## Data model

### `shared.document_number_series`

Stores installation-scoped identity, format, reset policy, lifecycle, concurrency timestamp and actor metadata.

### `shared.document_number_counters`

Stores one mutable counter per installation + series + period. This is allocator state, not a business document.

### `shared.document_number_allocations`

Stores append-only history containing series, idempotency key, document date, period, counter, rendered number, actor, request, source app, metadata and timestamp.

Unique constraints protect:

- one allocation per idempotency key in a series;
- one counter value per series and period;
- one rendered number per installation.

## API contract

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

The HTTP idempotency store and domain allocation table both protect retries. Domain replay remains effective after an HTTP replay record is unavailable.

## Authorization and audit

- reads require `core.document-number.read`;
- configuration mutation and allocation require `core.document-number.write`;
- every query is installation scoped;
- first-time series changes and allocations write shared transactional audit records;
- replay returns the original allocation without consuming a counter or creating duplicate audit;
- replay is rejected if any hidden business write occurs in its transaction;
- public errors are sanitized;
- browser traffic uses same-origin server-only gateways protected by Basic Auth.

## Administration UI

Canonical route: `/document-numbering`, labelled `Số chứng từ` in the AppShell navigation.

The workspace supports:

- list and filter series;
- create and edit allowed configuration;
- activate or deactivate a series;
- show format-lock state;
- explicitly labelled test allocation;
- immutable allocation history;
- clear notice that this screen does not create business documents.

## Required verification

The exact final PR head must pass:

- migration apply, rerun and verification for `002` through `016`;
- direct database constraint tests;
- template syntax and reset/template compatibility;
- NONE, YEARLY and MONTHLY behavior;
- backdated period isolation;
- 24 parallel unique and gap-free successful allocations;
- HTTP and domain replay;
- replay payload mismatch;
- read-only replay enforcement;
- inactive-series guard;
- sequence-width overflow rollback;
- format lock and immutable history;
- installation isolation, permission and audit;
- Core API verification and Core web build;
- isolated Chromium flow;
- Foundation F0.2 and general Core browser regression;
- `mcp/** = 0`;
- no temporary wrapper or diagnostic file in the final diff.

The dedicated `Phase 3 Document Numbering` workflow retains migration logs, API logs, acceptance metadata, Playwright reports and test results.

## Phase 3 closeout boundary

A green numbering pack is necessary but does not close Phase 3 alone. Packs 1–8 in `docs/operations/phase-3-validation-plan.md` must pass independently.

Merge is not deployment. Production still requires actual provider audit, a fresh verified backup, restore rehearsal, reconciliation, separately authorized migrations and manual backend/frontend deployment verification.
