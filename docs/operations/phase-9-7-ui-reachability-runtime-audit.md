# Phase 9.7 — UI reachability + Vercel/DNS/env cutover audit

> Issue: #394  
> Parent: #386  
> NPP source baseline: `main@528218c25328628f5859cde2675943fb781fcdff`  
> Website/Customer source baseline: `main@b6bef8c868b4caa37abcb80355cecaf339e232a0`  
> Customer/Website Phase 9.7 head: `c789bd1336b5c21fbf26583fba9517607fe35f52`

## 1. Source reachability

Phase 9.7 audited all six frontends. Three real NPP Operations reachability defects were fixed in the owning NPP shell:

- `/operations/audit-history`;
- `/operations/import-export-history`;
- `/accounting/customer-return-credits`.

`/operations/*` is also protected by the existing NPP Basic Auth middleware boundary. Intentional deep routes, aliases, auth surfaces and workflow descendants remain classified rather than duplicated in navigation.

Website and Customer Ordering live in `binhnxwjfjxm/nguyenlieuhungphat`; their Phase 9.7 evidence is checked in PR #61 instead of pretending the NPP repository can read external source paths.

## 2. Customer Ordering logo correction

Provider review exposed a false environment contract in the first Phase 9.7 draft. Customer Ordering already renders its company logo from the bundled public asset `/logo-transparent.png`; it does not read an R2 logo URL.

PR #61 exact head `c789bd1336b5c21fbf26583fba9517607fe35f52` therefore removes `NEXT_PUBLIC_CUSTOMER_LOGO_URL` from `.env.example` and the Phase 9.7 test, and locks the local logo asset explicitly. The production Customer Ordering environment contract is now:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`;
- `NEXT_PUBLIC_CUSTOMER_ORDERING_DATA_MODE` (`core` for production);
- `CORE_API_BASE_URL`.

No R2 logo upload is required.

## 3. Provider evidence now verified

The provider evidence gathered during this audit is sufficient for the configuration-state gates:

- all six expected Vercel projects and custom domains are mapped correctly;
- NPP/MCP/Admin roots are available from provider/deployment metadata;
- Delivery root `delivery/web` and Website root `.` were confirmed on the provider surface;
- Customer Ordering root `customer-ordering` is enforced by its guarded production deployment workflow and that provider check has a successful production run;
- Delivery's guarded production workflow enforces `delivery/web`, Auto Deploy OFF and synchronizes its production runtime environment before deploy;
- production environment names were reconciled against the source contracts; owner/provider evidence confirms the missing NPP/Customer names were added;
- MCP `BACKEND_API_BASE_URL` was verified on the provider surface to target the dedicated `hung-phat-mcp` backend;
- Auto Deploy is confirmed OFF for all six Vercel projects;
- Cloudflare DNS for the six production domains already points to Vercel and is currently DNS-only, so no DNS switch is required.

No secret values are stored in repository evidence.

## 4. Production status

Provider configuration state is now ready, but Phase 9.7 is **not yet production-ready/closed** because the Phase 9.7 source changes are still in open PRs and have not been deployed as the final exact merged SHAs.

Current remaining sequence:

1. exact-head CI green for PR #61 and PR #418;
2. explicit owner merge command;
3. verify exact `main` in both repositories;
4. explicit production deploy command for only the affected frontend targets;
5. post-deploy route/static-asset smoke on the canonical production domains;
6. record deployed SHAs and close the 9.7 gate only if those smokes pass.

The current DNS state is already correct, so there is no reason to mutate DNS during this sequence.

## 5. Boundary

This source/audit update does not itself deploy Vercel, change DNS, deploy either Heroku backend, run a database migration or perform the Phase 9.8 final closeout. Source merge and production rollout remain separate explicit operations.

Phase 9.4 (#391) and Phase 9.5 (#392) evidence gates remain independent and unchanged.
