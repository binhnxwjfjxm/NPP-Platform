# MCP Field Vercel project bootstrap checklist

This checklist is for the MCP Field frontend project. It does not deploy production by itself.

## Project identity

- Team: `binhnxwjfjxms-projects`
- Project name: `mcp-field`
- Project ID: `prj_854SWdJeDEOPezAvvTZzTaRvZUSq`
- Repository: `binhnxwjfjxm/NPP-Platform`
- Root directory: `mcp`
- Framework: Next.js
- Automatic Git deployments: OFF
- Production domain: `https://mcp.nguyenlieuhungphat.com`

Do not reuse the Công Ty project `npp-platform`.

## Frontend environment boundary

MCP Field has two server-side provider bindings:

```text
CORE_API_INTERNAL_URL -> Công Ty VPS HTTPS
BACKEND_API_BASE_URL  -> MCP VPS HTTPS
```

`BACKEND_API_TOKEN` is a server-only Vercel production secret. It must never be browser-visible or printed by deployment workflows.

Do not add:

- `DATABASE_URL`;
- PostgreSQL credentials;
- Heroku API credentials;
- Supabase service-role credentials;
- backend-only R2 credentials.

## GitHub deployment configuration

Required repository variables:

```text
VPS_COMPANY_HOST
VPS_MCP_HOST
```

Required secret:

```text
VERCEL_TOKEN
```

The workflow derives the two production HTTPS URLs from the VPS variables, validates both health endpoints, verifies the MCP backend token binding exists in Vercel, then deploys exact `main`.

## Controlled deployment

Use the GitHub Actions workflow:

```text
Manual Vercel MCP production deploy
```

Exact Issue #5 command:

```text
/deploy-vercel-mcp-production
```

A wiring-only recovery uses:

```text
/repair-mcp-auth-wiring-production
```

Công Ty remains on its separate workflow and command:

```text
Manual Vercel NPP production deploy
/deploy-vercel-production
```

Neither MCP command restarts or deploys Công Ty backend, MCP backend, PostgreSQL or the proxy listeners.