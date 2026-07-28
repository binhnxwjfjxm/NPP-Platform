# Vercel manual deployment control — 2026-07-27

## Purpose

Prevent ordinary GitHub pushes and pull-request commits from creating automatic Vercel builds while keeping production deployment available through one explicit operator command.

## Incident and verified facts

On 2026-07-27, the `npp-platform` Vercel project accumulated many `CANCELED` deployment records from normal branch and pull-request commits.

The previous production workflow attempted to deploy by:

1. changing `npp-core/web/vercel.json` from `git.deploymentEnabled=false` to `true`;
2. committing and pushing that change to `main`;
3. waiting for Vercel Git integration;
4. committing another change to restore `deploymentEnabled=false`.

This design was wrong for this project because every pushed commit could still be received and counted by Vercel before cancellation. Toggling the file also generated additional commits and deployment events. Using `[skip ci]` did not prevent Vercel from creating a deployment record.

The incident reached Vercel rate limiting. Do not retry production deployment until provider quota has recovered.

## Locked target design

`npp-core/web/vercel.json` must remain permanently locked:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "git": {
    "deploymentEnabled": false
  }
}
```

The production workflow must never:

- set `deploymentEnabled=true`;
- commit or push changes to `vercel.json`;
- push any generated commit to `main`;
- open and close a temporary Git deployment gate;
- rely on a Git push to trigger production deployment.

Production deployment uses Vercel CLI directly from GitHub Actions:

1. accept only `workflow_dispatch` or the exact Issue #5 comment `/deploy-vercel-production`;
2. permit only the approved GitHub actors;
3. check out the exact current `main` commit and record its SHA;
4. verify `deploymentEnabled=false` remains locked;
5. run `vercel pull --environment=production`;
6. deploy the checked-out source directly with `vercel deploy --prod` so the build runs on Vercel Linux;
7. smoke-test `/`, `/dashboard`, `/login`, the protected organization routes, the organization APIs, and at least one `/_next/static` CSS and JS asset;
8. report the exact deployed SHA and deployment URL.

## Required GitHub secrets

The workflow references these GitHub Actions secrets by name only:

```text
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
```

Never commit, print, paste, screenshot, or expose their values. No database credential or `DATABASE_URL` belongs in Vercel.

## Operator command

After this workflow is merged, after CI is green, and only after Vercel rate limits recover, production deployment is requested with the exact Issue #5 comment:

```text
/deploy-vercel-production
```

One command must correspond to one intentional production deployment. Do not post the command repeatedly while a run is queued or active.

## Current status at handoff

```text
Automatic Git deployment config: LOCKED false
Old gate-toggle workflow: REPLACEMENT IN PR
Vercel rate limit: REPORTED ACTIVE BY OWNER
New production deployment: NOT RUN
Production success: NOT CLAIMED
Provider verification after quota recovery: REQUIRED
```

## Rules for the next chat

1. Read this document before touching Vercel.
2. Inspect current `main`, the deployment-control PR, and CI.
3. Do not call Vercel merely to test whether rate limiting has expired unless the owner explicitly authorizes a single check.
4. Do not trigger `/deploy-vercel-production` until the replacement workflow is merged and the required secrets are confirmed by name without exposing values.
5. Never restore the toggle-and-push design.
6. A `READY` provider state is insufficient: verify the real production domain and required routes.
7. Report success only with exact SHA, production deployment target, production alias, and smoke-test evidence.
