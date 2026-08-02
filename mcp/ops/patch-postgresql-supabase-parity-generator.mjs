import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const target = resolve(root, "mcp/ops/generate-postgresql-supabase-parity.mjs");
let source = readFileSync(target, "utf8");

source = source.replace(
  "const pattern = /create\\s+or\\s+replace\\s+function\\s+public\\.([a-z0-9_]+)\\s*\\(/gi;",
  "const pattern = /create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.([a-z0-9_]+)\\s*\\(/gi;"
);

const manualFunctions = String.raw`

const MANUAL_FUNCTIONS = new Map([
  ["mcp_assert_session_customer_mutable", String.raw\`CREATE OR REPLACE FUNCTION public.mcp_assert_session_customer_mutable(p_session_customer_id text)
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
$function$;\`],

  ["mcp_backfill_session_customers_from_route", String.raw\`CREATE OR REPLACE FUNCTION public.mcp_backfill_session_customers_from_route(
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
$function$;\`],

  ["mcp_create_route", String.raw\`CREATE OR REPLACE FUNCTION public.mcp_create_route(
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
$function$;\`],

  ["mcp_update_route", String.raw\`CREATE OR REPLACE FUNCTION public.mcp_update_route(
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
$function$;\`],

  ["mcp_update_route_customer", String.raw\`CREATE OR REPLACE FUNCTION public.mcp_update_route_customer(
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
$function$;\`]
]);
`;

if (!source.includes("const MANUAL_FUNCTIONS = new Map([")) {
  source = source.replace(
    "]);\n\nfunction scanBalancedStatement",
    `]);${manualFunctions}\nfunction scanBalancedStatement`
  );
}

if (!source.includes("functions.set(name, { file: \"manual-fallback\", sql });")) {
  source = source.replace(
    "const missingTables = [...EXTRA_TABLES].filter((name) => !tables.has(name));",
    `for (const [name, sql] of MANUAL_FUNCTIONS) {\n  if (!functions.has(name)) functions.set(name, { file: \"manual-fallback\", sql });\n}\n\nconst missingTables = [...EXTRA_TABLES].filter((name) => !tables.has(name));`
  );
}

if (!source.includes("ALTER TABLE mcp.mcp_routes\n  ADD COLUMN IF NOT EXISTS sync_status")) {
  source = source.replace(
    "ALTER TABLE mcp.mcp_route_sessions\n  ADD COLUMN IF NOT EXISTS weekday smallint,",
    "ALTER TABLE mcp.mcp_routes\n  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'synced';\n\nALTER TABLE mcp.mcp_route_sessions\n  ADD COLUMN IF NOT EXISTS weekday smallint,"
  );
}

writeFileSync(target, source, "utf8");
console.log("patched PostgreSQL Supabase parity generator");
