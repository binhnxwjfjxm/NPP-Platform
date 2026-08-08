# Phase 9.4 — MCP R2 media migration and reconciliation

Parent: #386  
Task: #391

## Locked source truth

Phase 9.4 does not replace the current production media adapter. Production persistence already routes media metadata/lifecycle to PostgreSQL when `PERSISTENCE_PROVIDER=postgresql`, and direct legacy provider HTTP is rejected. New media already uses the canonical object-key namespace:

`mcp-plan/outlets/<installationId>/<routeCustomerId>/<mediaId>.<ext>`

The historical Supabase media contract generated the same key namespace. Therefore object copying must not be assumed. It is required only when provider audit proves a real reconciliation gap.

## Source slice

This slice adds a read-only production audit that:

1. reads MCP Heroku config names/values inside the protected Action job without publishing them;
2. requires the current PostgreSQL + R2 runtime contract;
3. reads `mcp.mcp_outlet_media` inside `BEGIN READ ONLY`;
4. lists only the current installation canonical R2 prefix;
5. reconciles stable `ready` media against R2 key, size, ETag and a full-object SHA-256 read;
6. reports stable missing/noncanonical/orphan/deleted/stale lifecycle debt;
7. reads R2 lifecycle configuration and rejects enabled automatic expiration overlapping the canonical prefix;
8. publishes only counts, booleans and SHA-256 manifest digests to Issue #391.

A five-minute stability window excludes in-flight uploads from failure classification. Full historical reads are capped at 512 MiB per audit run; exceeding the cap fails closed rather than silently weakening checksum coverage.

## Commands and mutation boundary

The only production command introduced by this source slice is:

`/audit-mcp-r2-media`

It is read-only. It has no path to PUT, DELETE, COPY, deploy, migration, Heroku config mutation or database write.

No production copy/switch command is created before provider evidence exists. After the audit:

- if `MCP_MEDIA_COPY_REQUIRED=false` and `MCP_MEDIA_RECONCILIATION_READY=true`, no object migration is needed;
- if copy is required, the exact missing/noncanonical class must be understood first, then a separate guarded migration source change and explicit owner production-mutation command are required;
- cleanup-only debt (orphan/deleted/stale lifecycle rows) is not mislabeled as object-copy work.

## Gate

Phase 9.4 can close only when provider evidence proves:

- runtime R2 is configured;
- all stable ready media have canonical keys and are readable;
- key/size/ETag/content checksum reconciliation passes;
- no stable orphan or deleted-but-present object remains;
- no stale nonterminal media lifecycle row remains;
- no enabled lifecycle expiration overlaps the canonical installation prefix;
- `MCP_MEDIA_RECONCILIATION_READY=true`.

This slice does not deploy MCP, mutate R2, change environment variables, import legacy business data, run database migrations or perform DNS/Vercel cutover.
