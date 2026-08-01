-- Phase 6C.0A — MCP legacy read-only audit package
-- Baseline: main@46f43b473e35ac1103aa2b49412de3f64fe1646b
--
-- SAFETY:
--   * Prepared for review only. Do not run against production until provider,
--     backup and restore-rehearsal gates are verified.
--   * The transaction is explicitly READ ONLY.
--   * Legacy rows are converted to jsonb so the audit does not silently assume
--     optional columns beyond stable table names. Missing tables still require
--     schema binding before execution.
--   * Replace no values in this file with secrets.

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

-- Q00 — runtime/database fingerprint for the reconciliation report.
SELECT
  current_database() AS database_name,
  current_user AS database_user,
  current_setting('transaction_read_only') AS transaction_read_only,
  now() AS audited_at;

-- Q01 — duplicate outlet phones.
WITH outlets AS (
  SELECT
    to_jsonb(rc) AS row_data,
    regexp_replace(coalesce(to_jsonb(rc)->>'phone', ''), '[^0-9]+', '', 'g') AS normalized_phone
  FROM public.mcp_route_customers AS rc
)
SELECT
  normalized_phone,
  count(*) AS row_count,
  array_agg(coalesce(row_data->>'id', '<missing-id>') ORDER BY row_data->>'id') AS row_ids
FROM outlets
WHERE normalized_phone <> ''
GROUP BY normalized_phone
HAVING count(*) > 1
ORDER BY row_count DESC, normalized_phone;

-- Q02 — duplicate outlet identity candidates by normalized name and address.
WITH outlets AS (
  SELECT
    to_jsonb(rc) AS row_data,
    lower(regexp_replace(coalesce(to_jsonb(rc)->>'customer_name', to_jsonb(rc)->>'name', ''), '\s+', ' ', 'g')) AS normalized_name,
    lower(regexp_replace(coalesce(to_jsonb(rc)->>'address', ''), '\s+', ' ', 'g')) AS normalized_address
  FROM public.mcp_route_customers AS rc
)
SELECT
  normalized_name,
  normalized_address,
  count(*) AS row_count,
  array_agg(coalesce(row_data->>'id', '<missing-id>') ORDER BY row_data->>'id') AS row_ids
FROM outlets
WHERE normalized_name <> ''
GROUP BY normalized_name, normalized_address
HAVING count(*) > 1
ORDER BY row_count DESC, normalized_name;

-- Q03 — route-customer rows referencing a missing route.
WITH routes AS (
  SELECT to_jsonb(r)->>'id' AS id
  FROM public.mcp_routes AS r
),
route_customers AS (
  SELECT to_jsonb(rc) AS row_data
  FROM public.mcp_route_customers AS rc
)
SELECT
  row_data->>'id' AS route_customer_id,
  row_data->>'route_id' AS route_id,
  row_data
FROM route_customers
LEFT JOIN routes ON routes.id = route_customers.row_data->>'route_id'
WHERE coalesce(route_customers.row_data->>'route_id', '') = ''
   OR routes.id IS NULL
ORDER BY route_customer_id;

-- Q04 — session-customer rows referencing a missing session or outlet.
WITH sessions AS (
  SELECT to_jsonb(s)->>'id' AS id
  FROM public.mcp_route_sessions AS s
),
outlets AS (
  SELECT to_jsonb(rc)->>'id' AS id
  FROM public.mcp_route_customers AS rc
),
session_customers AS (
  SELECT to_jsonb(sc) AS row_data
  FROM public.mcp_route_session_customers AS sc
)
SELECT
  row_data->>'id' AS session_customer_id,
  row_data->>'session_id' AS session_id,
  coalesce(row_data->>'route_customer_id', row_data->>'customer_id') AS outlet_id,
  CASE
    WHEN coalesce(row_data->>'session_id', '') = '' THEN 'MISSING_SESSION_ID'
    WHEN sessions.id IS NULL THEN 'ORPHAN_SESSION'
    WHEN coalesce(row_data->>'route_customer_id', row_data->>'customer_id', '') = '' THEN 'MISSING_OUTLET_ID'
    WHEN outlets.id IS NULL THEN 'ORPHAN_OUTLET'
  END AS finding_code,
  row_data
FROM session_customers
LEFT JOIN sessions ON sessions.id = session_customers.row_data->>'session_id'
LEFT JOIN outlets ON outlets.id = coalesce(
  session_customers.row_data->>'route_customer_id',
  session_customers.row_data->>'customer_id'
)
WHERE coalesce(session_customers.row_data->>'session_id', '') = ''
   OR sessions.id IS NULL
   OR coalesce(
        session_customers.row_data->>'route_customer_id',
        session_customers.row_data->>'customer_id',
        ''
      ) = ''
   OR outlets.id IS NULL
ORDER BY session_customer_id;

-- Q05 — invalid or unexpected lifecycle statuses.
WITH candidate_rows AS (
  SELECT 'mcp_route_sessions' AS source_table, to_jsonb(s) AS row_data
  FROM public.mcp_route_sessions AS s
  UNION ALL
  SELECT 'mcp_route_session_customers', to_jsonb(sc)
  FROM public.mcp_route_session_customers AS sc
  UNION ALL
  SELECT 'orders', to_jsonb(o)
  FROM public.orders AS o
)
SELECT
  source_table,
  row_data->>'id' AS row_id,
  row_data->>'status' AS status,
  row_data
FROM candidate_rows
WHERE coalesce(row_data->>'status', '') = ''
   OR (
     source_table = 'mcp_route_session_customers'
     AND row_data->>'status' NOT IN ('pending', 'visited', 'skipped', 'cancelled')
   )
