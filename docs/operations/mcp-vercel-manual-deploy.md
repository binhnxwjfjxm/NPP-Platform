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

Set these GitHub repository variables after the MCP Vercel project exists:

```text
VERCEL_MCP_PROJECT_ID=<MCP Field Vercel project ID>
VERCEL_MCP_PRODUCTION_URL=https://<MCP Field production domain>
```

The MCP workflow rejects the NPP Core project ID and refuses to run when either MCP variable is missing.

The existing secret remains:

```text
VERCEL_TOKEN=<valid Vercel token stored only in GitHub Actions secrets>
```

Do not commit or paste the token.

## Vercel project contract

```text
Project: separate MCP Field project
Root directory: mcp
Framework: Next.js
Git automatic deployments: OFF
Production branch source: main through the guarded GitHub workflow only
Backend API owner: Heroku app hung-phat-mcp
```

The frontend project must not receive a database URL or backend-only credentials.

## Manual rollout sequence

1. Merge an MCP frontend change to `main` after CI is green.
2. Confirm the MCP Vercel project variables still point to the separate MCP project.
3. Comment the exact command `/deploy-vercel-mcp-production` on Issue #5.
4. Verify the workflow checks out exact `origin/main`.
5. Verify `/`, `/visits` and a `/_next/static/` asset.
6. Record the deployed SHA and deployment URL.

A Core-only change uses `/deploy-vercel-production` and does not trigger this workflow. A backend-only MCP change is released separately to `hung-phat-mcp` and does not trigger a Vercel deployment.
