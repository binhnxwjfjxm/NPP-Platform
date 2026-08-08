# Phase 9.0 — Decision lock & readiness audit

Parent: #386  
Canonical task: #387  
Handoff: #397  
Audit date: 2026-08-08

## 1. Gate decision

Phase 9.0 locks the evidence and mutation boundaries for later Phase 9 slices. It does **not** authorize production deploy, migration, provider switch, import or cutover.

Audit baseline at branch creation:

- repo: `binhnxwjfjxm/NPP-Platform`
- exact `main`: `bb163c6629f5fb212ebe4a2292fb1903dc4b80f3`
- Phase 9.0 branch: `agent/phase-9-0-decision-lock`
- open PR at branch creation: #234 only; it is an independent UI task and is not absorbed by Phase 9.0
- no Phase 9.0 branch existed before this branch was created

Source precedence for this audit:

1. repository source at the exact SHA and live provider readback available to the audit;
2. owner decisions in #386/#387/#397 and the merged Phase 9 plan;
3. the frontend runtime addendum after the corrections in this slice;
4. older Master Plan wording only as roadmap context.

A provider fact that the available read API does not expose is marked **UNVERIFIED / PRE-MUTATION GATE** rather than inferred.

## 2. Runtime / ownership map

### Frontend projects

Live Vercel project listing confirms six distinct projects:

| Surface | Vercel project | Source ownership | Observed production domain | Status in 9.0 |
| --- | --- | --- | --- | --- |
| Website | `nguyenlieuhungphat` | `binhnxwjfjxm/nguyenlieuhungphat`, website app | `nguyenlieuhungphat.com` | project/domain observed |
| Customer Ordering | `customer-ordering` | `binhnxwjfjxm/nguyenlieuhungphat/customer-ordering/**` | `sales.nguyenlieuhungphat.com` | project/domain observed |
| NPP Operations | `npp-platform` | `npp-core/web/**` | `office.nguyenlieuhungphat.com` | project/domain observed |
| MCP Field | `mcp-field` | `mcp/**` frontend | `mcp.nguyenlieuhungphat.com` | project/domain observed |
| Admin MCP/NPP | `admin-mcp-npp` | `admin/web/**` | `admin.nguyenlieuhungphat.com` | project/domain observed |
| Delivery | `npp-delivery` | `delivery/web/**` | `log.nguyenlieuhungphat.com` | project/domain observed |

The Vercel read surface used in this audit returns project identity, domains and latest deployment state, but does not expose root-directory or environment-variable values. Therefore root-directory/env **provider readback** remains a hard pre-mutation check in 9.7. Source roots above are repository ownership facts, not a claim that hidden provider configuration was read.

No Vercel project was created or changed in 9.0.

### Backend and database ownership

Locked architecture:

- Core backend owns canonical internal identity, customer, Sales Order, inventory, logistics, accounting and shared business contracts.
- MCP backend owns MCP field runtime and MCP-owned field data, and integrates to Core through canonical contracts.
- Core and MCP are separate deploy/release/smoke/rollback units.
- One PostgreSQL installation is shared across domain schemas.

Live Heroku release/config/attachment/DB-role state is **UNVERIFIED / PRE-MUTATION GATE** in this connector session. Phase 9.3 must read provider truth before changing runtime or credentials; this audit does not substitute documentation for that provider check.

## 3. Identity decision lock

| Actor | Authentication/identity | Business authorization owner | Decision |
| --- | --- | --- | --- |
| Internal employee | Core internal user/employee identity | Core roles + permissions + scope | keep internal; do not move to Clerk |
| External customer | Clerk identity in Customer Ordering | Core customer/account membership + business permissions | Clerk authenticates identity only |

No browser is allowed to receive a Core server secret.

## 4. Role / permission evidence

Current backend source uses `npp-core/api/src/access/permissions.js` as the permission registry and keeps deny-by-default authorization semantics.

Current frontend role workspace has a fixed presentation grouping (`SALES`, `INVENTORY`, `PURCHASE`, `ACCOUNTING`, `EMPLOYEE`, `MASTER_DATA`, `OUTLET`, `REPORTING`, `ADMIN`, `PLATFORM`) while the backend registry covers a broader set of concrete route/action permissions across sales, purchasing, inventory, logistics, reporting, access and accounting capabilities.

Decision lock:

