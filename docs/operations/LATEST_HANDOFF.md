# NPP Platform — Latest Handoff

> Updated: 2026-07-26  
> Current checkpoint: Phase 3.1 closed; pause before opening a new slice.

## Production status

```text
Frontend Core: https://npp-platform.vercel.app
Backend Core: https://hung-phat-945da1547594.herokuapp.com
Database: Heroku PostgreSQL
Core web deployment: READY
Core API live/ready: 200/200
Organization canonical API: active
Organization Basic Auth gate: active
Auto Deploy: locked
```

## Phase 3.1 delivered

- Branch management.
- Warehouse management.
- Warehouse-location management.
- PostgreSQL migrations `002` through `006` applied and verified in production.
- Idempotency, optimistic concurrency, transactional audit and hierarchy constraints.
- Vietnamese AppShell, dashboard and organization administration routes.
- Server-side organization gateway with no privileged token exposed to the browser.
- Canonical Vercel routes from project root `npp-core/web`.

## Final merge chain

```text
PR #26 -> a8038bfcdead3c6dc2b51b97a690974c30b5475c
PR #27 -> 9038e1bd1910ae9e3b466c28a93a605d24d6589b
PR #28 -> 83f32335da98606b6c1634472bf34e7e1100f5cb
PR #29 -> 20ebda163886e92f5d2c21c9732cfabc3c08cef7
PR #30 -> b9b548561c419727013d2fd273bfa0dec5d80a8e
```

Production Vercel deployment:

```text
Deployment: dpl_BugXwqsXxFGma3obV3QSAPP2YFu7
Commit: 23a35cca1004a8ce92f86c5d4ebef6e9fe034f04
Source: git/main
Target: production
State: READY
```

## Backups and migration evidence

```text
Pre-migration backup: b1
Restore rehearsal: PASS
Production migration verify: PASS
Post-migration backup: b002
```

Do not assume later backup, restore, deploy or migration status without auditing the provider again.

## Hold requested by product owner

Do **not** start another Phase 3 master-data slice yet.

The next task is a small UI-adjustment pass requested by the product owner against the already deployed shell, dashboard and organization screens. Wait for the exact UI changes before creating a branch or changing code.

Until that instruction arrives, do not start:

- users/employees/roles/scopes;
- customers or suppliers;
- products/SKU/units/pricing;
- inventory ledger;
- sales or purchasing;
- MCP cutover.

## Rules that remain active

- Branch from `main` as `agent/<task>`.
- CI green before merge.
- Production deploy remains separate after merge.
- Vercel production only through exact Issue #5 comment `/deploy-vercel-production`.
- No manual production DB edits.
- No migration without verified backup, restore rehearsal and reconciliation.
- No secrets in frontend, GitHub, chat, logs or screenshots.
