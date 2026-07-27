# Phase 3 — Source closeout candidate

> Status: final validation candidate in PR #53  
> Production rollout: not authorized

## Candidate scope

This candidate closes the Phase 3 master-data source and ephemeral-rehearsal gate only after all required workflows pass on one exact PR head.

Included:

- customers and customer groups/addresses;
- suppliers, contacts, addresses and payment terms;
- product catalog and canonical SKUs;
- units, exact conversions and barcodes;
- price lists and explainable pricing resolution;
- document numbering;
- forward-only permission catalog alignment;
- independent Packs 1–8 with retained evidence.

Closeout hardening also covers the customer form React event lifecycle: input values are captured before functional state updates so deferred rendering cannot read a cleared synthetic-event target.

## Source acceptance requirement

The exact final head must pass:

- Foundation F0.2;
- Core Foundation and migration rehearsal;
- Core UI and Browser E2E;
- isolated pricing financial verification;
- isolated document-numbering verification;
- Packs 1–6;
- Pack 7 cross-domain integration;
- Pack 8 PostgreSQL 17 grouped migration rehearsal;
- final review with `mcp/** = 0` and no temporary workflow or wrapper files.

## Production blockers retained

Source closeout does not claim production readiness. The following remain required and separate:

- actual Heroku/PostgreSQL provider audit;
- fresh verified production backup;
- restore from that backup to a rehearsal target;
- before/after reconciliation;
- owner decision for blocked pricing rows and the isolated pricing report;
- owner decision on administrator test allocations consuming real immutable document numbers;
- explicit production rollout authorization;
- manual Heroku and guarded Vercel deployment plus smoke verification;
- post-migration backup and confirmation that automatic deployments remain disabled.
