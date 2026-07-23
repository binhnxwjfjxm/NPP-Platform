# A5.5.2 — Route master create/update slice

> Date: 2026-07-19  
> Phase: Phase A / NPP-F05 / A5.5.2  
> Parent inventory: `A5_5_2_MUTATION_INVENTORY_AND_SESSION_LIFECYCLE.md`

## 1. Why this slice contains two routes only

The remaining Route Master group contains five public mutations, but they do not share one transaction owner:

```text
DB-only route aggregate
- POST  /api/routes
- PATCH /api/routes/:id

DB-only route-customer aggregate with historical overloads
- PATCH /api/route-customers/:id

Cross-system R2 deletion orchestration
- POST /api/routes/:id/archive
- POST /api/route-customers/:id/archive
```

The smallest logically closed next slice is therefore route create/update. Customer update is deferred until its two historical PostgreSQL overloads are resolved explicitly. Archive operations remain separate because their owner spans PostgreSQL deletion jobs and private R2 object deletion; they cannot be represented honestly as one normal PostgreSQL wrapper transaction.

## 2. Selected public operations

| Public route | Browser caller | Current owner | Canonical business RPC | Aggregate | Operation |
|---|---|---|---|---|---|
| `POST /api/routes` | `McpMasterView.submitRouteEditor` | legacy `createMcpRouteV1` | `mcp_create_route` | route | `route.create` |
| `PATCH /api/routes/:id` | `McpMasterView.submitRouteEditor` | legacy `updateMcpRouteV1` | `mcp_update_route` | route | `route.update` |

## 3. Business invariants

### Create

- route name is required and trimmed;
- weekday is either null or between 0 and 6;
- route identifier is generated once by the PostgreSQL owner;
- the inserted route starts active;
- the same idempotency key and payload must return the persisted original route response;
- the same key with a changed payload must conflict instead of creating a second route.

### Update

- route id is required;
- weekday remains null or between 0 and 6;
- only supplied fields replace current values;
- an empty supplied route name does not erase the existing required name;
- missing route returns the canonical not-found business error;
- one PostgreSQL UPDATE owns the row lock and mutation;
- trusted Foundation context is written on the surviving route aggregate in the same wrapper transaction.

## 4. Architecture

```text
McpMasterView
-> Next same-origin /api/routes or /api/routes/:id
-> authenticated Foundation Gateway
-> typed route mutation owner
-> service-role-only persisted-idempotent PostgreSQL wrapper
-> existing mcp_create_route / mcp_update_route owner
```

The Gateway must intercept these routes before legacy fallback. Browser code must not call Supabase or mint provider context.

## 5. Planned wrappers

```text
mcp_idempotent_create_route(
  p_route_name,
  p_area,
  p_weekday,
  p_note,
  p_distributor_id,
  p_context
)

mcp_idempotent_update_route(
  p_route_id,
  p_route_name,
  p_area,
  p_weekday,
  p_note,
  p_active,
  p_distributor_id,
  p_context
)
```

Both wrappers must:

- call `mcp_idempotency_begin` with exact operation/method/route;
- replay the persisted response;
- delegate to the existing canonical owner;
- persist `foundation_context` into `mcp_routes.raw_payload`;
- call `mcp_idempotency_complete` with the route id;
- revoke `PUBLIC`, `anon`, `authenticated` and grant only `service_role`.

## 6. Caller contract

- create uses `idempotentMutationFetch` with `route.create`;
- update uses `idempotentMutationFetch` with `route.update`;
- archive remains unchanged and must not be falsely marked complete by this slice;
- one network retry reuses one helper-generated key for the same click intent;
- saving state continues to suppress parallel button clicks.

## 7. Test plan

### Source gates

- migration test: two wrappers, exact operation/method/route, canonical owners, context persistence and service-role-only grants;
- typed owner test: validation, normalized arguments and trusted Foundation context;
- transitional API test: POST/PATCH intercepted before legacy;
- browser caller contract: create/update use exact operations while archive remains outside this slice;
- exact scanner fingerprints for two literal RPC targets;
- Foundation, typecheck, production build and browser smoke.

### Runtime after explicit rollout approval

For create and update independently:

1. execute with guarded temporary route;
2. replay same key/payload and compare response;
3. conflict same key/changed payload;
4. verify idempotency record and append-only audit;
5. verify trusted installation/request/actor context in route raw payload;
6. clean the temporary route through the guarded cleanup owner.

## 8. Coverage movement

```text
Original source coverage before slice: 18/30
Route create/update source slice:       +2
Source coverage after merge:            20/30
Original routes remaining:              10
Runtime coverage remains:               14/30 until rollout and smoke
```

## 9. Explicit non-scope

- no route-customer update in this slice;
- no route or route-customer archive orchestration in this slice;
- no migration apply, VPS pull or Vercel deploy without explicit approval;
- no NPP-F06 or Order Core;
- no MCP mobile fix pass;
- no changes to `milktea-backend` or port `3002`.
