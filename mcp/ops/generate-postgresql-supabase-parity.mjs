import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE_DIR = resolve(ROOT, "mcp/supabase/migrations");
const CANONICAL_OUTPUT = resolve(ROOT, "database/migrations/mcp/003_mcp_supabase_contract_parity.sql");
const PACKAGED_OUTPUT = resolve(ROOT, "mcp/apps/backend/foundation/migrations/sql/003_mcp_supabase_contract_parity.sql");

const EXTRA_TABLES = new Set([
  "mcp_competitors",
  "mcp_customer_products",
  "mcp_report_templates",
  "mcp_route_order_templates",
  "mcp_route_order_template_items",
  "mcp_route_test_templates",
  "mcp_route_test_template_items",
  "mcp_route_report_templates",
  "mcp_route_followup_templates",
  "mcp_route_skip_reason_templates",
  "mcp_route_skip_reason_template_items",
  "mcp_route_customer_add_rules",
  "mcp_outlet_media",
  "mcp_storage_delete_jobs",
  "mcp_archive_intents"
]);

const REQUIRED_FUNCTIONS = new Set([
  "mcp_assert_session_mutable",
  "mcp_assert_session_customer_mutable",
  "mcp_backfill_session_customers_from_route",
  "mcp_recalc_session_customer_followup_count",
  "mcp_recalc_route_session_counters",
  "mcp_recalc_after_session_customer_change",
  "mcp_recalc_after_visit_change",
  "mcp_recalc_after_followup_change",
  "mcp_create_route",
  "mcp_update_route",
  "mcp_update_route_customer",
  "mcp_open_route_session",
  "mcp_set_session_customer_status",
  "mcp_update_route_session",
  "mcp_delete_empty_route_session",
  "mcp_record_session_customer_result",
  "mcp_add_session_customer",
  "mcp_set_session_customer_checkin",
  "mcp_create_order_from_session_customer",
  "mcp_create_test_from_session_customer",
  "mcp_create_report_from_session_customer",
  "mcp_create_followup_from_session_customer",
  "mcp_create_session_report_snapshot",
  "mcp_save_session_report_ai_result",
  "mcp_update_field_check_result",
  "mcp_create_report_setting_group",
  "mcp_update_report_setting_group",
  "mcp_create_report_setting_item",
  "mcp_update_report_setting_item",
  "mcp_create_order",
  "mcp_get_report_templates",
  "mcp_get_report_context",
  "mcp_save_route_order_template",
  "mcp_save_route_test_template",
  "mcp_save_route_report_template",
  "mcp_save_route_followup_template",
  "mcp_save_route_customer_add_rule",
  "mcp_save_route_skip_reason_template",
  "mcp_prepare_outlet_media_upload",
  "mcp_finalize_outlet_media_upload",
  "mcp_claim_outlet_media_delete",
  "mcp_finish_outlet_media_delete",
  "mcp_claim_route_customer_media_delete",
  "mcp_claim_route_media_delete",
  "mcp_claim_stale_outlet_media_delete",
  "mcp_claim_ready_storage_delete_jobs",
  "mcp_finish_storage_delete_job",
  "mcp_get_product_variants",
  "mcp_search_products"
]);