- role names are business configuration, not authorization semantics;
- owner/admin may create a role and choose its actual permission set;
- presets/templates are suggestions only and their proposed permissions may be added/removed before save;
- permitted role edits remain possible after creation;
- backend authorizes permission + scope, never role-name inference;
- 9.1 must reconcile backend registry -> route/action use -> admin UI grouping and classify every mismatch.

The older Phase 2 review checklist remains historical evidence only. Any reading that makes immutable built-in role templates the Phase 9 target is superseded by #386.

## 5. One Sales Order lifecycle, three intake sources

Canonical ownership is locked to Core Sales Order.

| Intake | Current evidence | Phase 9 action |
| --- | --- | --- |
| Internal / NPP Operations | Core owns canonical Sales Order lifecycle | keep canonical owner |
| MCP Field | MCP contract already creates Core Sales Order with `sourceType: MCP`, scoped principal and idempotency | preserve contract; verify end-to-end during cutover |
| Customer Ordering | Clerk-backed frontend exists, but ordering service still uses mock/local adapter and is not wired to Core API | 9.2 adds Customer Portal server boundary and canonical Core intake |

The NPP Sales Order source tabs (`Tất cả / Nội bộ / MCP / Khách hàng`) are a future filter over the same lifecycle, not three order stores.

## 6. MCP legacy dependency map

### Persistence

`mcp/apps/backend/foundation/provider-cutover.js` locks canonical production persistence to PostgreSQL and rejects Supabase as the production persistence provider.

### Media

Current outlet/profile media is hybrid:

- binary object read/write/delete is implemented through the R2/S3-compatible client;
- canonical object key namespace is `mcp-plan/outlets/<installationId>/<routeCustomerId>/...`;
- profile metadata and delete coordination still call Supabase RPCs.

Therefore R2 object storage being present does **not** mean Supabase is already removable from MCP production. 9.4/9.6 must inventory the legacy metadata/object state, reconcile counts/checksums and remove the remaining adapter dependency only after verification.

Live legacy Supabase/VPS data state and live R2 object counts/checksums are **UNVERIFIED / PRE-MUTATION GATES**. No object was copied, deleted or switched in 9.0.

## 7. Route / navigation inventory

This slice performs a source-level reachability inventory only. It does not redesign UI or overwrite PR #234.

### NPP Operations

`npp-core/web/app/components/app-shell-core.tsx` currently exposes the major operational groups and concrete routes for organization/master data, access, inventory, logistics, sales, purchasing and accounting. Examples include `/access/roles`, `/access/employees/performance`, `/sales/sales-orders`, `/management`, `/inventory/stocktakes`, `/inventory/adjustments`, `/logistics/trips`, `/purchasing/purchase-orders`, `/accounting/cod-reporting` and reporting routes.

9.7 must generate the full route manifest and machine-check page routes against navigation/deep-link classification. 9.0 does not change the shell because #234 is an active UI-only PR.

### MCP Field

Top-level source routes include `/`, `/mcp`, `/routes`, `/visits`, `/mcp/sessions`, `/customers`, `/orders`, `/reports`, `/field-checks`, `/plans`, `/mcp-setting` and `/settings`. Navigation maps these surfaces; known deeper routes such as `/mcp/settings`, `/mcp-setting/groups` and `/visits/order-intent` resolve through parent/prefix navigation. `/actions` is normalized to the plans surface.

No obvious orphan top-level business route was found in this source snapshot.

### Admin MCP/NPP

Source routes are `/`, `/customer-onboarding`, `/menu` plus `/login`. `admin-shell.tsx` links the three business surfaces; `/login` is an intentional auth route. The existing external link toward NPP Operations is recorded as architecture debt against the owner decision that Admin and NPP Operations are independent apps; 9.0 does not redesign it.

### Delivery

Source routes are `/`, `/trips/[tripId]` plus `/login`. The trip detail is reached from the home/trip list and has an explicit back path; COD/POD/attempt flows live under that trip context. `/login` is intentional auth.

No obvious orphan top-level business route was found in this source snapshot.

### Website

Public website source contains top-level content/catalog routes such as `/`, `/gioi-thieu`, `/lien-he`, `/nganh-hang`, `/san-pham`, `/tuyen-dung`, `/chinh-sach-bao-mat` and dynamic category/product detail routes. Full automatic route/nav reconciliation remains a 9.7 gate.

### Customer Ordering

