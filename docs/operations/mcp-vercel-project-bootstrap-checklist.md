# MCP Field Vercel project bootstrap checklist

This checklist is for the one-time creation of the MCP Field frontend project. It does not deploy production.

## Create project

- Team: `binhnxwjfjxms-projects`
- Project name: choose the dedicated MCP Field project name
- Repository: `binhnxwjfjxm/NPP-Platform`
- Root directory: `mcp`
- Framework: Next.js
- Automatic Git deployments: OFF

Do not reuse the Core project `npp-platform`.

## Frontend environment boundary

Configure only frontend/server proxy variables required by the MCP web application. The backend API target belongs to Heroku app `hung-phat-mcp`.

Do not add:

- `DATABASE_URL`;
- PostgreSQL credentials;
- Heroku API credentials;
- service-role database credentials;
- backend-only R2 credentials.

## GitHub deployment variables

After the project exists, add repository variables:

```text
VERCEL_MCP_PROJECT_ID=<project id from Vercel>
VERCEL_MCP_PRODUCTION_URL=https://<production domain>
```

Keep `VERCEL_TOKEN` only in GitHub Actions secrets and verify it is valid before the first manual deployment.

## First controlled deployments

For the first two or three releases, an operator may run the Vercel deployment manually and record:

- exact `main` SHA;
- Vercel project ID;
- deployment URL;
- `/` response;
- `/visits` response;
- one `/_next/static/` asset response.

After the project and smoke contract are confirmed, use the Issue #5 command:

```text
/deploy-vercel-mcp-production
```

Core remains on its separate command:

```text
/deploy-vercel-production
```
