-- Production forward-fix for the first route-active-session migration revision.
-- Fresh databases already receive session_id from the canonical 160000 migration,
-- so this migration is intentionally an idempotent no-op there.

do $migration$
declare
  v_oid oid;
  v_definition text;
  v_before text := $$'source', 'route_customer_explicit_sync',
          'route_customer_id', v_route_customer.id,$$;
  v_after text := $$'source', 'route_customer_explicit_sync',
          'session_id', v_session.id,
          'route_customer_id', v_route_customer.id,$$;
  v_session_context_needle text := $$'session_id', v_session.id$$;
begin
  select p.oid
    into v_oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'mcp_idempotent_add_route_customer'
     and pg_get_function_identity_arguments(p.oid) =
       'p_route_id text, p_customer_name text, p_phone text, p_area text, p_address text, p_sort_order integer, p_note text, p_customer_id text, p_geo_lat double precision, p_geo_lng double precision, p_geo_accuracy double precision, p_geo_source text, p_google_maps_url text, p_include_active_session boolean, p_active_session_id text, p_context jsonb';

  if v_oid is null then
    raise exception 'route_active_session_function_missing';
  end if;

  v_definition := pg_get_functiondef(v_oid);

  if position(v_session_context_needle in v_definition) > 0 then
    return;
  end if;

  if position(v_before in v_definition) = 0 then
    raise exception 'route_active_session_context_patch_anchor_missing';
  end if;

  execute replace(v_definition, v_before, v_after);
end;
$migration$;