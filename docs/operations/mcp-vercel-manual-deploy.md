# MCP Field manual Vercel deployment

## Boundary

MCP Field frontend and NPP Core frontend are independent deployment targets.

- Core command on Issue #5: `/deploy-vercel-production`
- MCP Field command on Issue #5: `/deploy-vercel-mcp-production`
- Both commands deploy the exact current `main` SHA.
- Neither command deploys a Heroku backend.
- MCP backend `hung-phat-mcp` remains a separate manual release, smoke and rollback boundary.
- Automatic Vercel deployments remain disabled.

## Required repository configuration

The MCP workflow pins its non-secret deployment identity directly in source so the manual Actions button does not depend on optional repository variables:

```text
Vercel team: team_hBA8rX68UHC8ogvREkOyQlJ2
MCP project: prj_854SWdJeDEOPezAvvTZzTaRvZUSq
Production alias: https://mcp-field-binhnxwjfjxms-projects.vercel.app
```

The workflow still rejects the NPP Core project ID and verifies the linked Vercel project and root directory before building.

The existing secret remains:

```text
VERCEL_TOKEN=<valid Vercel token stored only in GitHub Actions secrets>
```

Do not commit or paste the token.

## Vercel project contract

```text
Project: mcp-field
Root directory: mcp
Framework: Next.js
Git automatic deployments: OFF
Production branch source: main through the guarded GitHub workflow only
Backend API owner: Heroku app hung-phat-mcp
```

The frontend project must not receive a database URL or backend-only credentials.

## Manual rollout sequence

1. Merge an MCP frontend change to `main` after CI is green.
2. Confirm the workflow still pins the dedicated MCP project and production alias.
3. Run `Manual Vercel MCP production deploy` in GitHub Actions or comment the exact command `/deploy-vercel-mcp-production` on Issue #5.
4. Verify the workflow checks out exact `origin/main`.
5. Verify `/`, `/visits` and a `/_next/static/` asset.
6. Record the deployed SHA and deployment URL.

A Core-only change uses `/deploy-vercel-production` and does not trigger this workflow. A backend-only MCP change is released separately to `hung-phat-mcp` and does not trigger a Vercel deployment.
