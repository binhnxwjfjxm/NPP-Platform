# MCP Field Vercel project bootstrap checklist

This checklist is for the one-time creation of the MCP Field frontend project. It does not deploy production.

## Create project

- Team: `binhnxwjfjxms-projects`
- Project name: `mcp-field`
- Project ID: `prj_854SWdJeDEOPezAvvTZzTaRvZUSq`
- Repository: `binhnxwjfjxm/NPP-Platform`
- Root directory: `mcp`
- Framework: Next.js
- Automatic Git deployments: OFF
- Production alias: `https://mcp-field-binhnxwjfjxms-projects.vercel.app`

Do not reuse the Core project `npp-platform`.

## Frontend environment boundary

Configure only frontend/server proxy variables required by the MCP web application. The backend API target belongs to Heroku app `hung-phat-mcp`.

Do not add:

- `DATABASE_URL`;
- PostgreSQL credentials;
- Heroku API credentials;
- service-role database credentials;
- backend-only R2 credentials.

## GitHub deployment configuration

The manual workflow pins the non-secret MCP project ID and production alias in source. Repository variables `VERCEL_MCP_PROJECT_ID` and `VERCEL_MCP_PRODUCTION_URL` are not required.

Keep `VERCEL_TOKEN` only in GitHub Actions secrets and verify it is valid before the first manual deployment.

## First controlled deployments

For the first two or three releases, an operator may run the Vercel deployment manually and record:

- exact `main` SHA;
- Vercel project ID;
- deployment URL;
- `/` response;
- `/visits` response;
- one `/_next/static/` asset response.

Use the GitHub Actions workflow:

```text
Manual Vercel MCP production deploy
```

The Issue #5 command remains available:

```text
/deploy-vercel-mcp-production
```

Core remains on its separate workflow and command:

```text
Manual Vercel NPP production deploy
/deploy-vercel-production
```
