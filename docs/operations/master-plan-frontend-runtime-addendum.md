# Master Plan Addendum — Frontend and Runtime Topology

> Status: **ACTIVE — OWNER LOCKED**  
> Original date: `2026-07-31`  
> Phase 9.0 topology refresh: `2026-08-08`  
> Retail topology refresh: `2026-08-20`  
> Retail printer-shell addendum: `2026-08-28`  
> Applies to: `NPP_PLATFORM_MASTER_PLAN.md`

This addendum is the active frontend/runtime topology. Where the older Master Plan or the original version of this addendum conflicts with the verified topology below, this file and the later owner-locked decision sources take precedence.

## 1. Frontend projects

The installation has **seven independent Vercel frontend projects** across two GitHub repositories.

```text
Repository: binhnxwjfjxm/NPP-Platform
├── MCP Field                         source: mcp/**
├── NPP Operations                    source: npp-core/web/**
├── Admin MCP/NPP                     source: admin/web/**
├── Delivery                          source: delivery/web/**
└── Retail PWA                        source: retail/web/**

Repository: binhnxwjfjxm/nguyenlieuhungphat
├── Public Website                    source: website/root app
└── Customer Ordering                 source: customer-ordering/**
```

Website and Customer Ordering share a repository but are **separate Vercel projects and separate deployment units**. Customer Ordering is not a route group inside the Website deployment.

Current project/domain map after the Retail Lô 0 runtime decision:

| Surface | Project | Production domain |
| --- | --- | --- |
| Website | `nguyenlieuhungphat` | `nguyenlieuhungphat.com` |
| Customer Ordering | `customer-ordering` | `sales.nguyenlieuhungphat.com` |
| NPP Operations | `npp-platform` | `office.nguyenlieuhungphat.com` |
| MCP Field | `mcp-field` | `mcp.nguyenlieuhungphat.com` |
| Admin MCP/NPP | `admin-mcp-npp` | `admin.nguyenlieuhungphat.com` |
| Delivery | `npp-delivery` | `log.nguyenlieuhungphat.com` |
| Retail PWA | `npp-retail` | `retail.nguyenlieuhungphat.com` |

Provider state must still be read back before each mutation. Source documentation never substitutes for provider truth.

### MCP Field

Mobile/PWA for field employees: routes, outlets, visits/check-in, media, surveys/reports, route/session work and canonical Công Ty integrations permitted by scope. It keeps its own mobile UX and backend boundary.

### NPP Operations

Internal operations surface for identity/access, master data, sales, purchasing, inventory, logistics, accounting and reporting. The Công Ty backend remains authoritative for internal identity, permissions/scopes and canonical business lifecycles.

### Admin MCP/NPP

Independent owner/management surface for summary, exceptions and limited approval/review flows. It does not duplicate the full NPP CRUD application. Admin and NPP Operations are separate apps; cross-app navigation is not an architecture dependency.

### Delivery

Mobile/PWA for assigned trips/stops, dispatch handover, POD, actual delivery, failure/partial flows and permitted COD collection/handover work. It uses Công Ty APIs rather than a separate Delivery business backend.

### Retail PWA

Mobile-first counter-sales surface. Retail has no business backend, database, inventory ledger, receivable ledger or report store of its own. It calls the Công Ty API through server-side routes and uses canonical product, price, order, inventory, payment and receivable facts. Auto Deploy is locked OFF; source merge and production deployment remain separate operations.

Retail may additionally be distributed inside a thin **device shell** under `retail/mobile/**` when a device-only capability cannot be provided safely by a browser/PWA. The first approved capability is local Wi‑Fi/LAN printing on iOS. This shell:

- loads the same `retail.nguyenlieuhungphat.com` Retail UI;
- exposes only a local printer bridge to the WebView;
- may discover/connect/send jobs to printers on the same LAN;
- stores printer profile/preferences on the device only;
- does **not** create a new business frontend, backend, database, order authority, inventory authority or payment authority;
- does not proxy LAN printer traffic through Vercel or Heroku.

The native shell is a separate **mobile distribution artifact**, not an eighth Vercel project. App Store/TestFlight signing/release is an explicit production operation and is not implied by merging source.

### Website

Public website/content/catalog experience in `binhnxwjfjxm/nguyenlieuhungphat`.

### Customer Ordering

External customer PWA in `customer-ordering/**`. Clerk authenticates external identity; the Công Ty backend owns customer/account membership and canonical catalog/order business authority. No server secret goes to the browser.

## 2. Backend services

Frontend count does not change backend ownership:

```text
Công Ty API -> canonical business domains
MCP API     -> MCP field domain + canonical Công Ty integration
```

The Công Ty and MCP backends deploy/release/smoke/rollback independently. Admin, Delivery, Retail, Website and Customer Ordering do not gain independent business authorities merely because they are separate frontends.

Device-only Retail printer code is not a backend service and must not be used to execute business mutations outside the normal Retail/Công Ty API boundary.

## 3. Database

The target remains one PostgreSQL installation shared by domain schemas. No frontend connects directly to PostgreSQL.

Actual production DB attachment/credential/role capability must be audited from provider truth before database mutation; documentation must not claim least privilege that the provider/tier has not verified.

Printer profiles, local IP addresses and print preferences are device-local presentation settings and do not require a PostgreSQL schema.

## 4. Deployment boundary

Each of the seven frontend projects is an independent deployment unit with its own project configuration, domain and environment boundary. Source merge does not imply production deployment.

Provider rules remain:

- Vercel Auto Deploy must remain OFF;
- Công Ty and MCP Heroku automatic deploy remain OFF;
- frontend-only changes do not authorize backend deployment;
- production mutation requires an explicit owner command;
- Retail production deploy uses its own exact manual command and never piggybacks another frontend deployment;
- Retail iOS signing/TestFlight/App Store rollout is separate from Vercel Retail deployment and requires its own explicit owner command and device smoke test.

## 5. Current architecture summary

```text
7 Vercel frontend projects
2 backend services
1 shared PostgreSQL installation
2 GitHub repositories
+ optional Retail device shell for device-only capabilities (not a business service)
```

Detailed Phase 9.0 evidence and unresolved provider gates remain recorded in `docs/operations/phase-9-0-readiness-audit.md`. Retail execution and regression gates are tracked in Issue #675; direct printer work is tracked in Issue #810.
