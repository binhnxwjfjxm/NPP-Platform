# A5.5.2 — Remaining mutation inventory and session lifecycle slice

> Date: 2026-07-19  
> Phase: Phase A / NPP-F05 / A5.5.2  
> Decision: continue the Foundation master plan now; defer MCP live-device testing and UI fixes to a later focused pass.  
> This document changes sequencing only. It does not waive any production smoke or rollout gate.

## 1. Corrected coverage baseline

The previous handoff reported `13/30` and `17 remaining`. That count omitted the persisted-idempotent `route-customer.add` operation delivered by PR #29.

The fixed original inventory of 30 mutation route cases is now:

```text
A5.5.1 typed persisted-idempotent operations       9
route-customer.add                                  1
session customer order/test/report/follow-up        4
-----------------------------------------------------
verified original inventory coverage               14/30
remaining original inventory                       16
```

`session-customer.checkin.set` and standalone `order.create` were added after the original denominator was established. They must remain compliant, but they do not change the denominator of the original 30-route closure inventory.

## 2. Remaining 16 route cases

| # | Public mutation route | Current caller | Current owner / provider owner | Tables or RPC | Main invariant | Risk | Proposed slice |
|---|---|---|---|---|---|---|---|
| 1 | `POST /api/mcp-day/open-session` | `McpMasterView.openSession` -> Next backend proxy | legacy `openMcpDaySessionV1` | `mcp_open_route_session` | one active session per route; lock session before route; older active run finalized before opening a newer day | duplicate/open race can create conflicting lifecycle intent without persisted replay | S1 Session lifecycle |
| 2 | `POST /api/mcp-day/session-customer/status` | `McpSessionCompactViewFinal2.postJson` | legacy `updateMcpSessionCustomerStatusV1` | `mcp_set_session_customer_status` | reason required for skipped/cancelled; business activity cannot be silently discarded; visit and counters stay atomic | network retry can repeat visit/status mutation without persisted response | S1 Session lifecycle |
| 3 | `PATCH /api/mcp-sessions/:id` | `McpSessionsManagerSafe.save` -> Next session action proxy | legacy `updateMcpRouteSession` | `mcp_update_route_session` | closed sessions are read-only; date changes update visit dates; closing creates one session snapshot | retry around close/date change can repeat aggregate work and snapshot creation | S1 Session lifecycle |
| 4 | `DELETE /api/mcp-sessions/:id` | `McpSessionsManagerSafe.deleteSession` -> Next session action proxy | legacy `deleteMcpRouteSession` | `mcp_delete_empty_route_session` | only an empty, non-closed session can be hard-deleted; activity requires cancel instead | destructive retry has no persisted replay contract | S1 Session lifecycle |
| 5 | `POST /api/routes` | `McpMasterView.submitRouteEditor` -> Next proxy | legacy `createMcpRouteV1` | `mcp_create_route` / `mcp_routes` | route identity and required name are created once | duplicate route on retry | S2 Route master |
| 6 | `PATCH /api/routes/:id` | `McpMasterView.submitRouteEditor` -> Next proxy | legacy `updateMcpRouteV1` | `mcp_update_route` / `mcp_routes` | update one locked route without changing installation ownership | lost/repeated update and missing persisted audit | S2 Route master |
| 7 | `POST /api/routes/:id/archive` | `McpMasterView.submitRouteEditor` -> Next proxy | Foundation `deleteRouteAndMedia` | R2 delete lifecycle + `mcp_delete_route_hard` | parent hard-delete only after every claimed R2 object is confirmed deleted | destructive cross-system retry must replay the same parent job/result | S2 Route master |
| 8 | `PATCH /api/route-customers/:id` | `McpMasterView.submitCustomerEditor` -> Next proxy | legacy `updateMcpRouteCustomerV1` | `mcp_update_route_customer` / `mcp_route_customers` | preserve route/customer identity and GPS semantics | repeated patch and missing persisted audit | S2 Route master |
| 9 | `POST /api/route-customers/:id/archive` | `McpMasterView.submitCustomerEditor` -> Next proxy | Foundation `deleteRouteCustomerAndMedia` | R2 delete lifecycle + `mcp_delete_route_customer_hard` | customer hard-delete only after all media objects are deleted | destructive cross-system retry must not create competing delete jobs | S2 Route master |
| 10 | `POST /api/mcp-settings/order-template` | MCP settings screen -> Next backend proxy | legacy settings handler | `mcp_save_route_order_template` | one route-owned template and ordered items | repeated save can rewrite child rows without persisted replay | S3 Route settings |
| 11 | `POST /api/mcp-settings/test-template` | MCP settings screen -> Next backend proxy | legacy settings handler | `mcp_save_route_test_template` | route template and products are one logical save | retry may repeat replace-style child writes | S3 Route settings |
| 12 | `POST /api/mcp-settings/report-template` | MCP settings screen -> Next backend proxy | legacy settings handler | `mcp_save_route_report_template` | report type and route scope remain valid | retry/audit gap | S3 Route settings |
| 13 | `POST /api/mcp-settings/followup-template` | MCP settings screen -> Next backend proxy | legacy settings handler | `mcp_save_route_followup_template` | due days, priority and route scope are validated together | retry/audit gap | S3 Route settings |
| 14 | `POST /api/mcp-settings/skip-reason-template` | MCP settings screen -> Next backend proxy | legacy settings handler | `mcp_save_route_skip_reason_template` | reason types and ordered items are saved atomically | replace-style item duplication/rewrite on retry | S3 Route settings |
| 15 | `POST /api/mcp-settings/customer-add-rule` | MCP settings screen -> Next backend proxy | legacy settings handler | `mcp_save_route_customer_add_rule` | add mode is one of `session_only`, `route_only`, `both` | retry/audit gap | S3 Route settings |
| 16 | `POST /api/mcp-settings/session-status` | MCP settings/admin screen -> Next backend proxy | legacy settings handler | `mcp_set_route_session_status` -> `mcp_update_route_session` | selected route/date resolves one session and follows canonical lifecycle rules | admin caller can repeat a close/cancel transition without persisted replay | S3 Route settings |

