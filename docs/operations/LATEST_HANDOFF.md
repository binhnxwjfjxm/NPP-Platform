# NPP Platform — Latest Handoff

## Source checkpoint — Phase 5.5 Payable Posting

- Repository: `binhnxwjfjxm/NPP-Platform`.
- Production branch: `main`.
- Phase 5.4 Supplier Return was merged as commit `f2bf4ab5a902d11ff6ff8983a018d697adf9f537`.
- Phase 5.5 is implemented on branch `agent/phase-5-5-payable-posting` and tracked by Issue #91.
- The actual PR head, CI state and merge state must be read from GitHub before follow-on work.
- This is a source-only task. It does not include production deployment, production migration or provider changes.

## Locked Phase 5.5 behavior

- Posted Goods Receipts create payable debit documents from accepted quantity and immutable PO pricing snapshots.
- Posted Supplier Returns create payable credit documents from the original Goods Receipt payable line.
- Payment term and due date are captured when the Goods Receipt payable is posted.
- Ledger entries are append-only; corrections use compensating reversals.
- Source posting, inventory mutation and payable posting share one database transaction.
- One payable source document and one ledger event type per source are enforced by database uniqueness.
- Supplier payment and allocation are not included; they remain Phase 5.6.

## Source migration

- `030_payable_posting.sql` creates accounting payable documents, lines, immutable ledger entries and rebuildable supplier balances.
- Historical posted/reversed purchasing sources are backfilled with deterministic IDs and explicit migration metadata.
- Clean apply, rerun and grouped migration rehearsal must pass on the exact final PR head.

## Verification gate

Before merge, verify:

- focused payable API and transaction tests pass;
- Core API verification and migration rehearsal pass;
- web typecheck/build and Browser E2E pass;
- Phase 3 grouped validation and Inventory/Purchasing regressions remain green;
- no changed path exists under `mcp/**`;
- no unresolved actionable review thread remains.

## Production separation

Configured production endpoints remain unchanged. Their releases, backups and applied migrations are not audited by this source task. Vercel Auto Deploy and Heroku Automatic Deploy remain intended to stay off. Production rollout requires a separate explicit operation with fresh provider, backup and restore-rehearsal evidence.

> Updated: 2026-07-30  
> Current checkpoint: Phase 5.5 source implementation and exact-head verification.
