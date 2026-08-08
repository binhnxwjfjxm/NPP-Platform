# Phase 9.5 — MCP legacy audit/export + canonical ID mapping

> Issue: #392  
> Parent: #386  
> Audited baseline: `main@bcf78f3498a2a90626b535fa9aac4877cb255c6e`  
> Production import: **NOT AUTHORIZED**

## 1. Boundary

Phase 9.5 produces a migration-grade, read-only snapshot and mapping package. It does not import rows, switch adapters, deploy a legacy runtime, mutate canonical PostgreSQL, or change production provider configuration.

Issue #391 remains OPEN. The remaining Cloudflare R2 lifecycle evidence is deferred by owner instruction only; it is not waived and must be completed before final Phase 9 cutover.

Production MCP remains PostgreSQL. The legacy Supabase path in this slice is an audit/export source only. `PERSISTENCE_PROVIDER=legacy-supabase` and `MCP_LEGACY_RUNTIME_ENABLED=true` are explicitly rejected by the snapshot CLI.

## 2. Source-of-truth contract

Machine-readable contract:

`mcp/audit/phase-9-5/snapshot-contract.json`

Required migration-grade entities:

- routes;
- route customers/outlets;
- route sessions;
- session customers;
- visits;
- orders and order items;
- legacy report-setting groups/items;
- outlet media metadata.

Dependent historical entities included when present:

- follow-ups;
- session reports;
- market reports.

Legacy report-setting source names remain `mcp_setting_groups` and `mcp_setting_items`; canonical names are `mcp_report_setting_groups` and `mcp_report_settings`. Migration 008 already proves that stable legacy IDs can be preserved for this aggregate.

Legacy outlet media is the real `public.mcp_outlet_media` table. Media mapping uses metadata IDs/FKs/object keys; URL search/replace is not a migration mechanism.

## 3. Stable ID mapping

Allowed evidence, in order:

1. exact source ID == canonical row ID;
2. an explicit legacy ID stored in canonical `raw_payload`;
3. if no canonical row exists and no collision exists, preserve the stable source ID as the proposed canonical MCP ID.

Forbidden shortcuts:

- customer/outlet name-only match;
- phone-only match;
- address-only match;
- fuzzy matching;
- treating a nullable legacy `customer_id` as proof of a Core customer.

Core customer/address and Core Sales Order references remain separate lineage. A field outlet may be valid operational MCP data without being linked to a Core customer.

## 4. FK lineage

The snapshot verifies source-side lineage before any import plan is accepted, including:

- route customer -> route;
- session -> route;
- session customer -> session/route/(nullable outlet);
- visit -> session/session customer/route/outlet when populated;
- follow-up -> its populated field-lifecycle parents;
- session report -> session;
- order item -> order;
- report setting item -> setting group;
- outlet media -> outlet + session.

Missing required FKs and orphan references are blocking findings.

## 5. Legacy order classification

The five locked classes from Phase 6C.0A are preserved exactly:

1. `OFFICIAL_ORDER_MIGRATION_CANDIDATE`
2. `FIELD_ORDER_INTENT`
3. `SAMPLE_TEST_DEMAND`
4. `HISTORICAL_DISPLAY_ONLY`
5. `INVALID_ORPHAN_RECONCILIATION_REQUIRED`

The classifier is fail-closed. An official migration candidate requires canonical customer evidence, lifecycle evidence, canonical item/SKU-unit evidence, quantities/prices and total evidence. Ambiguous orders remain reconciliation-required; they are not bulk inserted into Core Sales Orders.

## 6. Immutable export package

CLI:

`node mcp/apps/backend/scripts/legacy-migration-snapshot.js`

It requires audit-only legacy Supabase credentials plus read-only access to canonical PostgreSQL. The legacy credentials are not runtime configuration and must not be committed, logged or exposed to frontend code.

Required environment variable names:

- `MCP_LEGACY_AUDIT_SUPABASE_URL`
- `MCP_LEGACY_AUDIT_SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL`
- `INSTALLATION_ID`
- `AUDITED_MAIN_SHA`
- `MCP_LEGACY_SNAPSHOT_DIR`
- optional `MCP_DB_SCHEMA` (defaults to `mcp`)

The output directory must not already exist. This prevents an existing snapshot from being silently overwritten.

Output:

```text
<snapshot>/
  manifest.json
  mapping.jsonl
  findings.json
  classifications.json
  entities/
    routes.jsonl
    route_customers.jsonl
    ...
```

Rows are canonicalized before hashing. Manifest evidence contains counts/checksums and a hash of the legacy source hostname, never credentials.

The raw snapshot can contain customer/business data. It must stay in an approved private migration evidence location; do not commit it to this public repository or paste it into issue comments/logs.

## 7. Gate

Phase 9.5 import readiness is false when any blocking condition remains, including:

- missing stable source ID;
- duplicate source ID;
- one source ID mapping to multiple canonical rows;
- multiple source identities colliding on one canonical target;
- missing required FK;
- orphan FK;
- order classification requiring reconciliation.

`IMPORT_READY=true` is only evidence that the exported snapshot/mapping package is internally ready for the Phase 9.6 import decision. It does not authorize an import by itself.

## 8. Execution state at source implementation

The connected Supabase account available to this chat does not expose the historical MCP project that supplied the legacy tables. Therefore this source slice does not pretend a live legacy snapshot was executed.

The correct next evidence step is one controlled read-only execution of the CLI from a secure environment that has the historical audit credential, followed by review of the single manifest/findings package. Do not enable the legacy runtime to obtain this evidence.
