# Phase 6A — Owner Approval Record

> Status: **LOCKED**  
> Date: `2026-07-31`  
> Issue: `#116`  
> Decision document: `docs/operations/phase-6a-owner-decision-gate.md`  
> Authorized next phase: **Phase 6B — Sales Order Foundation**

## Approval

The owner explicitly directed the project to proceed with Phase 6B after reviewing and correcting the Phase 6A business decisions.

This approval record supersedes the `PROPOSED — OWNER APPROVAL REQUIRED` marker in the decision document. The decision document and the owner corrections recorded in PR #117 are the locked implementation baseline.

## Frontend/runtime boundary locked with this approval

```text
NPP-Platform repository / Vercel
├── MCP frontend project
├── NPP operations frontend project
├── Admin MCP/NPP frontend project
└── Delivery frontend project

Separate website repository / Vercel
└── Public website + customer-ordering frontend project
```

Runtime remains:

```text
2 backend services: MCP API + Core API
1 PostgreSQL cluster with domain schemas
```

Rules:

- NPP creates and manages internal employees, users, roles, permissions and scopes;
- Admin is a read-mostly owner/management control tower with a small approval surface and no separate backend;
- Delivery is a small PWA using Core API and has no separate backend;
- customer ordering stays with the website project and uses Core API;
- no frontend connects directly to PostgreSQL;
- MCP API writes MCP-owned data only;
- Core API owns official customer, order, inventory, logistics and accounting facts.

## Explicitly deferred

The following are not decided and must not be implemented in Phase 6B:

```text
Clerk versus Core-owned customer authentication
customer self-registration identity matching
linking self-registered accounts to Core customers
assignment of new website customers/orders to sales employees
personal-sales attribution for website orders
```

Phase 6B may preserve generic source extension points, but it must not infer these customer-portal rules.

## Production boundary

This approval authorizes source work only. It does not authorize production deployment, production migration, database mutation, DNS changes, provider changes or customer-portal rollout.