const MANUAL_FUNCTIONS = new Map([
  ["mcp_assert_session_customer_mutable", String.raw`CREATE OR REPLACE FUNCTION public.mcp_assert_session_customer_mutable(p_session_customer_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_session_id text;
BEGIN
  IF NULLIF(btrim(COALESCE(p_session_customer_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'session_customer_id_required' USING ERRCODE = '23514';
  END IF;

  SELECT session_id INTO v_session_id
  FROM public.mcp_session_customers
  WHERE id = p_session_customer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_customer_not_found' USING ERRCODE = '23503';
  END IF;

  PERFORM public.mcp_assert_session_mutable(v_session_id);
END;
$function$;`],

  ["mcp_backfill_session_customers_from_route", String.raw`CREATE OR REPLACE FUNCTION public.mcp_backfill_session_customers_from_route(
  p_session_id text,
  p_only_if_empty boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_session public.mcp_route_sessions%rowtype;
  v_before_count integer := 0;
  v_active_count integer := 0;
  v_inserted_count integer := 0;
BEGIN
  IF NULLIF(btrim(COALESCE(p_session_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'session_id_required' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_session
  FROM public.mcp_route_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found' USING ERRCODE = '23503';
  END IF;

  SELECT count(*)::integer INTO v_before_count
  FROM public.mcp_session_customers
  WHERE session_id = v_session.id;

  SELECT count(*)::integer INTO v_active_count
  FROM public.mcp_route_customers
  WHERE route_id = v_session.route_id
    AND COALESCE(active, true) IS true;

  IF COALESCE(p_only_if_empty, true) AND v_before_count > 0 THEN
    RETURN jsonb_build_object(
      'sessionId', v_session.id,
      'routeId', v_session.route_id,
      'beforeCount', v_before_count,
      'insertedCount', 0,
      'activeRouteCustomers', v_active_count,
      'skipped', 'existing_session_snapshot_frozen'
    );
  END IF;

  INSERT INTO public.mcp_session_customers (
    id, installation_id, session_id, route_id, route_customer_id,
    customer_id, customer_name, phone, area, address, sort_order,
    source, planned_status, visit_status, note, raw_payload, created_at, updated_at
  )
  SELECT
    'msc_' || replace(gen_random_uuid()::text, '-', ''),
    COALESCE(route_customer.installation_id, v_session.installation_id),
    v_session.id,
    v_session.route_id,
    route_customer.id,
    route_customer.customer_id,
    route_customer.customer_name,
    route_customer.phone,
    COALESCE(route_customer.area, v_session.area),
    route_customer.address,
    route_customer.sort_order,
    'master',
    'planned',
    'pending',
    route_customer.note,
    jsonb_build_object(
      'source', 'mcp_backfill_session_customers_from_route',
      'route_customer_id', route_customer.id
    ),
    now(),
    now()
  FROM public.mcp_route_customers route_customer
  WHERE route_customer.route_id = v_session.route_id
    AND COALESCE(route_customer.active, true) IS true
    AND NOT EXISTS (
      SELECT 1
      FROM public.mcp_session_customers session_customer
      WHERE session_customer.session_id = v_session.id
        AND session_customer.route_customer_id = route_customer.id
    )
  ORDER BY route_customer.sort_order, route_customer.id
  ON CONFLICT (session_id, route_customer_id) WHERE route_customer_id IS NOT NULL DO NOTHING;

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'sessionId', v_session.id,
    'routeId', v_session.route_id,
    'beforeCount', v_before_count,
    'insertedCount', v_inserted_count,
    'activeRouteCustomers', v_active_count
  );
END;
$function$;`],

  ["mcp_create_route", String.raw`CREATE OR REPLACE FUNCTION public.mcp_create_route(
  p_route_name text,
  p_area text,
  p_weekday integer,
  p_note text,
  p_distributor_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_route public.mcp_routes%rowtype;
  v_route_name text := NULLIF(btrim(COALESCE(p_route_name, '')), '');
BEGIN
  IF v_route_name IS NULL THEN
    RAISE EXCEPTION 'route_name_required' USING ERRCODE = '23514';
  END IF;
  IF p_weekday IS NOT NULL AND (p_weekday < 0 OR p_weekday > 6) THEN
    RAISE EXCEPTION 'invalid_weekday' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.mcp_routes (
    id, distributor_id, route_name, area, weekday, active, note,
    sync_status, raw_payload, created_at, updated_at
  ) VALUES (
    'route_' || replace(gen_random_uuid()::text, '-', ''),
    NULLIF(btrim(COALESCE(p_distributor_id, '')), ''),
    v_route_name,
    NULLIF(btrim(COALESCE(p_area, '')), ''),
    p_weekday,
    true,
    NULLIF(btrim(COALESCE(p_note, '')), ''),
    'synced',
    jsonb_build_object('source', 'mcp_create_route'),
    now(),
    now()
  ) RETURNING * INTO v_route;

  RETURN jsonb_build_object(
    'id', v_route.id,
    'routeId', v_route.id,
    'routeName', v_route.route_name,
    'area', v_route.area,
    'weekday', v_route.weekday,
    'active', v_route.active,
    'note', v_route.note,
    'distributorId', v_route.distributor_id,
    'createdAt', v_route.created_at,
    'updatedAt', v_route.updated_at
  );
END;
$function$;`],

  ["mcp_update_route", String.raw`CREATE OR REPLACE FUNCTION public.mcp_update_route(
  p_route_id text,
  p_route_name text,
  p_area text,
  p_weekday integer,
  p_note text,
  p_active boolean,
  p_distributor_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_route public.mcp_routes%rowtype;
BEGIN
  IF NULLIF(btrim(COALESCE(p_route_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'route_id_required' USING ERRCODE = '23514';
  END IF;
  IF p_route_name IS NOT NULL AND NULLIF(btrim(p_route_name), '') IS NULL THEN
    RAISE EXCEPTION 'route_name_required' USING ERRCODE = '23514';
  END IF;
  IF p_weekday IS NOT NULL AND (p_weekday < 0 OR p_weekday > 6) THEN
    RAISE EXCEPTION 'invalid_weekday' USING ERRCODE = '23514';
  END IF;

  UPDATE public.mcp_routes
  SET route_name = COALESCE(NULLIF(btrim(p_route_name), ''), route_name),
      area = CASE WHEN p_area IS NULL THEN area ELSE NULLIF(btrim(p_area), '') END,
      weekday = COALESCE(p_weekday, weekday),
      note = CASE WHEN p_note IS NULL THEN note ELSE NULLIF(btrim(p_note), '') END,
      active = COALESCE(p_active, active),
      distributor_id = CASE
        WHEN p_distributor_id IS NULL THEN distributor_id
        ELSE NULLIF(btrim(p_distributor_id), '')
      END,
      sync_status = 'synced',
      raw_payload = COALESCE(raw_payload, '{}'::jsonb) || jsonb_build_object('last_source', 'mcp_update_route'),
      updated_at = now()
  WHERE id = p_route_id
  RETURNING * INTO v_route;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'route_not_found' USING ERRCODE = '23503';
  END IF;

  RETURN jsonb_build_object(
    'id', v_route.id,
    'routeId', v_route.id,
    'routeName', v_route.route_name,
    'area', v_route.area,
    'weekday', v_route.weekday,
    'active', v_route.active,
    'note', v_route.note,
    'distributorId', v_route.distributor_id,
    'updatedAt', v_route.updated_at
  );
END;
$function$;`],

  ["mcp_update_route_customer", String.raw`CREATE OR REPLACE FUNCTION public.mcp_update_route_customer(
  p_route_customer_id text,
  p_customer_name text,
  p_phone text,
  p_area text,
  p_address text,
  p_sort_order integer,
  p_note text,
  p_active boolean,
  p_geo_lat double precision,
  p_geo_lng double precision,
  p_geo_accuracy double precision,
  p_geo_source text,
  p_google_maps_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_row public.mcp_route_customers%rowtype;
BEGIN
  IF NULLIF(btrim(COALESCE(p_route_customer_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'route_customer_id_required' USING ERRCODE = '23514';
  END IF;
  IF p_customer_name IS NOT NULL AND NULLIF(btrim(p_customer_name), '') IS NULL THEN
    RAISE EXCEPTION 'customer_name_required' USING ERRCODE = '23514';
  END IF;
  IF p_sort_order IS NOT NULL AND p_sort_order < 0 THEN
    RAISE EXCEPTION 'invalid_sort_order' USING ERRCODE = '23514';
  END IF;
  IF (p_geo_lat IS NULL) <> (p_geo_lng IS NULL) THEN
    RAISE EXCEPTION 'geo_coordinates_incomplete' USING ERRCODE = '23514';
  END IF;
  IF p_geo_lat IS NOT NULL AND (p_geo_lat < -90 OR p_geo_lat > 90) THEN
    RAISE EXCEPTION 'invalid_geo_lat' USING ERRCODE = '23514';
  END IF;
  IF p_geo_lng IS NOT NULL AND (p_geo_lng < -180 OR p_geo_lng > 180) THEN
    RAISE EXCEPTION 'invalid_geo_lng' USING ERRCODE = '23514';
  END IF;
  IF p_geo_accuracy IS NOT NULL AND p_geo_accuracy < 0 THEN
    RAISE EXCEPTION 'invalid_geo_accuracy' USING ERRCODE = '23514';
  END IF;

  UPDATE public.mcp_route_customers
  SET customer_name = COALESCE(NULLIF(btrim(p_customer_name), ''), customer_name),
      phone = CASE WHEN p_phone IS NULL THEN phone ELSE NULLIF(btrim(p_phone), '') END,
      area = CASE WHEN p_area IS NULL THEN area ELSE NULLIF(btrim(p_area), '') END,
      address = CASE WHEN p_address IS NULL THEN address ELSE NULLIF(btrim(p_address), '') END,
      sort_order = COALESCE(p_sort_order, sort_order),
      note = CASE WHEN p_note IS NULL THEN note ELSE NULLIF(btrim(p_note), '') END,
      active = COALESCE(p_active, active),
      geo_lat = CASE WHEN p_geo_lat IS NULL THEN geo_lat ELSE p_geo_lat END,
      geo_lng = CASE WHEN p_geo_lng IS NULL THEN geo_lng ELSE p_geo_lng END,
      geo_accuracy = CASE WHEN p_geo_lat IS NULL THEN geo_accuracy ELSE p_geo_accuracy END,
      geo_captured_at = CASE WHEN p_geo_lat IS NULL THEN geo_captured_at ELSE now() END,
      geo_source = CASE WHEN p_geo_lat IS NULL THEN geo_source ELSE COALESCE(NULLIF(btrim(p_geo_source), ''), 'browser') END,
      google_maps_url = CASE WHEN p_google_maps_url IS NULL THEN google_maps_url ELSE NULLIF(btrim(p_google_maps_url), '') END,
      sync_status = 'synced',
      raw_payload = COALESCE(raw_payload, '{}'::jsonb) || jsonb_build_object('last_source', 'mcp_update_route_customer'),
      updated_at = now()
  WHERE id = p_route_customer_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'route_customer_not_found' USING ERRCODE = '23503';
  END IF;

  RETURN to_jsonb(v_row);
END;
$function$;`]
]);

