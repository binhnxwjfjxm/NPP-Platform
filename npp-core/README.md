# NPP Core

`npp-core` contains the distributor Core application that will own official purchasing, sales, inventory, receivables, payables, costing, reporting, permissions, and audit workflows.

## Current phase

Phase 0 repository baseline is complete. Phase 1 monorepo foundation is complete, and Phase 2 now adds the Core API request-context and authorization boundary.

Current workspaces:

- `api` — NPP Core API skeleton, local port `3004`;
- `web` — NPP Core web skeleton, local port `3003`.

MCP remains a separate application and backend inside the same monorepo. Its current runtime, domain ownership, and local ports remain unchanged during this phase.

## Current boundaries

This phase contains infrastructure and security primitives only:

- health/config/error-envelope contracts;
- fail-fast runtime configuration;
- server-owned request context and bootstrap bearer authentication;
- deny-by-default authorization with an explicit permission registry;
- PostgreSQL pool and migration-runner foundation;
- shared package skeletons;
- placeholder AppShell/login/dashboard pages;
- independent build, test, and CI commands.

It does **not** contain inventory, purchasing, sales, accounting, XNT, or other Core business logic.

## Security contract

The Core API is authenticated only through a server-controlled bearer token using `BACKEND_API_TOKEN`.

- request context is created inside the server and never trusted from request headers;
- `CORE_BOOTSTRAP_ACTOR_ID` is the required bootstrap actor identifier for the server-owned principal;
- route access is deny-by-default and requires an explicit permission from the server registry;
- public endpoints remain `/health/live` and `/health/ready`, while `/api/config` and `/health/authenticated` require bootstrap authorization.

## Guardrails

- Keep MCP operational while Core is developed separately.
- Never commit secrets or local environment files.
- Every workspace must build and test independently.
- Database changes require reviewed migrations and a clean-database rehearsal.
- Core and MCP share one PostgreSQL installation but retain schema and service ownership boundaries.
- Do not deploy a feature branch or enable automatic Heroku/Vercel deployment.
