# Phase 9.5 — MCP legacy audit/export + canonical ID mapping

> Issue: #392  
> Parent: #386  
> Audited baseline: `main@bcf78f3498a2a90626b535fa9aac4877cb255c6e`  
> Production import: **NOT AUTHORIZED**

## Boundary

Phase 9.5 creates a migration-grade read-only snapshot/mapping package. It does not import production rows, switch adapters, enable legacy runtime, mutate canonical PostgreSQL, or change provider configuration. Issue #391 remains OPEN; deferred Cloudflare lifecycle evidence is not waived.

Production MCP remains PostgreSQL. Legacy Supabase is audit/export source only. The CLI rejects `PERSISTENCE_PROVIDER=legacy-supabase` and an enabled `MCP_LEGACY_RUNTIME_ENABLED` flag.

## Contract and scope

Machine contract: `mcp/audit/phase-9-5/snapshot-contract.json`.

It covers routes, route customers/outlets, sessions, session customers, visits, orders/items, report settings, outlet media metadata, and dependent follow-ups/reports. Legacy `mcp_idempotency_records` is exported as evidence-only data for duplicate/retry reconciliation.

Legacy report settings remain `mcp_setting_groups` + `mcp_setting_items`; canonical tables are `mcp_report_setting_groups` + `mcp_report_settings`. Legacy media is the real `public.mcp_outlet_media` table; URL search/replace is not migration.

## Stable mapping and lineage

Mapping identity is `installation_id + entity + legacy_id`. Allowed mapping evidence is exact ID, entity-specific explicit legacy ID in canonical `raw_payload`, or preserving the stable source ID as a proposed canonical MCP ID when no collision exists. Name/phone/address/fuzzy matching is forbidden. Rows explicitly belonging to another installation are rejected.

FK checks cover route/outlet/session/visit/follow-up/report/order-item/report-setting/media lineage. Missing required FK, orphan FK, duplicate source identity, mapping collisions and conflicting idempotency evidence are blocking.

## Legacy order classification

The five locked Phase 6C.0A classes remain unchanged:

1. `OFFICIAL_ORDER_MIGRATION_CANDIDATE`
2. `FIELD_ORDER_INTENT`
3. `SAMPLE_TEST_DEMAND`
4. `HISTORICAL_DISPLAY_ONLY`
5. `INVALID_ORPHAN_RECONCILIATION_REQUIRED`

Intent/sample detection reads semantic business fields only, not serialized metadata keys. A `core_sales_order_id` is historical only when that ID exists in `sales.sales_orders` for the same installation. An official candidate requires verified active Core customer/address lineage, canonical item/SKU-unit evidence, lifecycle evidence, reconciled line totals and no duplicate/idempotency conflict. Ambiguity fails closed to reconciliation-required.

## Snapshot CLI

Run only from an approved secure migration environment:

`node mcp/audit/phase-9-5/legacy-migration-snapshot.mjs`

Required variable names (values must never be committed/logged):

- `MCP_LEGACY_AUDIT_SUPABASE_URL`
- `MCP_LEGACY_AUDIT_SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL`
- `INSTALLATION_ID`
- `MCP_LEGACY_SNAPSHOT_DIR`
- optional `MCP_DB_SCHEMA` (default `mcp`)
- optional `SNAPSHOT_SOURCE_SHA` if Git metadata is unavailable; otherwise the CLI binds to `git rev-parse HEAD` and rejects mismatch.

Output is a new non-existing directory containing `manifest.json`, `mapping.jsonl`, `findings.json`, `classifications.json`, and `entities/*.jsonl`. Rows are canonicalized before SHA-256 hashing. Raw exports can contain business/customer data and must not be committed or pasted into issues/logs.

## Consistency and immutability evidence

Legacy REST cannot give one DB transaction across paginated requests. The CLI therefore performs **two complete consecutive reads** and accepts the second materialization only when every entity has identical row count and deterministic digest in both passes. Any change fails as `legacy_source_unstable:<entity>`; no manifest is emitted.

Canonical PostgreSQL is read inside one `REPEATABLE READ READ ONLY` transaction. Optional target tables are checked with `to_regclass` before querying so a missing optional relation cannot abort the transaction.

The exporter creates a new write-once local package (`wx`, manifest last) and self-hashes the manifest. This detects accidental corruption but is not a replacement for provider-level WORM/object-lock/KMS evidence. Phase 9.5 closure still requires the package to be stored in the approved immutable migration-evidence location and that retention evidence recorded; this source slice does not invent a new signing provider.

## Gate and current execution state

`IMPORT_READY=true` means only that the exported data/mapping package is internally free of the blocking findings above. It never authorizes Phase 9.6 import by itself.

The connected Supabase account available to this chat does not expose the historical MCP project, so no live legacy snapshot is claimed. The next evidence step is one controlled read-only execution from a secure environment holding the historical audit credential, followed by review of the single manifest/findings package. Do not enable legacy runtime to obtain it.
