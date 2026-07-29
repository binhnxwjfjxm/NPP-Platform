# Phase 5.5 — Payable Posting Decisions

> Status: source implementation in progress on `agent/phase-5-5-payable-posting`.
> This document does not claim a production deployment or production migration.

## 1. Source of truth

- `accounting.payable_ledger_entries` is the immutable source of truth for supplier payable balance.
- `accounting.supplier_payable_balances` is a rebuildable projection.
- Posted purchasing documents are never edited to correct accounting history. Corrections use compensating reversal entries.
- Phase 5.5 has no manual journal editor and no supplier payment/allocation mutation. Payments are Phase 5.6.

## 2. Posting boundary

### Goods Receipt

A Goods Receipt creates payable only after the receipt and inventory movement are successfully posted in the same database transaction.

For each accepted receipt line:

```text
gross      = round(accepted_quantity × PO unit_price, 6)
discount   = round(PO discount_amount × accepted_quantity / PO ordered_quantity, 6)
tax        = round(PO tax_amount × accepted_quantity / PO ordered_quantity, 6)
line total = gross - discount + tax
```

Rejected quantity and shortage-closed quantity never create inventory or payable value.

The payable document snapshots:

- supplier and warehouse;
- source document number/date/revision;
- currency;
- PO price, discount and tax allocation per accepted line;
- active primary supplier payment method and `term_days` at posting.

When no active primary payment term exists, payment method is `UNSPECIFIED`, term days are `0`, and due date equals receipt date.

### Supplier Return

A posted Supplier Return creates a credit payable document in the same transaction as its inventory issue movement.

- Credit value is derived from the original Goods Receipt payable line, not current product price or current supplier terms.
- Partial credits are prorated at scale 6.
- Runtime posting makes the final active return quantity for a receipt line absorb the remaining rounding residual so active credits cannot exceed the original debit line.
- Historical migration backfill uses deterministic proportional allocation from the stored debit line because the exact historical posting order may be unavailable.
- A reversed Supplier Return no longer reduces payable balance.

## 3. Reversal

- Goods Receipt reversal adds `GOODS_RECEIPT_REVERSE` for the exact negative original debit amount.
- Supplier Return reversal adds `SUPPLIER_RETURN_REVERSE` for the exact positive original credit amount.
- A payable document becomes `reversed`; its ledger rows remain append-only.
- Future Phase 5.6 allocations must be reversed before their source payable document can be reversed.

## 4. Idempotency and concurrency

- One payable document is allowed per `(installation_id, source_document_type, source_document_id)`.
- One source event type is allowed per source document in the payable ledger.
- Source document row locks and existing purchasing transaction boundaries serialize posting/reversal.
- HTTP idempotency replay returns the stored source response without creating another payable document or ledger entry.
- Payable failure makes the entire source transaction fail and roll back inventory, document status, audit and outbox changes.

## 5. Authorization and exposure

- `core.payable.read` is deny-by-default.
- Payable document list/detail and calculated balances are restricted to authorized warehouse scopes.
- The browser calls only same-origin Next.js routes; Core API credentials stay server-side.
- Public responses never expose raw SQL/provider errors or credentials.

## 6. Migration and historical data

Migration `030_payable_posting.sql`:

- creates accounting documents, lines, immutable ledger and rebuildable balances;
- adds append-only and document transition guards;
- backfills existing posted/reversed Goods Receipts and Supplier Returns with deterministic IDs;
- marks historical rows with `posting_origin = migration_backfill`;
- uses the currently active primary supplier term only as an explicit migration snapshot when the historical posting-time term is unavailable;
- rebuilds supplier payable balances from ledger entries.

Migration apply, rerun and grouped rehearsal must succeed on the exact final PR head before merge.

## 7. Acceptance gate

- Partial Goods Receipt amount matches PO pricing snapshots at scale 6.
- Supplier Return credit matches the original receipt payable line.
- Source replay does not duplicate documents or ledger entries.
- Reversals restore balance exactly.
- Balance rebuild matches incremental projection.
- Warehouse and installation isolation hold.
- Full Core API, migration rehearsal, web build and Browser E2E remain green.
- No path under `mcp/**` changes.
