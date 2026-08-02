import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const target = resolve(root, "mcp/ops/generate-postgresql-supabase-parity.mjs");
let source = readFileSync(target, "utf8");

const sql = `CREATE OR REPLACE FUNCTION public.mcp_add_route_customer(
  p_route_id text,
  p_customer_name text,
  p_phone text,
  p_area text,
  p_address text,
  p_sort_order integer,
  p_note text,
  p_customer_id text,
  p_geo_lat double precision,
  p_geo_lng double precision,
  p_geo_accuracy double precision,
  p_geo_source text,
  p_google_maps_url text,
  p_include_active_session boolean,
  p_active_session_id text,
  p_context jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_data jsonb;
  v_route public.mcp_routes%rowtype;
  v_session public.mcp_route_sessions%rowtype;
  v_route_customer public.mcp_route_customers%rowtype;
  v_session_customer public.mcp_session_customers%rowtype;
  v_installation_id text := NULLIF(current_setting('app.installation_id', true), '');
  v_route_id text := NULLIF(btrim(COALESCE(p_route_id, '')), '');
  v_customer_name text := NULLIF(btrim(COALESCE(p_customer_name, '')), '');
  v_customer_id text := NULLIF(btrim(COALESCE(p_customer_id, '')), '');
  v_phone text := NULLIF(btrim(COALESCE(p_phone, '')), '');
  v_phone_digits text := NULLIF(regexp_replace(COALESCE(p_phone, ''), '[^0-9]+', '', 'g'), '');
  v_area text := NULLIF(btrim(COALESCE(p_area, '')), '');
  v_address text := NULLIF(btrim(COALESCE(p_address, '')), '');
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_active_session_id text := NULLIF(btrim(COALESCE(p_active_session_id, '')), '');
  v_include_active_session boolean := COALESCE(p_include_active_session, false);
  v_route_sort_order integer;
  v_session_sort_order integer;
  v_route_customer_created boolean := false;
  v_session_customer_created boolean := false;
  v_now timestamptz := now();
BEGIN
  IF v_installation_id IS NULL THEN
    RAISE EXCEPTION 'installation_id_required' USING ERRCODE = '23514';
  END IF;
  IF v_route_id IS NULL THEN
    RAISE EXCEPTION 'route_id_required' USING ERRCODE = '23514';
  END IF;
  IF v_customer_name IS NULL THEN
    RAISE EXCEPTION 'customer_name_required' USING ERRCODE = '23514';
  END IF;
  IF v_include_active_session AND v_active_session_id IS NULL THEN
    RAISE EXCEPTION 'active_session_id_required' USING ERRCODE = '23514';
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

  -- Keep the original deadlock-safe lock order: active session first, route second.
  IF v_include_active_session THEN
    SELECT * INTO v_session
      FROM public.mcp_route_sessions
     WHERE id = v_active_session_id
       AND (installation_id = v_installation_id OR installation_id IS NULL)
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'active_session_not_found' USING ERRCODE = '23503';
    END IF;
    IF v_session.route_id IS DISTINCT FROM v_route_id THEN
      RAISE EXCEPTION 'active_session_route_mismatch' USING ERRCODE = '23514';
    END IF;
    IF lower(COALESCE(v_session.status, 'active')) IN ('done', 'completed', 'cancelled', 'closed') THEN
      RAISE EXCEPTION 'session_closed_read_only' USING ERRCODE = '23514';
    END IF;
    PERFORM public.mcp_assert_session_mutable(v_session.id);
  END IF;

  SELECT * INTO v_route
    FROM public.mcp_routes
   WHERE id = v_route_id
     AND (installation_id = v_installation_id OR installation_id IS NULL)
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'route_not_found' USING ERRCODE = '23503';
  END IF;

  IF v_customer_id IS NOT NULL THEN
    SELECT * INTO v_route_customer
      FROM public.mcp_route_customers
     WHERE route_id = v_route.id
       AND (installation_id = v_installation_id OR installation_id IS NULL)
       AND customer_id = v_customer_id
     ORDER BY COALESCE(active, true) DESC, updated_at DESC NULLS LAST
     FOR UPDATE
     LIMIT 1;
  END IF;

  IF v_route_customer.id IS NULL AND v_phone_digits IS NOT NULL THEN
    SELECT * INTO v_route_customer
      FROM public.mcp_route_customers
     WHERE route_id = v_route.id
       AND (installation_id = v_installation_id OR installation_id IS NULL)
       AND NULLIF(regexp_replace(COALESCE(phone, ''), '[^0-9]+', '', 'g'), '') = v_phone_digits
     ORDER BY COALESCE(active, true) DESC, updated_at DESC NULLS LAST
     FOR UPDATE
     LIMIT 1;
  END IF;

  IF v_route_customer.id IS NULL THEN
    SELECT * INTO v_route_customer
      FROM public.mcp_route_customers
     WHERE route_id = v_route.id
       AND (installation_id = v_installation_id OR installation_id IS NULL)
       AND lower(btrim(customer_name)) = lower(v_customer_name)
       AND (
         (v_address IS NOT NULL AND lower(btrim(COALESCE(address, ''))) = lower(v_address))
         OR
         (v_address IS NULL AND lower(btrim(COALESCE(area, ''))) = lower(btrim(COALESCE(v_area, v_route.area, ''))))
       )
     ORDER BY COALESCE(active, true) DESC, updated_at DESC NULLS LAST
     FOR UPDATE
     LIMIT 1;
  END IF;

  IF v_route_customer.id IS NULL THEN
    IF COALESCE(p_sort_order, 0) > 0 THEN
      v_route_sort_order := p_sort_order;
    ELSE
      SELECT COALESCE(max(sort_order), 0) + 1
        INTO v_route_sort_order
        FROM public.mcp_route_customers
       WHERE route_id = v_route.id
         AND (installation_id = v_installation_id OR installation_id IS NULL);
    END IF;

    INSERT INTO public.mcp_route_customers (
      id, installation_id, route_id, customer_id, customer_name, phone, area,
      address, sort_order, active, note, geo_lat, geo_lng, geo_accuracy,
      geo_source, geo_captured_at, google_maps_url, sync_status, raw_payload,
      created_at, updated_at
    ) VALUES (
      'mrc_' || replace(gen_random_uuid()::text, '-', ''),
      v_installation_id,
      v_route.id,
      v_customer_id,
      v_customer_name,
      v_phone,
      COALESCE(v_area, v_route.area),
      v_address,
      v_route_sort_order,
      true,
      v_note,
      p_geo_lat,
      p_geo_lng,
      p_geo_accuracy,
      NULLIF(btrim(COALESCE(p_geo_source, '')), ''),
      CASE WHEN p_geo_lat IS NOT NULL AND p_geo_lng IS NOT NULL THEN v_now ELSE NULL END,
      NULLIF(btrim(COALESCE(p_google_maps_url, '')), ''),
      'synced',
      jsonb_build_object(
        'source', 'route_customer_explicit_sync',
        'foundation_context', COALESCE(p_context, '{}'::jsonb)
      ),
      v_now,
      v_now
    ) RETURNING * INTO v_route_customer;

    v_route_customer_created := true;
  ELSE
    UPDATE public.mcp_route_customers
       SET installation_id = COALESCE(installation_id, v_installation_id),
           active = true,
           updated_at = v_now
     WHERE id = v_route_customer.id
     RETURNING * INTO v_route_customer;
  END IF;

  IF v_include_active_session THEN
    SELECT * INTO v_session_customer
      FROM public.mcp_session_customers
     WHERE session_id = v_session.id
       AND route_customer_id = v_route_customer.id
       AND (installation_id = v_installation_id OR installation_id IS NULL)
     FOR UPDATE;

    IF v_session_customer.id IS NULL THEN
      SELECT COALESCE(max(sort_order), 0) + 1
        INTO v_session_sort_order
        FROM public.mcp_session_customers
       WHERE session_id = v_session.id
         AND (installation_id = v_installation_id OR installation_id IS NULL);

      INSERT INTO public.mcp_session_customers (
        id, installation_id, session_id, route_id, route_customer_id,
        customer_id, customer_name, phone, area, address, sort_order,
        source, planned_status, visit_status, note, raw_payload,
        created_at, updated_at
      ) VALUES (
        'msc_' || replace(gen_random_uuid()::text, '-', ''),
        v_installation_id,
        v_session.id,
        v_route.id,
        v_route_customer.id,
        v_route_customer.customer_id,
        v_route_customer.customer_name,
        v_route_customer.phone,
        COALESCE(v_route_customer.area, v_session.area, v_route.area),
        v_route_customer.address,
        v_session_sort_order,
        'added',
        'added',
        'pending',
        COALESCE(v_note, 'Thêm từ tuyến cố định vào phiên đang chạy'),
        jsonb_build_object(
          'source', 'route_customer_explicit_sync',
          'session_id', v_session.id,
          'route_customer_id', v_route_customer.id,
          'foundation_context', COALESCE(p_context, '{}'::jsonb)
        ),
        v_now,
        v_now
      ) RETURNING * INTO v_session_customer;

      v_session_customer_created := true;
      PERFORM public.mcp_recalc_route_session_counters(v_session.id);
    ELSE
      UPDATE public.mcp_session_customers
         SET installation_id = COALESCE(installation_id, v_installation_id),
             updated_at = v_now
       WHERE id = v_session_customer.id
       RETURNING * INTO v_session_customer;
    END IF;
  END IF;

  v_data := jsonb_build_object(
    'routeCustomerId', v_route_customer.id,
    'sessionCustomerId', CASE WHEN v_include_active_session THEN v_session_customer.id ELSE NULL END,
    'activeSessionId', CASE WHEN v_include_active_session THEN v_session.id ELSE NULL END,
    'includedActiveSession', v_include_active_session,
    'createdRouteCustomer', v_route_customer_created,
    'createdSessionCustomer', v_session_customer_created,
    'reusedRouteCustomer', NOT v_route_customer_created,
    'reusedSessionCustomer', v_include_active_session AND NOT v_session_customer_created
  );

  RETURN v_data;
END;
$function$;`;

if (!source.includes('["mcp_add_route_customer",')) {
  const anchor = "\n]);\n\nfunction scanBalancedStatement";
  if (!source.includes(anchor)) throw new Error("manual_function_map_anchor_missing");
  source = source.replace(
    anchor,
    `,\n  ["mcp_add_route_customer", ${JSON.stringify(sql)}]\n]);\n\nfunction scanBalancedStatement`
  );
}

writeFileSync(target, source, "utf8");
console.log("patched mcp_add_route_customer PostgreSQL business function");