function scanBalancedStatement(sql, start) {
  let depth = 0;
  let quote = null;
  let dollar = null;
  for (let index = start; index < sql.length; index += 1) {
    const char = sql[index];
    const pair = sql.slice(index, index + 2);
    if (dollar) {
      if (sql.startsWith(dollar, index)) {
        index += dollar.length - 1;
        dollar = null;
      }
      continue;
    }
    if (quote) {
      if (char === quote && sql[index + 1] === quote) {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    const dollarMatch = sql.slice(index).match(/^\$[A-Za-z0-9_]*\$/);
    if (dollarMatch) {
      dollar = dollarMatch[0];
      index += dollar.length - 1;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (pair === "--") {
      const newline = sql.indexOf("\n", index + 2);
      if (newline === -1) return sql.length;
      index = newline;
      continue;
    }
    if (pair === "/*") {
      const close = sql.indexOf("*/", index + 2);
      if (close === -1) throw new Error("unterminated SQL comment");
      index = close + 1;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === ";" && depth === 0) return index + 1;
  }
  throw new Error("unterminated SQL statement");
}

function collectCreateTables(sql, file, output) {
  const pattern = /create\s+table\s+if\s+not\s+exists\s+public\.([a-z0-9_]+)\s*\(/gi;
  let match;
  while ((match = pattern.exec(sql))) {
    const name = match[1].toLowerCase();
    if (!EXTRA_TABLES.has(name)) continue;
    const end = scanBalancedStatement(sql, match.index);
    output.set(name, { file, sql: sql.slice(match.index, end) });
    pattern.lastIndex = end;
  }
}

function collectFunctions(sql, file, output) {
  const pattern = /create\s+(?:or\s+replace\s+)?function\s+public\.([a-z0-9_]+)\s*\(/gi;
  let match;
  while ((match = pattern.exec(sql))) {
    const name = match[1].toLowerCase();
    if (!REQUIRED_FUNCTIONS.has(name)) continue;
    const end = scanBalancedStatement(sql, match.index);
    output.set(name, { file, sql: sql.slice(match.index, end) });
    pattern.lastIndex = end;
  }
}

function rewrite(sql) {
  return sql
    .replace(/\bpublic\./gi, "mcp.")
    .replace(/\bset\s+search_path\s*=\s*mcp\b/gi, "SET search_path = mcp, pg_catalog")
    .replace(/\bextensions\.digest\b/gi, "digest")
    .trim();
}

const HEADER = `-- GENERATED by mcp/ops/generate-postgresql-supabase-parity.mjs.
-- Supabase business contracts remain the source reference; PostgreSQL schema mcp is the runtime target.
-- This migration is additive and intentionally contains no production data deletion.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE mcp.mcp_routes
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'synced';

ALTER TABLE mcp.mcp_route_sessions
  ADD COLUMN IF NOT EXISTS weekday smallint,
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'synced';

ALTER TABLE mcp.mcp_session_customers
  ADD COLUMN IF NOT EXISTS planned_status text NOT NULL DEFAULT 'planned',
  ADD COLUMN IF NOT EXISTS visit_id text;

UPDATE mcp.mcp_session_customers
SET source = CASE WHEN source = 'planned' THEN 'master' ELSE source END,
    planned_status = CASE
      WHEN source = 'added' THEN 'added'
      WHEN planned_status IS NULL OR btrim(planned_status) = '' THEN 'planned'
      ELSE planned_status
    END
WHERE source = 'planned' OR planned_status IS NULL OR btrim(planned_status) = '';

ALTER TABLE mcp.mcp_visits
  ADD COLUMN IF NOT EXISTS has_order boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_test boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_report boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS order_id text,
  ADD COLUMN IF NOT EXISTS test_id text,
  ADD COLUMN IF NOT EXISTS report_id text,
  ADD COLUMN IF NOT EXISTS status_reason text;

ALTER TABLE mcp.test_customer_results
  ADD COLUMN IF NOT EXISTS session_customer_id text;

ALTER TABLE mcp.mcp_report_setting_groups
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS group_type text NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE mcp.mcp_report_setting_groups
SET title = COALESCE(NULLIF(btrim(title), ''), group_name),
    status = CASE WHEN active THEN 'active' ELSE 'inactive' END,
    meta = COALESCE(meta, raw_payload, '{}'::jsonb)
WHERE title IS NULL OR btrim(title) = '';

ALTER TABLE mcp.mcp_report_settings
  ADD COLUMN IF NOT EXISTS item_key text,
  ADD COLUMN IF NOT EXISTS label text,
  ADD COLUMN IF NOT EXISTS text_value text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS brand_name text,
  ADD COLUMN IF NOT EXISTS product_id text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE mcp.mcp_report_settings
SET item_key = COALESCE(NULLIF(btrim(item_key), ''), setting_key),
    label = COALESCE(NULLIF(btrim(label), ''), setting_name),
    text_value = COALESCE(text_value, CASE WHEN jsonb_typeof(value) = 'string' THEN value #>> '{}' ELSE value::text END),
    status = CASE WHEN active THEN 'active' ELSE 'inactive' END,
    meta = COALESCE(meta, raw_payload, '{}'::jsonb)
WHERE item_key IS NULL OR label IS NULL;

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mcp_session_customers_source_parity_check') THEN
    ALTER TABLE mcp.mcp_session_customers
      ADD CONSTRAINT mcp_session_customers_source_parity_check CHECK (source IN ('master', 'added')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mcp_session_customers_planned_status_parity_check') THEN
    ALTER TABLE mcp.mcp_session_customers
      ADD CONSTRAINT mcp_session_customers_planned_status_parity_check CHECK (planned_status IN ('planned', 'added', 'removed')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mcp_session_customers_visit_status_parity_check') THEN
    ALTER TABLE mcp.mcp_session_customers
      ADD CONSTRAINT mcp_session_customers_visit_status_parity_check CHECK (visit_status IN ('pending', 'visited', 'skipped', 'cancelled')) NOT VALID;
  END IF;
END;
$constraints$;

CREATE UNIQUE INDEX IF NOT EXISTS mcp_session_customers_session_route_customer_uidx
  ON mcp.mcp_session_customers(session_id, route_customer_id)
  WHERE route_customer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS mcp_route_sessions_route_date_uidx
  ON mcp.mcp_route_sessions(route_id, session_date);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_route_sessions_one_active_per_route_uidx
  ON mcp.mcp_route_sessions(route_id)
  WHERE lower(COALESCE(status, 'active')) = 'active';
`;

const FOOTER = `

DROP TRIGGER IF EXISTS trg_mcp_session_customers_recalc_counters ON mcp.mcp_session_customers;
CREATE TRIGGER trg_mcp_session_customers_recalc_counters
AFTER INSERT OR UPDATE OF session_id, visit_status, order_id, test_id, report_id, followup_count OR DELETE
ON mcp.mcp_session_customers
FOR EACH ROW EXECUTE FUNCTION mcp.mcp_recalc_after_session_customer_change();

DROP TRIGGER IF EXISTS trg_mcp_visits_recalc_counters ON mcp.mcp_visits;
CREATE TRIGGER trg_mcp_visits_recalc_counters
AFTER INSERT OR UPDATE OF session_id, has_order, has_test, has_report, order_id, test_id, report_id OR DELETE
ON mcp.mcp_visits
FOR EACH ROW EXECUTE FUNCTION mcp.mcp_recalc_after_visit_change();

DROP TRIGGER IF EXISTS trg_mcp_followups_recalc_counters ON mcp.mcp_followups;
CREATE TRIGGER trg_mcp_followups_recalc_counters
AFTER INSERT OR UPDATE OF session_id, session_customer_id, status OR DELETE
ON mcp.mcp_followups
FOR EACH ROW EXECUTE FUNCTION mcp.mcp_recalc_after_followup_change();

REVOKE ALL ON ALL TABLES IN SCHEMA mcp FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA mcp FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA mcp FROM PUBLIC;
`;

const files = readdirSync(SOURCE_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const tables = new Map();
const functions = new Map();
for (const file of files) {
  const sql = readFileSync(resolve(SOURCE_DIR, file), "utf8");
  collectCreateTables(sql, file, tables);
  collectFunctions(sql, file, functions);
}

for (const [name, sql] of MANUAL_FUNCTIONS) {
  if (!functions.has(name)) functions.set(name, { file: "manual-fallback", sql });
}

const missingTables = [...EXTRA_TABLES].filter((name) => !tables.has(name));
const missingFunctions = [...REQUIRED_FUNCTIONS].filter((name) => !functions.has(name));
if (missingTables.length || missingFunctions.length) {
  throw new Error(JSON.stringify({ missingTables, missingFunctions }, null, 2));
}

const tableSql = [...EXTRA_TABLES]
  .map((name) => `-- Source: ${tables.get(name).file}\n${rewrite(tables.get(name).sql)}`)
  .join("\n\n");
const functionSql = [...REQUIRED_FUNCTIONS]
  .map((name) => `-- Source: ${functions.get(name).file}\n${rewrite(functions.get(name).sql)}`)
  .join("\n\n");

const output = `${HEADER}\n${tableSql}\n\n${functionSql}${FOOTER}`.replace(/\r\n/g, "\n").trimEnd() + "\n";
for (const path of [CANONICAL_OUTPUT, PACKAGED_OUTPUT]) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, output, "utf8");
}
console.log(JSON.stringify({ generatedBytes: Buffer.byteLength(output), tables: tables.size, functions: functions.size }));
