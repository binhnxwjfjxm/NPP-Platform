# Phase 9.7 — UI reachability + Vercel/DNS/env cutover audit

> Issue: #394  
> Parent: #386  
> NPP baseline: `main@528218c25328628f5859cde2675943fb781fcdff`  
> Website/Customer baseline: `main@b6bef8c868b4caa37abcb80355cecaf339e232a0`  
> Production mutation in this source slice: **NONE**

## 1. Route reachability result

Phase 9.7 audited the six frontends and found **three real NPP Operations reachability defects**. They were fixed in the owning NPP shell rather than relying on cross-app navigation:

- `/operations/audit-history` — previously reachable from Admin Control Tower/direct URL, but had no NPP-owned entry;
- `/operations/import-export-history` — same cross-app-only problem;
- `/accounting/customer-return-credits` — business page existed but had no navigation entry.

The fix adds NPP-owned entries for all three. This respects the Phase 9 boundary that Admin and NPP Operations are independent apps and the normal NPP experience must not depend on switching through Admin.

The remaining audited routes are classified rather than duplicated:

- `/accounting/cod-reconciliation` and `/accounting/reconciliation` are intentional drill-down routes from the existing `COD & đối soát` workspace;
- `/inventory` redirects to `/inventory/balances`;
- legacy `/organization/customers`, `/organization/products`, `/organization/suppliers` routes redirect to their canonical top-level pages;
- `/login` and `/foundation` are auth/internal surfaces, not business navigation items.

Other frontend results:

- **MCP Field**: all primary route entries are present; `/actions` is an alias of `/plans`; `/visits/order-intent` is an intentional deep workflow.
- **Admin MCP/NPP**: `/`, `/customer-onboarding`, `/menu` have entries; `/login` is auth. No Admin redesign was done.
- **Delivery**: `/` owns the assigned-trip list; `/trips/[tripId]` is a valid drill-down; `/login` is auth.
- **Website**: header/footer cover primary public routes; category/product dynamic pages are deep routes.
- **Customer Ordering**: bottom navigation covers primary work; News/Cart have header entries; checkout, success, detail, SSO callback and offline routes are workflow/deep/system routes.

Machine-readable evidence is in `docs/operations/phase-9-7-route-runtime-manifest.json`. The existing Vercel deployment-control regression suite now checks the manifest against source navigation.

## 2. Vercel provider readback

The connected Vercel provider exposed exactly six projects. Latest production deployment metadata observed during the audit was `READY`, target `production`, Git ref `main`, and pointed to the expected owning repository.

| Surface | Project | Deployed SHA at audit | Root evidence |
| --- | --- | --- | --- |
| NPP Operations | `npp-platform` | `efe2069...` | `npp-core/web` — deployment metadata |
| MCP Field | `mcp-field` | `bb163c6...` | `mcp` — deployment metadata |
| Admin MCP/NPP | `admin-mcp-npp` | `efe2069...` | `admin/web` — deployment metadata |
| Delivery | `npp-delivery` | `583b556...` | root field absent in returned metadata |
| Website | `nguyenlieuhungphat` | `e536726...` | root field absent in returned metadata |
| Customer Ordering | `customer-ordering` | `b6bef8c...` | root field absent in returned metadata |

Production SHA drift from current repository `main` is recorded as deployment state, not treated as a source defect. Source merge and production deployment remain separate gates.

Some MCP/Admin/Delivery deployment metadata includes `gitDirty=1`; this is recorded as provider evidence only and is not automatically interpreted as a source defect.

## 3. Env/backend source contract

Only variable **names** are recorded; no secret values are written to source evidence.

For MCP Field the server/build contract requires:

- `BACKEND_API_BASE_URL`;
- `BACKEND_API_TOKEN`;
- `MCP_LEGACY_ACTOR_ID`.

`BACKEND_API_BASE_URL` remains server-owned; there is no browser `NEXT_PUBLIC_BACKEND_API_BASE_URL`. The architecture target is the MCP backend `hung-phat-mcp`.

The current Vercel connector cannot read the production env-name/value set, so this source slice does **not** claim that the production `BACKEND_API_BASE_URL` value has been verified against `hung-phat-mcp`.

## 4. Provider evidence still unavailable

The current connector does not expose enough readback for:

- Vercel environment-variable names/values;
- custom-domain assignments;
- Auto Deploy project setting;
- root directory for Delivery, Website and Customer Ordering when deployment metadata omits it;
- DNS records;
- production value of MCP `BACKEND_API_BASE_URL`.

Expected domains from the active topology remain configuration targets, not substitutes for provider readback.

## 5. Current gate

- Source route reachability after the three NPP fixes: **PASS**.
- Project identity + repository + production branch from deployment metadata: **PASS**.
- Root-directory provider evidence: **PARTIAL**.
- Env-name presence: **NOT VERIFIED**.
- Custom-domain assignment: **NOT VERIFIED**.
- Auto Deploy provider setting: **NOT VERIFIED**.
- MCP API-base production value: **NOT VERIFIED**.
- DNS/env switch: **NOT PERFORMED**.

Therefore this source PR must **not** be called Phase 9.7 production-ready/closed. A separate explicitly authorized operation must obtain the missing provider readback, perform only the necessary env/domain/DNS changes, and smoke the affected frontends.

No Vercel deploy, env/domain/DNS mutation, backend deploy, database migration or final data closeout is performed here. Final production closeout remains #395.
