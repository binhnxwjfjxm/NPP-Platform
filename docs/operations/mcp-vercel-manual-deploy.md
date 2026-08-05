# MCP Field manual Vercel deployment

## Boundary

MCP Field frontend and NPP Core frontend are independent deployment targets.

- Core command on Issue #5: `/deploy-vercel-production`
- MCP Field command on Issue #5: `/deploy-vercel-mcp-production`
- Both commands deploy the exact current `main` SHA.
- Neither command deploys a Heroku backend.
- MCP remains on its legacy pass-through runtime until a separate audited cutover is approved.
- Automatic Vercel deployments remain disabled.

## Pinned deployment identity

The MCP workflow pins its non-secret deployment identity directly in source:

```text
Vercel team: team_hBA8rX68UHC8ogvREkOyQlJ2
MCP project: prj_854SWdJeDEOPezAvvTZzTaRvZUSq
User-facing production domain: https://mcp.nguyenlieuhungphat.com
Root directory: mcp
```

The workflow rejects the NPP Core project ID and verifies the linked Vercel project and root directory before building. The exact Vercel deployment URL may be protected by Vercel Authentication, so it is used for deployment identity and reachability checks; page content and static assets are verified on the public user-facing production domain.

## Required GitHub Actions secrets

Store the current MCP legacy runtime values under these repository secret names:

```text
VERCEL_TOKEN
MCP_BACKEND_API_BASE_URL
MCP_BACKEND_API_TOKEN
MCP_SUPABASE_URL
MCP_SUPABASE_ANON_KEY
```

`MCP_LEGACY_ACTOR_ID` is pinned in the workflow as the non-secret value `service:mcp-plan:mcp-v1`.

The workflow validates the five runtime values, masks them, upserts them as encrypted Production variables on the dedicated `mcp-field` project, and exports them only to the guarded build process. When a source is missing, the Issue #5 report identifies the missing GitHub secret name without printing any value.

Do not commit or paste secret values. Do not add `DATABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` to Vercel.

## Vercel project contract

```text
Project: mcp-field
Root directory: mcp
Framework: Next.js
Git automatic deployments: OFF
Production branch source: main through the guarded GitHub workflow only
Backend owner during this transition: existing MCP legacy VPS runtime
Database/read owner during this transition: existing MCP Supabase project
```

The dedicated frontend project receives only the runtime values required by the existing pass-through application. It must not receive PostgreSQL credentials, Supabase service-role credentials, Heroku credentials, or unrelated provider secrets.

## Manual rollout sequence

1. Merge an MCP frontend change to `main` after CI is green.
2. Confirm the five required GitHub Actions secrets are present and current.
3. Run `Manual Vercel MCP production deploy` in GitHub Actions or comment `/deploy-vercel-mcp-production` on Issue #5.
4. Verify exact `origin/main`, the dedicated project link, root `mcp`, and Auto Deploy OFF.
5. Verify the exact deployment is reachable, then verify `/`, `/mcp`, `/routes`, `/visits`, `/field-checks`, and one `/_next/static/` asset on `https://mcp.nguyenlieuhungphat.com`.
6. Record the deployed SHA and exact deployment URL.

A Core-only change uses `/deploy-vercel-production` and does not trigger this workflow. Heroku MCP deployment and future VPS/PostgreSQL cutover remain separate operations.
