# NPP Platform — Latest Handoff

## Source checkpoint — Phase 5.4 Supplier Return

- Repository: `binhnxwjfjxm/NPP-Platform`.
- Production branch: `main`.
- Phase 5.3 is merged on `main` at `a547404ef55d2adc7276289115992250a5205fab`.
- Phase 5.4 is under final review in PR #90 on branch `agent/phase-5-4-supplier-return`.
- The actual PR head, CI state and merge state must be read from GitHub before follow-on work.
- This is a source-only change. No production deployment or production migration is part of this handoff.

## Locked Phase 5.4 behavior

- Lifecycle: `draft -> pending_approval -> approved -> posted -> reversed`.
- Pre-post cancellation is allowed from `draft`, `pending_approval` and `approved` with a reason.
- Posting creates one canonical `SUPPLIER_RETURN_ISSUE` movement with direction `OUT`.
- Supplier Return and Purchase Receipt inventory lines are rebuilt from server-owned document snapshots; browser-supplied historical snapshots are rejected by the generic posting boundary.
- Submit serializes against Goods Receipt reversal and fails when a source receipt is no longer `posted`.
- A draft Supplier Return does not block Goods Receipt reversal.
- `pending_approval`, `approved` and `posted` Supplier Returns block source Goods Receipt reversal.
- `cancelled` and `reversed` Supplier Returns do not block source Goods Receipt reversal.
- Supplier Return does not change Goods Receipt accepted/rejected/shortage facts and does not reopen Purchase Order remaining quantity or status.
- Posted inventory facts are corrected only through one compensating reversal.

## Source migrations

- Phase 5.4 document schema starts at `024_supplier_return.sql`.
- Compatibility migrations `025` through `028` remain part of the source history.
- `029_supplier_return_invariants.sql` adds the canonical movement and concurrency-safe submit guards.
- Migration apply, rerun and grouped rehearsal must be green on the exact final PR head before merge.

## Verification gate

Before merge, verify on the exact final head:

- all required GitHub workflows are present, completed and successful;
- Core API verification and migration rehearsal are successful;
- full Core UI/Browser E2E is successful;
- Phase 3 split/grouped migration rehearsal is successful;
- Inventory Ledger, Balance and Reservations regressions are successful;
- Supplier Return focused coverage includes over-return, idempotent replay/mismatch, stale revision, concurrent post serialization, cancellation without movement, second reversal, draft non-blocking receipt reversal and historical conversion snapshots;
- no changed path exists under `mcp/**`;
- no unresolved actionable review thread remains.

## Production separation

Configured production endpoints remain:

- Core frontend: `https://npp-platform.vercel.app`;
- Core backend: `https://hung-phat-945da1547594.herokuapp.com`;
- database: Heroku PostgreSQL used by the backend.

These endpoints, releases, backups and applied production migrations were not re-audited by this source task. Do not claim a deployment, migration, backup or restore state from this handoff alone. Vercel Auto Deploy and Heroku Automatic Deploy remain intended to stay off; production rollout is a separate explicit operation.

> Updated: 2026-07-29  
> Current checkpoint: Phase 5.4 Supplier Return clean final exact-head verification in PR #90 after the concurrent return assertion was aligned with the exhausted-source contract. Merge only after all required CI gates pass.
