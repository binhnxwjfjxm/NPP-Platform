# Master Plan Addendum — Frontend and Runtime Topology

> Status: **ACTIVE — OWNER LOCKED**  
> Original date: `2026-07-31`  
> Phase 9.0 topology refresh: `2026-08-08`  
> Applies to: `NPP_PLATFORM_MASTER_PLAN.md`

This addendum is the active frontend/runtime topology. Where the older Master Plan or the original version of this addendum conflicts with the verified Phase 9 topology, this file and the Phase 9 decision sources take precedence.

## 1. Frontend projects

The installation has **six independent Vercel frontend projects** across two GitHub repositories.

```text
Repository: binhnxwjfjxm/NPP-Platform
├── MCP Field                         source: mcp/**
├── NPP Operations                    source: npp-core/web/**
├── Admin MCP/NPP                     source: admin/web/**
└── Delivery                          source: delivery/web/**

Repository: binhnxwjfjxm/nguyenlieuhungphat
├── Public Website                    source: website/root app
└── Customer Ordering                 source: customer-ordering/**
```

Website and Customer Ordering share a repository but are **separate Vercel projects and separate deployment units**. Customer Ordering is not a route group inside the Website deployment.

Live Vercel project/domain readback during Phase 9.0 observed:

| Surface | Project | Production domain |
| --- | --- | --- |
| Website | `nguyenlieuhungphat` | `nguyenlieuhungphat.com` |
| Customer Ordering | `customer-ordering` | `sales.nguyenlieuhungphat.com` |
| NPP Operations | `npp-platform` | `office.nguyenlieuhungphat.com` |
| MCP Field | `mcp-field` | `mcp.nguyenlieuhungphat.com` |
| Admin MCP/NPP | `admin-mcp-npp` | `admin.nguyenlieuhungphat.com` |
| Delivery | `npp-delivery` | `log.nguyenlieuhungphat.com` |

The current provider read tool does not expose root-directory or environment-variable values. Those values must be read back from the provider before any 9.7 mutation; do not infer them from this source map.

### MCP Field

Mobile/PWA for field employees: routes, outlets, visits/check-in, media, surveys/reports, route/session work and canonical Core integrations permitted by scope. It keeps its own mobile UX and backend boundary.

### NPP Operations

Internal operations surface for identity/access, master data, sales, purchasing, inventory, logistics, accounting and reporting. Core remains authoritative for internal identity, permissions/scopes and canonical business lifecycles.

### Admin MCP/NPP

Independent owner/management surface for summary, exceptions and limited approval/review flows. It does not duplicate the full NPP CRUD application. Admin and NPP Operations are separate apps; cross-app navigation is not an architecture dependency.

### Delivery

Mobile/PWA for assigned trips/stops, dispatch handover, POD, actual delivery, failure/partial flows and permitted COD collection/handover work. It uses Core APIs rather than a separate Delivery business backend.

### Website

Public website/content/catalog experience in `binhnxwjfjxm/nguyenlieuhungphat`.

### Customer Ordering

External customer PWA in `customer-ordering/**`. Clerk authenticates external identity; Core will own customer/account membership and canonical catalog/order business authority. The current mock/local order adapter is replaced in Phase 9.2 through a server-side Customer Portal boundary; no Core server secret goes to the browser.

## 2. Backend services

Frontend count does not change backend ownership:

```text
Core API   -> Core-owned canonical business domains
MCP API    -> MCP field domain + canonical Core integration
```

Core and MCP deploy/release/smoke/rollback independently. Admin, Delivery, Website and Customer Ordering do not gain independent business authorities merely because they are separate frontends.

## 3. Database

The target remains one PostgreSQL installation shared by domain schemas. No frontend connects directly to PostgreSQL.

Actual production DB attachment/credential/role capability must be audited from provider truth before Phase 9.3 mutation; documentation must not claim least privilege that the provider/tier has not verified.

## 4. Deployment boundary

Each of the six frontend projects is an independent deployment unit with its own project configuration, domain and environment boundary. Source merge does not imply production deployment.

Provider rules remain:

- Vercel Auto Deploy must remain OFF;
- Core and MCP Heroku automatic deploy remain OFF;
- frontend-only changes do not authorize backend deployment;
- production mutation requires an explicit owner command.

## 5. Current architecture summary

```text
6 Vercel frontend projects
2 backend services
1 shared PostgreSQL installation
2 GitHub repositories
```

Detailed Phase 9.0 evidence and unresolved provider gates are recorded in `docs/operations/phase-9-0-readiness-audit.md`.
