# Master Plan Addendum — Frontend and Runtime Topology

> Status: **ACTIVE — OWNER LOCKED**  
> Date: `2026-07-31`  
> Applies to: `NPP_PLATFORM_MASTER_PLAN.md`  
> Related approval: `docs/operations/phase-6a-owner-approval.md`

This addendum updates the active Master Plan frontend/runtime topology. Where the Master Plan still says “two frontend” or lists only MCP and NPP Vercel projects, this addendum takes precedence until the next full Master Plan consolidation.

## 1. Frontend projects

The installation has five Vercel frontend projects across two GitHub repositories.

```text
Repository: binhnxwjfjxm/NPP-Platform
├── MCP frontend
├── NPP operations frontend
├── Admin MCP/NPP frontend
└── Delivery frontend

Separate website repository in the same GitHub account/organization
└── Public website + customer-ordering frontend
```

### MCP frontend

Mobile/PWA for field employees:

```text
field routes
field outlets
visits/check-in
GPS and field media
surveys/tests/reports
onboarding drafts and Core references
read-only Core order/delivery projections according to permission
```

It keeps the existing correct MCP mobile UX and does not reuse the NPP desktop AppShell.

### NPP operations frontend

The full internal operations application currently under development:

```text
internal users, employees, roles and permissions
customers and suppliers
products, pricing and numbering
purchasing and payable operations
sales operations
inventory and warehouse operations
logistics/dispatch management
accounting operations and reporting
```

It is desktop-first but remains responsive. It is the authoritative management surface for internal identities and scopes.

### Admin MCP/NPP frontend

A responsive owner/management control tower for desktop and mobile:

```text
combined operational totals and states
warnings and exceptions
MCP/NPP/delivery monitoring
small permissioned approval surface
management reports and drill-down links
```

It must not duplicate the full NPP CRUD application. It has no separate backend and uses controlled Core reporting/approval APIs.

### Delivery frontend

A small mobile/PWA for warehouse handover and drivers:

```text
assigned trips and stops
handover/dispatch checklist
receiver and POD
actual delivered quantities
collection state
failed/partial/rescheduled delivery
cash-handover status where permitted
```

It has no separate backend and uses Core Logistics/Accounting APIs.

### Website + customer ordering frontend

The existing public website remains in its separate repository. Customer ordering is added to the same website Vercel project and calls Core APIs.

Customer authentication, self-registration matching, sales-owner assignment and personal-sales attribution are deferred decisions and are not part of Phase 6B.

## 2. Backend services

Frontend project count does not change backend ownership.

```text
MCP API
NPP Core API
```

- MCP API writes MCP-owned field data only.
- Core API owns internal identity/authorization, official customers, Sales Orders, inventory, logistics and accounting.
- Admin, Delivery and customer ordering do not get independent business backends.
- Cross-domain calls use canonical APIs and idempotent event/outbox contracts.

## 3. Database

The installation continues to use one PostgreSQL cluster with domain schemas:

```text
shared
mcp
sales
purchasing
inventory
logistics
accounting
reporting
```

No frontend connects directly to PostgreSQL. Service DB roles remain schema-restricted.

## 4. Deployment boundary

Each frontend project has its own build/root configuration, environment allowlist, domain and manual production rollout control. Connecting the same monorepo to multiple Vercel projects does not authorize automatic deployment.

The website repository and NPP-Platform repository deploy independently. Source merge never implies provider deployment.

## 5. Current architecture summary

```text
5 Vercel frontend projects
2 backend services
1 PostgreSQL cluster
2 GitHub repositories
```
