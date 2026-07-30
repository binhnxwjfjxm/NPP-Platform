# NPP Platform — Latest Handoff

## Source checkpoint — Phase 5.6 Supplier Payment and Allocation

- Repository: `binhnxwjfjxm/NPP-Platform`.
- Production branch: `main`.
- Phase 5.5 Payable Posting was merged as commit `40e5aabc83fcb40d88dc5e1d47e8d01d01e860af`.
- Phase 5.6 source implementation is prepared on branch `agent/phase-5-6-supplier-payment-allocation` and tracked by Issue #93 / PR #94.
- The actual PR head, CI state and merge state must be read from GitHub before follow-on work.
- This remains a source-only task. It does not include production deployment, production migration or provider changes.

## Locked Phase 5.6 behavior

- Recording a supplier payment is one atomic posted mutation with an official `SUPPLIER_PAYMENT` document number.
- The payment is a payable credit document and appends a negative immutable payable-ledger entry.
- Supplier payments and supplier-return credits can allocate only to open Goods Receipt payable debits.
- Allocation requires the same installation, supplier, warehouse and currency on source and target.
- Source and target rows are locked in deterministic UUID order before remaining amounts are validated.
- Allocation history is append-only. Reversal creates a separate immutable fact and restores both projections.
- Payment reversal requires a reason, requires no active allocation, and appends a compensating positive ledger entry.
- Goods Receipt and Supplier Return payable reversal remains blocked until every active allocation is reversed.
- Supplier balance continues to derive only from immutable payable-ledger entries; allocation never changes the total balance.

## Source migrations

- `031_supplier_payment_allocation.sql` creates payment document extensions, allocation/reversal history, DB allocation functions and permissions.
- `032_supplier_payment_allocation_hardening.sql` preserves legitimate payable reversal while enforcing allocation guards.
- `033_supplier_payment_series_lifecycle.sql` creates the default payment-number series for both existing and newly initialized installations.
- Clean apply, rerun and grouped migration rehearsal must pass on the exact final PR head.

## API and web surface

- Core API:
  - `/api/supplier-payments`
  - `/api/supplier-payments/:id`
  - `/api/supplier-payments/:id/reverse`
  - `/api/supplier-payments/allocation-targets`
  - `/api/payable-allocations`
  - `/api/payable-allocations/:id/reverse`
- Core web workspace: `/accounting/supplier-payments`.
- Browser mutations use same-origin routes and never receive the backend API token.

## Verification gate

Before merge, verify:

- payment lifecycle, allocation, credit allocation, reversal, concurrency and rebuild tests pass;
- deny-by-default permission and warehouse/installation isolation tests pass;
- Core API verification and migration rehearsal pass;
- web typecheck/build and Browser E2E pass;
- Phase 3 grouped validation and Inventory/Purchasing regressions remain green;
- no changed path exists under `mcp/**`;
- no unresolved actionable review thread remains;
- exact final head is verified immediately before merge.

## Explicit boundary after Phase 5.6

Bank reconciliation, cashbook/general-ledger integration, payment approval workflow, FX handling and cross-warehouse allocation are not implemented in Phase 5.6. The next phase must be derived from the Master Plan and a fresh audit rather than inferred from this handoff.

## Production separation

Configured production endpoints remain unchanged. Their releases, backups and applied migrations are not audited by this source task. Vercel Auto Deploy and Heroku Automatic Deploy remain intended to stay off. Production rollout requires a separate explicit operation with fresh provider, backup and restore-rehearsal evidence.

> Updated: 2026-07-30  
> Current checkpoint: Phase 5.6 source implementation and exact-head verification.