ORDER BY source_table, row_id;

-- Q06 — orders without customer/outlet/session identity.
WITH orders_json AS (
  SELECT to_jsonb(o) AS row_data
  FROM public.orders AS o
)
SELECT
  row_data->>'id' AS order_id,
  row_data
FROM orders_json
WHERE coalesce(
  row_data->>'session_customer_id',
  row_data->>'route_customer_id',
  row_data->>'customer_id',
  ''
) = ''
ORDER BY order_id;

-- Q07 — orders without any item.
WITH orders_json AS (
  SELECT to_jsonb(o) AS row_data
  FROM public.orders AS o
),
items_json AS (
  SELECT to_jsonb(i) AS row_data
  FROM public.order_items AS i
)
SELECT
  orders_json.row_data->>'id' AS order_id,
  orders_json.row_data
FROM orders_json
LEFT JOIN items_json
  ON items_json.row_data->>'order_id' = orders_json.row_data->>'id'
WHERE items_json.row_data IS NULL
ORDER BY order_id;

-- Q08 — potential retry duplicates by idempotency/source references.
WITH orders_json AS (
  SELECT to_jsonb(o) AS row_data
  FROM public.orders AS o
),
keys AS (
  SELECT
    row_data,
    coalesce(
      row_data->>'idempotency_key',
      row_data->>'source_request_id',
      row_data->>'client_request_id',
      ''
    ) AS retry_key
  FROM orders_json
)
SELECT
  retry_key,
  count(*) AS row_count,
  array_agg(coalesce(row_data->>'id', '<missing-id>') ORDER BY row_data->>'id') AS order_ids
FROM keys
WHERE retry_key <> ''
GROUP BY retry_key
HAVING count(*) > 1
ORDER BY row_count DESC, retry_key;

-- Q09 — order items missing canonical SKU/unit evidence.
WITH items_json AS (
  SELECT to_jsonb(i) AS row_data
  FROM public.order_items AS i
)
SELECT
  row_data->>'id' AS order_item_id,
  row_data->>'order_id' AS order_id,
  row_data
FROM items_json
WHERE coalesce(
        row_data->>'sku_id',
        row_data->>'variant_id',
        row_data->>'product_variant_id',
        ''
      ) = ''
   OR coalesce(
        row_data->>'unit_id',
        row_data->>'unit',
        row_data->>'sell_unit',
        ''
      ) = ''
ORDER BY order_id, order_item_id;

-- Q10 — nullable or ambiguous identity references on field outlets.
WITH outlets AS (
  SELECT to_jsonb(rc) AS row_data
  FROM public.mcp_route_customers AS rc
)
SELECT
  row_data->>'id' AS outlet_id,
  row_data->>'customer_id' AS legacy_customer_id,
  row_data->>'core_customer_id' AS core_customer_id,
  row_data->>'core_customer_address_id' AS core_customer_address_id,
  CASE
    WHEN coalesce(row_data->>'customer_id', '') <> ''
         AND coalesce(row_data->>'core_customer_id', '') = ''
      THEN 'LEGACY_CUSTOMER_ID_MEANING_UNRESOLVED'
    WHEN coalesce(row_data->>'core_customer_address_id', '') <> ''
         AND coalesce(row_data->>'core_customer_id', '') = ''
      THEN 'ADDRESS_WITHOUT_CORE_CUSTOMER'
    ELSE 'UNLINKED_OUTLET'
  END AS finding_code,
  row_data
FROM outlets
WHERE coalesce(row_data->>'core_customer_id', '') = ''
   OR (
     coalesce(row_data->>'core_customer_address_id', '') <> ''
     AND coalesce(row_data->>'core_customer_id', '') = ''
   )
ORDER BY outlet_id;

-- Q11 — possible sample/test/order-intent mixing.
WITH orders_json AS (
  SELECT to_jsonb(o) AS row_data
  FROM public.orders AS o
)
SELECT
  row_data->>'id' AS order_id,
  CASE
    WHEN lower(concat_ws(' ', row_data->>'type', row_data->>'purpose', row_data->>'note')) ~
         '(sample|test|trial|gửi mẫu|thử)'
      THEN 'SAMPLE_TEST_DEMAND_CANDIDATE'
    WHEN lower(concat_ws(' ', row_data->>'type', row_data->>'purpose', row_data->>'note')) ~
         '(intent|request|nhu cầu|đề nghị)'
      THEN 'FIELD_ORDER_INTENT_CANDIDATE'
    ELSE 'UNCLASSIFIED'
  END AS classification_hint,
  row_data
FROM orders_json
WHERE lower(concat_ws(' ', row_data->>'type', row_data->>'purpose', row_data->>'note')) ~
      '(sample|test|trial|gửi mẫu|thử|intent|request|nhu cầu|đề nghị)'
ORDER BY order_id;

-- Q12 — summary counts for the reconciliation report.
SELECT 'mcp_routes' AS entity, count(*) AS row_count FROM public.mcp_routes
UNION ALL
SELECT 'mcp_route_customers', count(*) FROM public.mcp_route_customers
UNION ALL
SELECT 'mcp_route_sessions', count(*) FROM public.mcp_route_sessions
UNION ALL
SELECT 'mcp_route_session_customers', count(*) FROM public.mcp_route_session_customers
UNION ALL
SELECT 'orders', count(*) FROM public.orders
UNION ALL
SELECT 'order_items', count(*) FROM public.order_items
ORDER BY entity;

ROLLBACK;
