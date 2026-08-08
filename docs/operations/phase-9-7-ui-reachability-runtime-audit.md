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

The Website and Customer Ordering live in the separate repository `binhnxwjfjxm/nguyenlieuhungphat`. Their route evidence is therefore pinned to the exact external `main` commit and tree recorded in the manifest instead of pretending the NPP-Platform CI can read those source files locally.

Machine-readable evidence is in `docs/operations/phase-9-7-route-runtime-manifest.json`. The Vercel deployment-control regression suite checks the four in-repo frontend navigation sources directly and checks the two external frontends against the pinned external GitHub baseline.

## 2. Vercel provider readback

The connected Vercel provider exposed exactly six projects. Current project metadata also exposes assigned domains, so custom-domain assignment is directly verifiable and is **not** an unresolved capability.

All six expected production domains are currently assigned to the intended Vercel projects:

| Surface | Project | Expected production domain | Domain assignment |
| --- | --- | --- | --- |
| NPP Operations | `npp-platform` | `office.nguyenlieuhungphat.com` | VERIFIED |
| MCP Field | `mcp-field` | `mcp.nguyenlieuhungphat.com` | VERIFIED |
| Admin MCP/NPP | `admin-mcp-npp` | `admin.nguyenlieuhungphat.com` | VERIFIED |
| Delivery | `npp-delivery` | `log.nguyenlieuhungphat.com` | VERIFIED |
| Website | `nguyenlieuhungphat` | `nguyenlieuhungphat.com` | VERIFIED |
| Customer Ordering | `customer-ordering` | `sales.nguyenlieuhungphat.com` | VERIFIED |

Latest production deployment metadata observed during the audit is `READY`, target `production`, Git ref `main`, and points to the expected owning repository. Customer Ordering received a later production deployment of the same audited external `main` commit while this audit was running; the manifest records the newer deployment ID instead of treating parallel deployment activity as a source defect.

Production SHA drift from current repository `main` is recorded as deployment state, not treated as a source defect. Source merge and production deployment remain separate gates.

Some MCP/Admin/Delivery deployment metadata includes `gitDirty=1`; this is provider evidence only and is not automatically interpreted as a source defect.

## 3. Env/backend source contract

Only variable **names** are recorded; no secret values are written to source evidence.

For MCP Field the server/build contract requires:

- `BACKEND_API_BASE_URL`;
- `BACKEND_API_TOKEN`;
- `MCP_LEGACY_ACTOR_ID`.

`BACKEND_API_BASE_URL` remains server-owned; there is no browser `NEXT_PUBLIC_BACKEND_API_BASE_URL`. The architecture target is the MCP backend `hung-phat-mcp`.

The current Vercel connector does not expose the production env-name/value set, so this source slice does **not** claim that the production `BACKEND_API_BASE_URL` value has been verified against `hung-phat-mcp`.

## 4. Provider evidence still unavailable

The current connector still does not expose enough readback for:

- Vercel environment-variable names/values;
- Auto Deploy project setting;
- root directory for Delivery, Website and Customer Ordering when deployment metadata omits it;
- DNS records;
- production value of MCP `BACKEND_API_BASE_URL`.

Custom-domain assignment is no longer on this list because project metadata exposes the assigned domains and all six expected domains were verified.

## 5. Review hardening

The Phase 9.7 regression suite now:

- locks the exact six frontend identities instead of checking only uniqueness/count;
- validates the parsed manifest so sensitive values/secret-like fields cannot be smuggled into audit evidence outside the explicit env-name list;
- records the two external-repository frontends as external GitHub audit evidence tied to an exact commit/tree;
- recursively scans MCP frontend source/build configuration and fails if `NEXT_PUBLIC_BACKEND_API_BASE_URL` appears anywhere in the production source/config surface.

The external-repository CI suggestion to read Website/Customer source files directly from NPP-Platform is intentionally not implemented because those files do not exist in this repository. The exact external commit/tree is the correct source boundary.

## 6. Current gate

- Source route reachability after the three NPP fixes: **PASS**.
- Project identity + repository + production branch from deployment metadata: **PASS**.
- Custom-domain assignment: **PASS**.
- Root-directory provider evidence: **PARTIAL**.
- Env-name presence: **NOT VERIFIED**.
- Auto Deploy provider setting: **NOT VERIFIED**.
- MCP API-base production value: **NOT VERIFIED**.
- DNS/env switch: **NOT PERFORMED**.

Therefore this PR must still **not** be called Phase 9.7 production-ready/closed. Remaining provider/env/DNS evidence must be obtained from a connector or provider surface that can actually read it, then only the necessary changes should be made and smoke-tested.

No Vercel deploy, env/domain/DNS mutation, backend deploy, database migration or final data closeout is performed by this source PR. Final production closeout remains #395.