## 3. Selected next slice — S1 Session lifecycle

S1 contains four runtime routes with one aggregate boundary:

```text
POST   /api/mcp-day/open-session
POST   /api/mcp-day/session-customer/status
PATCH  /api/mcp-sessions/:id
DELETE /api/mcp-sessions/:id
```

`POST /api/mcp-settings/session-status` remains in S3 because its caller and intent are administrative route settings. It may delegate to the same canonical session owner, but it is not the same public operation or user intent.

## 4. Root owners and invariants

### 4.1 Open route session

Owner: `public.mcp_open_route_session`.

- validates route and date;
- locks session rows before the route row;
- enforces one active session per route;
- finalizes an older active session before opening a newer day;
- closes an older run as `done` when it has activity, otherwise `cancelled`;
- freezes an existing same-day snapshot;
- creates the session and route-customer snapshot in one PostgreSQL transaction.

### 4.2 Set session-customer status

Owner: `public.mcp_set_session_customer_status`.

- locks the session-customer row;
- checks the parent session is mutable;
- requires a reason for `skipped` and `cancelled`;
- refuses to discard order/test/report/follow-up activity;
- creates or updates the visit and session-customer state atomically;
- recalculates session counters before returning.

### 4.3 Update route session

Owner: `public.mcp_update_route_session`.

- locks the session row;
- treats `done`, `completed` and `cancelled` as closed/read-only;
- validates `active`, `done`, `cancelled` transitions;
- updates historical visit dates before changing the session date/status;
- creates the canonical close-session report snapshot when status becomes `done`.

### 4.4 Delete empty route session

Owner: `public.mcp_delete_empty_route_session`.

- locks the session row;
- rejects closed sessions;
- checks snapshot activity, visits, follow-ups, reports and aggregate counters;
- raises `session_has_activity_cancel_instead` when any activity exists;
- hard-deletes only the empty session and its empty snapshot rows in one transaction.

## 5. Implementation contract

```text
Browser caller
-> Next same-origin proxy
-> authenticated Foundation Gateway
-> typed session-lifecycle use case
-> service-role-only persisted-idempotent RPC wrapper
-> existing canonical PostgreSQL business owner
```

The new wrappers must provide:

- one stable `Idempotency-Key` per user intent;
- claim, business mutation, response persistence and append-only audit in one PostgreSQL transaction;
- same-key/same-payload replay;
- same-key/different-payload conflict;
- trusted Foundation request/installation/actor context;
- neutral canonical public errors;
- no fallback to the legacy mutation owner after Foundation interception;
- exact direct-provider fingerprints only, no wildcard baseline.

## 6. Planned operations

| Operation | Method and route | Aggregate |
|---|---|---|
| `route-session.open` | `POST /api/mcp-day/open-session` | route session |
| `session-customer.status.update` | `POST /api/mcp-day/session-customer/status` | session customer |
| `route-session.update` | `PATCH /api/mcp-sessions/:id` | route session |
| `route-session.delete-empty` | `DELETE /api/mcp-sessions/:id` | route session |

## 7. Caller changes

- `McpMasterView.openSession`: replace raw `fetch` with `idempotentMutationFetch` using `route-session.open`.
- `McpSessionCompactViewFinal2`: retain its existing idempotent caller and lock the exact `session-customer.status.update` operation in tests.
- `McpSessionsManagerSafe.save`: replace raw `callApi` with `callIdempotentApi` using `route-session.update`.
- `McpSessionsManagerSafe.deleteSession`: replace raw `callApi` with `callIdempotentApi` using `route-session.delete-empty`.
- Next proxies continue forwarding the caller key through `proxyBackendRequest`.

## 8. Test plan

### Source and backend

- migration contract confirms four typed wrappers, exact operation/route inventory and service-role-only grants;
- use-case tests verify normalized arguments and trusted Foundation context;
- transitional API tests prove all four routes are intercepted before legacy fallback;
- caller contract proves no selected caller returns to raw `fetch`;
- direct mutation scanner remains `legacy_debt=0`, `unclassified=0`, `forbidden=0`.

### Runtime after merge and explicit rollout approval

For each operation:

1. execute with a unique key;
2. replay the same key/payload and compare the persisted response;
3. send the same key with a changed payload and require conflict;
4. verify append-only audit and trusted request/actor/installation context;
5. verify the business invariant and clean every temporary fixture.

Destructive smoke must use a guarded temporary empty session. It must never use a real production route/customer/session.

## 9. Expected coverage movement

```text
source baseline before S1: 14/30
S1 routes:                 +4
source coverage after S1:  18/30
remaining after S1:        12
```

Coverage advances only after source CI, migration rollout, VPS deployment and authenticated runtime smoke pass. Until then, documentation must distinguish `SOURCE PASS` from `RUNTIME PASS`.

## 10. Explicit non-scope

- no NPP-F06;
- no Order Core;
- no MCP UI redesign or live-device fix pass;
- no standalone-order rollout from PR #64;
- no production Supabase migration, VPS `pullmcp` or Vercel deploy without explicit approval;
- no changes to `milktea-backend` or port `3002`.
