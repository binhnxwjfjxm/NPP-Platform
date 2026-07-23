# A5.5.2 — Route-customer update slice

> Date: 2026-07-19  
> Phase: Phase A / NPP-F05 / A5.5.2  
> Selected route: `PATCH /api/route-customers/:id`

## 1. Root cause: two historical PostgreSQL overloads

Production currently contains two functions named `mcp_update_route_customer`:

```text
10 parameters
- route_customer_id
- customer_name
- phone
- area
- address
- sort_order
- note
- active
- geo_lat
- geo_lng

13 parameters
- all fields above
- geo_accuracy
- geo_source
- google_maps_url
```

The active legacy adapter and browser payload already use the 13-parameter contract. The 10-parameter overload loses GPS accuracy, source and Maps URL semantics and therefore is not the canonical owner for this slice.

## 2. Canonical owner decision

The persisted-idempotent wrapper must call the **13-parameter overload with all 13 named arguments**. It must never rely on default arguments or an ambiguous short call.

The old 10-parameter overload is left in place for compatibility until a separate schema-retirement decision proves that no external caller needs it. This slice does not drop or revoke it silently.

## 3. Public operation

| Public route | Browser caller | Operation | Aggregate |
|---|---|---|---|
| `PATCH /api/route-customers/:id` | `McpMasterView.submitCustomerEditor` | `route-customer.update` | route customer |

## 4. Invariants

- route-customer id is required;
- customer name cannot be erased by an empty update;
- omitted fields preserve existing values;
- sort order is a non-negative integer when supplied;
- latitude and longitude must be supplied together;
- latitude is within `[-90, 90]` and longitude within `[-180, 180]`;
- GPS accuracy is non-negative when supplied;
- coordinates update capture time and use the explicit source, defaulting to `browser`;
- Maps URL is generated from coordinates when not supplied;
- missing route customer returns canonical `route_customer_not_found`;
- trusted Foundation context is persisted on the surviving `mcp_route_customers.raw_payload` row;
- same key/same payload replays the persisted response;
- same key/different payload conflicts.

## 5. Architecture

```text
McpMasterView
-> Next same-origin PATCH /api/route-customers/:id
-> authenticated Foundation Gateway
-> exact route-customer API owner
-> typed updateRouteCustomer use case
-> service-role-only mcp_idempotent_update_route_customer wrapper
-> explicit 13-parameter mcp_update_route_customer overload
```

The exact route regex must not claim `/archive`; R2 delete orchestration remains outside this slice.

## 6. Test plan

- migration contract proves the wrapper has 14 inputs including context and calls all 13 named business arguments;
- typed owner tests validation, normalization, GPS/Maps semantics and trusted context;
- Foundation API test proves PATCH ownership and archive exclusion;
- browser caller contract requires `idempotentMutationFetch` with `route-customer.update` while archive remains outside the slice;
- direct-provider scanner uses one exact literal RPC fingerprint;
- Foundation, backend, typecheck, production build and browser smoke must PASS.

## 7. Coverage movement

```text
Original source coverage before slice: 20/30
Route-customer update source slice:    +1
Source coverage after merge:           21/30
Original routes remaining:              9
Runtime coverage remains:              14/30 until rollout and smoke
```

## 8. Non-scope

- no route/customer archive idempotency in this slice;
- no retirement of the 10-parameter overload without separate evidence;
- no migration apply, VPS pull or Vercel deploy without explicit approval;
- no NPP-F06, Order Core or MCP mobile fix pass;
- no changes to `milktea-backend` or port `3002`.
