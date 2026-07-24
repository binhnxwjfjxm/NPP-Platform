# NPP Core

`npp-core` contains the distributor Core application that will own official purchasing, sales, inventory, receivables, payables, costing, reporting, permissions, and audit workflows.

## Current phase

Phase 0 repository baseline is complete. Phase 1 monorepo foundation is being implemented, with the minimum Phase 2 API/web skeleton needed to verify independent builds and Heroku process wiring.

Current workspaces:

- `api` — NPP Core API skeleton, local port `3004`;
- `web` — NPP Core web skeleton, local port `3003`.

MCP remains a separate application and backend inside the same monorepo. Its current runtime, domain ownership, and local ports remain unchanged during this phase.

## Current boundaries

This phase contains infrastructure only:

- health/config/error-envelope contracts;
- fail-fast runtime configuration;
- PostgreSQL pool and migration-runner foundation;
- shared package skeletons;
- placeholder AppShell/login/dashboard pages;
- independent build, test, and CI commands.

It does **not** contain inventory, purchasing, sales, accounting, XNT, or other Core business logic.

## Guardrails

- Keep MCP operational while Core is developed separately.
- Never commit secrets or local environment files.
- Every workspace must build and test independently.
- Database changes require reviewed migrations and a clean-database rehearsal.
- Core and MCP share one PostgreSQL installation but retain schema and service ownership boundaries.
- Do not deploy a feature branch or enable automatic Heroku/Vercel deployment.
