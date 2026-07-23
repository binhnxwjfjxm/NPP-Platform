# A5.5.2 — Route Settings Retirement

## Original inventory

```text
POST /api/mcp-settings/order-template
POST /api/mcp-settings/test-template
POST /api/mcp-settings/report-template
POST /api/mcp-settings/followup-template
POST /api/mcp-settings/skip-reason-template
POST /api/mcp-settings/customer-add-rule
POST /api/mcp-settings/session-status
```

## Root finding

A full-repository source inventory found no live POST caller for any of the seven routes.

- `/mcp-setting` currently uses `/api/mcp-report-settings` through the typed persisted-idempotent report-setting owner.
- The only live `session-status` references are GET reads used to load current session state.
- The seven POST routes and their save helpers existed only in the legacy backend plus historical plan documents.

Therefore adding seven new persisted-idempotent wrappers would preserve dead API surface and create duplicate settings ownership. The correct A5.5.2 action is source retirement.

## Source change

Removed from `apps/backend/server.js`:

- seven POST route branches;
- seven dead save helpers;
- five helper normalizers used only by those save helpers.

Retained:

```text
GET /api/mcp-settings/order-template
GET /api/mcp-settings/templates
GET /api/mcp-settings/skip-reason-template
GET /api/mcp-settings/customer-add-rule
GET /api/mcp-settings/session-status
```

Also retained the active `/api/mcp-report-settings` read/write owner and its stable idempotency operations.

## Runtime behavior after a future backend rollout

- retired POST endpoints return canonical 404 through the legacy fallback;
- required GET readers continue to work;
- no schema or RPC is dropped by this source slice;
- production remains unchanged until an explicitly approved VPS rollout.

## Contracts

- all retired save symbols remain absent;
- `handlePost` cannot claim any retired settings route;
- required GET readers remain present;
- current settings UI remains on `/api/mcp-report-settings`;
- no live source caller can POST to a retired route;
- Foundation scanner, backend tests, typecheck, production build and browser smoke must pass.

## Coverage decision

Retirement closes the seven original mutation-route cases without adding replacement mutations:

```text
source coverage: 21/30 -> 28/30
runtime verified: remains 14/30 until backend rollout evidence
remaining original routes: two cross-system R2 archive intents
```

## Non-scope

- no Supabase migration apply or function drop;
- no VPS pull;
- no Vercel deploy;
- no archive/R2 change;
- no NPP-F06 or Order Core;
- no MCP mobile fix pass.
