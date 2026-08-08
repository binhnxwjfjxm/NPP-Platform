# Phase 9.3 — MCP Heroku + PostgreSQL runtime/DB-role closure

Issue: #390  
Parent: #386

## Scope

Phase 9.3 closes the MCP runtime/provider boundary only. It does not perform a production deploy, migration, legacy import, R2 migration, DNS change or cutover.

## Source truth on entry

Baseline for this slice: `main@829de84028c0e8c7046a5a48bd3073dd1e6138b4`.

The source already enforces these contracts and they are intentionally retained:

- production persistence must be PostgreSQL;
- production legacy Supabase runtime is forbidden;
- `MCP_MIGRATION_DATABASE_URL` is forbidden in production runtime configuration;
- PostgreSQL readiness verifies schema, search path and the configured expected runtime role;
- MCP backend packaging/deploy targets `hung-phat-mcp`, while Core remains `hung-phat`;
- migration credential safety supports either separated credentials or explicitly acknowledged `essential_owner` mode without pretending it is least privilege.

## Gap closed by 9.3

Before this slice, provider inspection was embedded in the mutation-oriented MCP deploy/migrate workflow. Getting current Heroku evidence therefore required entering a workflow that also owns backup, maintenance, migration and release operations.

Phase 9.3 adds a separate read-only workflow and script:

- exact command: `/audit-heroku-mcp-production` on Issue #390;
- reads Heroku app, release, config-name presence, add-on plan and attachment metadata;
- never writes config vars;
- never creates a backup;
- never enables maintenance mode;
- never runs migrations;
- never pushes or releases a container;
- probes `/health/live` and `/health/ready`;
- opens a read-only PostgreSQL connection through the same runtime adapter to verify schema/search-path/expected-role readiness;
- compares Core and MCP database targets without publishing connection identifiers;
- publishes only sanitized evidence to Issue #390.

## DB credential decision

Heroku currently documents additional Postgres credentials as unavailable on Essential plans and available on Advanced, Standard, Premium, Private and Shield production plans.

The audit therefore fails closed when source credential mode and provider capability disagree:

- `heroku-postgresql:essential-*` -> `essential_owner`, same provider credential identity, `leastPrivilege=false`;
- Advanced/Standard/Premium/Private/Shield -> separated runtime/migration credential identities, `leastPrivilege=true`.

This records provider reality instead of claiming least privilege where the plan cannot provide it.

## Shared database proof

The audit requires all of the following:

1. Core owner app and MCP app are distinct and resolve to the expected Heroku apps.
2. MCP stack is `container`.
3. Required MCP config names are present without printing values.
4. MCP and Core `DATABASE_URL` values resolve to the same host/port/database target without exposing those components.
5. The Core app has exactly one Heroku Postgres add-on providing `DATABASE_URL`.
6. MCP either has a formal attachment to that same add-on or is classified as `shared_target_config` when the same database target is supplied through config.
7. Runtime PostgreSQL readiness succeeds with the configured MCP schema and expected role.
8. Production persistence is PostgreSQL, legacy runtime is disabled and a migration credential is not stored in runtime config.
9. Both MCP health endpoints return 200.

## Release/source evidence boundary

Heroku container release metadata exposes the current release/version but does not expose a Git commit SHA for the image. The audit records both the exact audited `main` SHA and current Heroku release metadata, and explicitly reports `container_release_does_not_expose_git_sha` rather than inventing an exact source correlation.

The last known deploy source remains historical deployment evidence; a future production deploy must continue to record its exact source SHA separately.

## Completion gate

Close #390 only after:

- the source PR is green and merged;
- the read-only audit is run once from merged `main`;
- sanitized provider evidence confirms PostgreSQL/shared-target/runtime-role/credential behavior;
- no valid review finding remains.

Branches are retained after merge per owner workflow. No production deploy or migration is part of this gate.