Top-level routes include `/`, `/products`, `/quick-order`, `/orders`, `/account`, `/cart`, `/checkout`, `/news`, with intentional auth/system routes such as `/login`, SSO callback, `/offline` and deep detail/success routes. Bottom navigation directly exposes Home, Products, Quick Order, Orders and Account; cart/checkout/detail/success are flow/deep routes rather than required top-level nav items.

## 8. Export / import / canonical ID dependency order

No import is permitted before this order is satisfied:

1. immutable legacy export manifest;
2. source row/object counts and checksums;
3. canonical old -> new ID map;
4. collision, duplicate and unmapped report;
5. owner decision for any remaining mapping ambiguity;
6. dependency-ordered idempotent import;
7. FK/lineage verification;
8. count/hash/business reconciliation;
9. adapter switch only after canonical data is verified;
10. legacy retained only as rollback/archive evidence, not a second authority.

## 9. Production cutover / rollback matrix

| Area | Before mutation | Verification | Rollback / forward-fix boundary |
| --- | --- | --- | --- |
| Shared PostgreSQL | fresh installation-wide backup + restore rehearsal + pre-counts | migration registry, no-op rerun, post-count/business reconciliation | DB forward-fix by migration; restore only by explicit runbook decision |
| Core backend | exact source/release/config-name audit | `/health/live`, `/health/ready` + business smoke | Core release rollback independent of MCP |
| MCP backend | exact source/release/config-name + DB attachment audit | MCP health + PostgreSQL/Core adapter smoke | MCP release rollback independent of Core |
| MCP media/R2 | source/object manifest + checksum/count | upload/read/delete + historical media | keep legacy pointer until reconciliation passes |
| Vercel frontends | project/repo/root/branch/domain/env/Auto Deploy readback | route/deep-link/API-base smoke per affected app | rollback each frontend independently |
| Customer Ordering intake | Clerk/Core membership + server boundary + idempotency | create/read canonical Sales Order, retry no duplicate, cross-account deny | switch intake adapter/server boundary without creating second lifecycle |

Production mutation sequence remains:

`provider audit -> fresh backup -> restore rehearsal -> pre reconciliation -> migrate/import/switch -> rerun/verify -> post reconciliation -> smoke -> closeout`

## 10. Known gaps assigned to later slices

- **9.1:** permission registry/route/action/UI reconciliation; configurable role preset behavior; Employee/MCP performance tab structure.
- **9.2:** Customer Ordering server boundary, Clerk-to-Core membership and canonical Sales Order intake; source filter in NPP Sales Order UI.
- **9.3:** live MCP Heroku source/release/config-name, PostgreSQL attachment and actual DB credential/role capability.
- **9.4:** live R2 + legacy media inventory, manifest/checksum/count, adapter switch and rollback pointer.
- **9.5:** immutable export + canonical ID mapping and ambiguity report.
- **9.6:** idempotent import, remaining legacy adapter replacement and dual verification without dual authority.
- **9.7:** generated route manifest; orphan classification/fix; Vercel repo/root/branch/domain/env/Auto Deploy and DNS/API-base provider readback before any switch.
- **9.8:** final production backup/rehearsal/migration/deploy/cutover only after explicit owner command.

## 11. Phase 9.0 acceptance mapping

- architecture/runtime topology: **LOCKED at source/ownership level; live Heroku details explicitly gated**
- role/permission gaps: **LOCKED**
- identity boundary: **LOCKED**
- three-source order boundary: **LOCKED**
- legacy dependency inventory: **LOCKED at adapter/source level; live legacy data gated**
- R2/media state: **HYBRID STATE IDENTIFIED; live object inventory gated**
- route/navigation inventory for six frontends: **SOURCE SNAPSHOT COMPLETED; generated exhaustive gate assigned to 9.7**
- Vercel project/domain presence: **LIVE READBACK COMPLETED for six projects; root/env values not exposed by current read tool and remain pre-mutation gates**
- export/import/ID mapping dependency: **LOCKED**
- cutover/rollback matrix: **LOCKED**
- unresolved provider facts: **LISTED AS HARD GATES, NOT ASSUMED**

### Phase 9.0 result

**READY TO CLOSE 9.0 SOURCE AUDIT AND PROCEED TO 9.1 SOURCE WORK.**

This does **not** mean production is ready for cutover. No production deploy, database migration, import, DNS/env mutation, R2 mutation or provider switch was performed in Phase 9.0.
