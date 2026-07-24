# Database foundation

This repository keeps a single PostgreSQL cluster contract for the current installation.

## Ownership

- `shared` schema: cross-domain common objects, installations, users, roles, and shared reference data.
- `mcp` schema: MCP field runtime ownership.
- `sales`, `purchasing`, `inventory`, `accounting`, `reporting` schemas: reserved for NPP Core domain ownership in later phases.

## Migration ordering

1. `shared`
2. `mcp`
3. `inventory`
4. `sales`
5. `purchasing`
6. `accounting`
7. `reporting`

## Guardrails

- Keep one PostgreSQL cluster per installation.
- Do not modify production databases manually in this task.
- Do not execute real migrations during this skeleton phase.
- Use rehearsal and seed artifacts only for validation boundaries.
