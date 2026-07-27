# NPP Platform — Latest Handoff

> Updated: 2026-07-27
> Current checkpoint: Phase 3.3A through Phase 3.3F are complete in source. The grouped Phase 3 database/Heroku rollout has been completed and verified by the operator. Vercel production deployment remains separate and has not been rerun after the deployment-control fix.

## Current production status

```text
Frontend Core: https://npp-platform.vercel.app
Backend Core: https://hung-phat-945da1547594.herokuapp.com
Database: Heroku PostgreSQL
Vercel Auto Deploy: OFF
Heroku Automatic Deploy: OFF
Grouped Phase 3 database/Heroku rollout: COMPLETED (operator-confirmed)
Vercel deployment after workflow fix: NOT RUN
```

Important evidence boundary:

- The operator confirmed that the real Heroku/PostgreSQL audit, fresh backup, PostgreSQL 17 restore rehearsal, migrations `010` through `016`, reconciliation, API tests, manual Heroku deployment, health checks, smoke tests and post-migration backup were completed.
- Exact provider identifiers such as backup IDs, release number and timestamps are not currently recorded in this repository handoff. Do not invent them.
- Do not rerun the grouped rollout merely because those identifiers are absent. Audit actual provider state first if a later task requires exact evidence.

## Phase 3 completion

```text
3.3A customers/customer groups/addresses       COMPLETE
3.3B suppliers/contacts/addresses/terms         COMPLETE
3.3C products/variants/SKUs/categories/brands  COMPLETE
3.3D units/conversions/barcodes                 COMPLETE
3.3E price lists/channel price resolution       COMPLETE
3.3F document numbering                         COMPLETE
Grouped DB/Heroku rollout                       COMPLETE (operator-confirmed)
```

Delivered Phase 3 migrations:

```text
010_customer_master_data
011_supplier_master_data
012_product_catalog_foundation
013_product_units_conversions_barcodes
014_price_lists_channel_resolution
015_document_numbering_foundation
016_document_numbering_allocation
```

## Vercel deployment control

Merged on `main`:

```text
2e3638efd6290cfd459a6de93da3b20f916844db
fix(vercel): use manual CLI production deployment
```

Locked behavior:

- `npp-core/web/vercel.json` keeps `git.deploymentEnabled=false` permanently.
- The production workflow must never toggle `vercel.json` or push generated commits to `main`.
- Git pushes and pull requests must not be used as the production deployment trigger.
- Production is deployed manually through Vercel CLI by the guarded Issue #5 command `/deploy-vercel-production` or manual workflow dispatch.
- Required GitHub secret names are `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`; never expose their values.
- Do not trigger Vercel until the previously reported rate limit is confirmed recovered.
- After deployment verify `/`, `/dashboard`, `/login` and a real `/_next/static` asset URL.

Incident history:

- The former one-shot gate workflow created commits that toggled `git.deploymentEnabled` and caused many Vercel deployment records to be ingested and canceled.
- PR #57 was a duplicate branch from already-merged rollout-prep work and was closed without merge.
- PR #58 replaced the broken Vercel gate workflow with manual CLI deployment and was merged.

See:

```text
docs/operations/vercel-manual-deployment-control-2026-07-27.md
```

## Current next step

Do not repeat the completed Phase 3 database/Heroku rollout.

The next operator sequence is:

1. Confirm `main` and local are synchronized at or after `2e3638e`.
2. Confirm repository verification remains green.
3. Confirm the three required Vercel secrets exist by name without exposing their values.
4. Wait until the Vercel rate limit is confirmed recovered.
5. Run exactly one guarded production Vercel deployment.
6. Smoke-test the production frontend routes and static assets.
7. Record the exact deployed SHA and deployment URL in this handoff.
8. Then select the next product phase from `NPP_PLATFORM_MASTER_PLAN.md`; do not assume inventory, purchasing, sales or MCP cutover is automatically next without checking the phase gate.

## Workflow rules

- Read `NPP_PLATFORM_MASTER_PLAN.md` first and this handoff second.
- Check actual `main`, open PRs/branches and latest CI before acting.
- Branch from `main` as `agent/<task>`.
- CI must be green before merge.
- Merge only after clean review and green checks, then verify `main` and delete the branch.
- Production deployment is always a separate explicit task.
- No manual production database edits.
- Do not rerun migrations or restore operations without first auditing current provider state.
- Never expose secrets, tokens, provider credentials or `DATABASE_URL` in frontend, GitHub, chat, logs or screenshots.
