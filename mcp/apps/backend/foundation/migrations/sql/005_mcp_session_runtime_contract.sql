CREATE SCHEMA IF NOT EXISTS mcp;

ALTER TABLE mcp.mcp_route_sessions
  DROP CONSTRAINT IF EXISTS mcp_route_sessions_route_id_fkey;
ALTER TABLE mcp.mcp_route_sessions
  ADD CONSTRAINT mcp_route_sessions_route_id_fkey
  FOREIGN KEY (route_id) REFERENCES mcp.mcp_routes(id) ON DELETE CASCADE;

ALTER TABLE mcp.mcp_session_customers
  DROP CONSTRAINT IF EXISTS mcp_session_customers_route_id_fkey;
ALTER TABLE mcp.mcp_session_customers
  ADD CONSTRAINT mcp_session_customers_route_id_fkey
  FOREIGN KEY (route_id) REFERENCES mcp.mcp_routes(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION mcp.sync_route_session_visited_customers()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
DECLARE
  v_old_session_id text;
  v_new_session_id text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_session_id := OLD.session_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_session_id := NEW.session_id;
  END IF;

  IF v_old_session_id IS NOT NULL THEN
    UPDATE mcp.mcp_route_sessions session
    SET visited_customers = (
          SELECT COUNT(*)::integer
          FROM mcp.mcp_session_customers customer
          WHERE customer.installation_id = session.installation_id
            AND customer.session_id = session.id
            AND customer.visit_status = 'visited'
        ),
        updated_at = now()
    WHERE session.id = v_old_session_id;
  END IF;

  IF v_new_session_id IS NOT NULL AND v_new_session_id IS DISTINCT FROM v_old_session_id THEN
    UPDATE mcp.mcp_route_sessions session
    SET visited_customers = (
          SELECT COUNT(*)::integer
          FROM mcp.mcp_session_customers customer
          WHERE customer.installation_id = session.installation_id
            AND customer.session_id = session.id
            AND customer.visit_status = 'visited'
        ),
        updated_at = now()
    WHERE session.id = v_new_session_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS mcp_session_customers_visited_counter
  ON mcp.mcp_session_customers;
CREATE TRIGGER mcp_session_customers_visited_counter
AFTER INSERT OR DELETE OR UPDATE OF visit_status, session_id
ON mcp.mcp_session_customers
FOR EACH ROW
EXECUTE FUNCTION mcp.sync_route_session_visited_customers();

UPDATE mcp.mcp_route_sessions session
SET visited_customers = (
      SELECT COUNT(*)::integer
      FROM mcp.mcp_session_customers customer
      WHERE customer.installation_id = session.installation_id
        AND customer.session_id = session.id
        AND customer.visit_status = 'visited'
    ),
    updated_at = now();

CREATE OR REPLACE FUNCTION mcp.enforce_outlet_media_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, mcp
AS $function$
DECLARE
  v_active_media_count integer;
BEGIN
  IF NEW.status NOT IN ('pending', 'ready', 'deleting', 'delete_failed') THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.installation_id || ':' || NEW.route_customer_id, 0)
  );

  SELECT count(*)
    INTO v_active_media_count
  FROM mcp.mcp_outlet_media media
  WHERE media.installation_id = NEW.installation_id
    AND media.route_customer_id = NEW.route_customer_id
    AND media.status IN ('pending', 'ready', 'deleting', 'delete_failed')
    AND media.id IS DISTINCT FROM NEW.id;

  IF v_active_media_count >= 3 THEN
    RAISE EXCEPTION 'outlet_media_limit_reached' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION shared.grant_mcp_runtime_access(p_role name)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_super boolean;
  v_create_role boolean;
  v_create_db boolean;
  v_replication boolean;
  v_bypass_rls boolean;
BEGIN
  SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
    INTO v_super, v_create_role, v_create_db, v_replication, v_bypass_rls
  FROM pg_roles
  WHERE rolname = p_role::text;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mcp_runtime_role_not_found:%', p_role;
  END IF;

  IF v_super OR v_create_role OR v_create_db OR v_replication OR v_bypass_rls THEN
    RAISE EXCEPTION 'mcp_runtime_role_is_privileged:%', p_role;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_roles privileged
    WHERE (
      privileged.rolsuper
      OR privileged.rolcreaterole
      OR privileged.rolcreatedb
      OR privileged.rolreplication
      OR privileged.rolbypassrls
      OR privileged.rolname IN (
        'pg_read_all_data',
        'pg_write_all_data',
        'pg_execute_server_program',
        'pg_read_server_files',
        'pg_write_server_files'
      )
    )
      AND pg_has_role(p_role::text, privileged.oid, 'member')
  ) THEN
    RAISE EXCEPTION 'mcp_runtime_role_inherits_privilege:%', p_role;
  END IF;

  EXECUTE format('REVOKE ALL ON SCHEMA mcp FROM %I', p_role);
  EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA mcp FROM %I', p_role);
  EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA mcp FROM %I', p_role);
  EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA mcp FROM %I', p_role);

  EXECUTE format('GRANT USAGE ON SCHEMA mcp TO %I', p_role);
  EXECUTE format(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE '
    'mcp.mcp_routes, mcp.mcp_route_customers, mcp.mcp_route_sessions, '
    'mcp.mcp_session_customers, mcp.mcp_visits, mcp.mcp_followups, '
    'mcp.mcp_session_reports, mcp.market_reports, '
    'mcp.mcp_report_setting_groups, mcp.mcp_report_settings, '
    'mcp.mcp_report_templates, mcp.mcp_outlet_media, '
    'mcp.mcp_storage_delete_jobs, mcp.mcp_archive_intents, '
    'mcp.orders, mcp.order_items, mcp.test_files, '
    'mcp.test_file_products, mcp.test_customers, mcp.test_customer_results TO %I',
    p_role
  );
  EXECUTE format(
    'GRANT SELECT ON TABLE mcp.accounts, mcp.products, '
    'mcp.product_variants, mcp.route_customers TO %I',
    p_role
  );
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE mcp.idempotency_records TO %I', p_role);
  EXECUTE format('GRANT INSERT ON TABLE mcp.audit_events TO %I', p_role);
  EXECUTE format('GRANT INSERT ON TABLE mcp.outbox_events TO %I', p_role);

  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA mcp REVOKE ALL ON TABLES FROM %I', p_role);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA mcp REVOKE ALL ON SEQUENCES FROM %I', p_role);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA mcp REVOKE ALL ON FUNCTIONS FROM %I', p_role);
  EXECUTE format('ALTER ROLE %I IN DATABASE %I SET search_path = mcp, public', p_role, current_database());
END;
$function$;

REVOKE ALL ON FUNCTION mcp.sync_route_session_visited_customers() FROM PUBLIC;
REVOKE ALL ON FUNCTION mcp.enforce_outlet_media_limit() FROM PUBLIC;
REVOKE ALL ON FUNCTION shared.grant_mcp_runtime_access(name) FROM PUBLIC;
