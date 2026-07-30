# Phase 5.6 — Supplier Payment and Allocation Decisions

## Status

Source implementation is prepared on `agent/phase-5-6-supplier-payment-allocation` from the exact Phase 5.5 merge baseline. GitHub PR, CI, merge and production rollout status must be verified independently; this document does not claim a production deployment or production migration.

## Posting model

A supplier payment is recorded as one atomic posted accounting mutation. It creates:

- one official document number from series `SUPPLIER_PAYMENT`;
- one `accounting.payable_documents` row with direction `CREDIT`, document type `SUPPLIER_PAYMENT`, source domain `ACCOUNTING`, and source ID equal to the payment document ID;
- one immutable `SUPPLIER_PAYMENT_POST` payable-ledger entry with a negative amount;
- the normal request idempotency, audit and outbox facts in the same transaction.

There is no draft or approval workflow in this slice. Bank reconciliation, cashbook and general-ledger integration remain outside Phase 5.6.

## Numbering lifecycle

Migration 031 backfills a deterministic default `SUPPLIER_PAYMENT` series for installations that already have suppliers. Migration 033 installs an `AFTER INSERT` supplier trigger so a fresh installation also receives the series when its first supplier is created.

Migration 034 widens only the internal document-number allocation idempotency-key constraint from 128 to 160 characters. Public Core idempotency keys remain capped by the existing request contract; the extra space is for collision-free internal namespaces such as `supplier-payment:`.

The series remains editable through the existing document-numbering administration contract. Historical allocations remain append-only.

## Allocation model

An allocation connects one credit source to one debit target:

- allowed sources: an open supplier payment or an open supplier-return credit;
- allowed target: an open Goods Receipt payable debit;
- source and target must have the same installation, supplier, warehouse and currency;
- allocation amount must not exceed either remaining amount;
- cross-currency and cross-warehouse allocation are rejected.

`accounting.create_payable_allocation` locks both payable documents in UUID order before validating remaining amounts. Concurrent attempts therefore serialize and cannot over-allocate the final remaining amount.

Allocation does not create a payable-ledger entry because it does not change total supplier payable balance. It only changes the immutable source/target relationship and the rebuildable `allocated_amount`, `remaining_amount` and status projections.

## Reversal model

Allocation rows are append-only. Reversal inserts one immutable `payable_allocation_reversals` row and restores both source and target projections exactly.

A supplier payment can be reversed only when it has no active allocation and its allocated amount is zero. Reversal requires a non-empty reason, changes the payment status to `reversed`, and appends one positive `SUPPLIER_PAYMENT_REVERSE` ledger entry.

Goods Receipt and Supplier Return payable reversal remains blocked while an active allocation references the payable document. Reversing every allocation first removes that dependency without deleting history.

## Database ownership and guards

Direct mutation of allocation history is rejected. Direct changes to payable allocation projections are rejected unless performed inside the database allocation functions using the transaction-local guard setting.

Migration 032 evaluates a legitimate payable reversal before allocation-projection validation. This keeps existing Goods Receipt and Supplier Return reversal contracts working while preserving the active-allocation guard.

Supplier balance remains derived only from `accounting.payable_ledger_entries`. Allocation creation and reversal must leave the balance unchanged, and `accounting.rebuild_supplier_payable_balances()` must reproduce the stored projection.

## Idempotency and exact money

Core API mutations use the shared idempotency store. A replay with the same route, key and payload returns the stored response; reusing the key with a different payload returns `IDEMPOTENCY_PAYLOAD_MISMATCH`.

The Core web keeps a stable idempotency key for the same failed payment, allocation or reversal payload and clears it only after success. Client-side allocation limits use integer scale-6 arithmetic rather than JavaScript floating-point comparison. Database numeric constraints and stored functions remain the authoritative financial boundary.

## Permissions and scope

The slice adds:

- `core.supplier-payment.read`
- `core.supplier-payment.create`
- `core.supplier-payment.reverse`
- `core.payable-allocation.create`
- `core.payable-allocation.reverse`

All permissions are deny-by-default. Payment reads and mutations require at least one authorized warehouse. Allocation source and target must both be visible in the caller's warehouse scope.

## Web boundary

The Core web workspace is `/accounting/supplier-payments`. Browser code calls same-origin routes only:

- `/api/supplier-payments`
- `/api/supplier-payments/:id`
- `/api/supplier-payments/:id/reverse`
- `/api/supplier-payments/allocation-targets`
- `/api/payable-allocations`
- `/api/payable-allocations/:id/reverse`

The server-only gateway owns the Core API token. Browser responses contain public business errors, never backend credentials or raw provider failures.

Browser verification follows a real business chain: Purchase Order approval, posted Goods Receipt and payable debit, supplier payment, partial allocation, reversal guard, allocation reversal and payment reversal.

## Explicit exclusions

- bank reconciliation;
- cashbook or general-ledger posting;
- payment approval workflow;
- foreign-exchange conversion;
- cross-warehouse allocation;
- manual accounting journals;
- MCP changes;
- production deployment or production database mutation.
