# NPP Core

`npp-core` is the reserved workspace for the future distributor core platform.

## Current phase

This directory is intentionally held at **Phase 0 — repository baseline**. Do not add Core business logic, database schemas, inventory flows, purchasing, sales, accounting, or XNT features here until every Phase 0 gate in `NPP_PLATFORM_MASTER_PLAN.md` is verified green.

## Planned scope

Later phases may introduce:

- `api` — Core API and platform services;
- `web` — Core web application;
- shared contracts and domain packages as defined by the monorepo plan;
- database migrations through the repository migration strategy.

The exact structure must follow the Master Plan and be introduced phase by phase. Empty local folders are not a source of truth because Git does not track empty directories.

## Guardrails

- Keep MCP operational while Core is developed separately.
- Never commit secrets or local environment files.
- Every new workspace must build and test independently.
- Database changes require reviewed migrations.
- Do not jump ahead of the current phase gate.
