# NPP Platform — Phase 9 Closure & Phase 10 Stabilization Addendum

Status: ACTIVE OWNER ADDENDUM
Effective: 2026-08-08
Baseline: main@12c6c94ed2bc1800d8bbee1e599ce8fdd436856f
Parent Phase 9: #386

## 1. Precedence

This addendum governs the execution order from the end of Phase 9 onward. If an older roadmap conflicts about Phase 9 closure, internal workforce authentication, stabilization, or when advanced work may begin, this addendum takes precedence for those points.

Document section numbers are not phase numbers.

## 2. Locked sequence

```text
finish current Phase 9 blockers
-> Phase 9.9 Internal Workforce Auth Cutover
-> close Phase 9
-> Phase 10 Cross-App Stabilization
-> Phase 11+ advanced work only after Phase 10 passes
```

Do not start advanced product work while a Phase 9 or Phase 10 gate remains open.

## 3. Phase 9.9 — Internal Workforce Auth Cutover

Goal: turn the existing Core user/employee/role/permission foundation into real per-employee authentication and authorization.

Canonical identity chain remains:

```text
shared.users -> employee -> user_roles -> roles -> permissions -> scopes
```

Internal employees remain Core identities. Clerk remains for external Customer Ordering users only.

Required scope:

- real employee login and server-owned session;
- server-side lookup of the canonical active user and employee;
- request actor, roles, permissions and scopes derived from canonical Core data;
- deny by default for zero-role or inactive users;
- backend authorization by permission and scope, never by role name;
- role or status changes take effect according to the session contract;
- logout, expiry and revocation behavior is explicit and tested;
- user actions are audited with the real actor;
- browser clients do not receive server credentials;
- the current shared Basic Auth gate is no longer treated as business identity after cutover;
- existing service-to-service principals stay separate from employee sessions.

Acceptance gate:

1. two internal users authenticate as two different actors;
2. different permissions produce different allow/deny results;
3. zero-role and inactive users fail closed;
4. permission changes work without hardcoded role-name logic;
5. audit records the correct actor;
6. logout/expiry/revocation regressions pass;
7. affected API/web exact-head CI passes;
8. production smoke proves real per-user authorization before Phase 9 closes.

A login screen alone is not enough if backend requests still run as one shared principal.

## 4. Phase 10 — Cross-App Stabilization

Phase 10 begins only after Phase 9 closes. It is a stabilization phase, not a feature phase.

Audit scope:

- Website;
- Customer Ordering;
- NPP Operations;
- MCP Field;
- Admin MCP/NPP;
- Delivery;
- Core backend;
- MCP backend;
- shared PostgreSQL and R2 integrations;
- cross-app contracts.

Defect groups include authentication/session/authorization, permission reachability, routes/navigation, mobile/PWA/desktop behavior, loading/error/retry states, API contracts, idempotency/concurrency, cross-app lineage, three-source Sales Order, inventory, purchasing, logistics, accounting, reporting, MCP, Delivery, Customer Ordering, media, accessibility, performance regressions with evidence, and production-only configuration defects.

Working rule:

- audit and collect defects before mutation;
- identify root cause before creating repeated commits;
- batch fixes with the same root cause where sensible;
- no force-push;
- no rerun loops;
- do not create extra SHAs before the cause is understood;
- if an agent implementation is correct, record it as correct;
- add regression coverage for real fixes where practical;
- production rollout remains a separate explicit operation.

Phase 10 does not automatically include new business modules, advanced accounting, HR/payroll, new automation, route optimization, new approval frameworks, or large redesigns unrelated to a verified defect.

Phase 10 gate:

- no known P0/P1 defects;
- no known authorization bypass or data-integrity defect;
- critical E2E journeys pass;
- auth/permission/route regressions pass;
- cross-app contract smoke passes;
- any remaining P2/P3 items are explicitly accepted as backlog by the owner.

## 5. Phase 11+ — Advanced Product Expansion

Only after Phase 10 passes. Scope is owner-prioritized and decision-locked before implementation. Possible future areas may include HR/attendance/payroll, advanced accounting, approvals, automation, analytics, logistics optimization, or further Customer Ordering/MCP expansion. These examples do not authorize opening a phase or branch.

## 6. Current checkpoint

At creation time:

- Phase 9 remains open;
- Phase 10 has not started;
- owner will provide remaining Clerk production user identification and Cloudflare R2 evidence later;
- no Phase 11+ advanced work is authorized;
- merge, deploy, migration and other production mutations remain separately controlled.
