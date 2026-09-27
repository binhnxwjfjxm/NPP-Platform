-- Restore the customer-media boundary after the shared gallery was introduced.
-- MCP runtime keeps least privilege: it reads provider-safe shared data through MCP-owned
-- views, while shared gallery writes happen only inside the existing SECURITY DEFINER trigger.

CREATE OR REPLACE VIEW mcp.customer_addresses AS
SELECT
  address.id,
  address.installation_id,
  address.customer_id,
  address.label,
  address.address_line1,
  address.location_url,
  address.is_default,
  address.is_active,
  address.created_at,
  address.updated_at
FROM shared.customer_addresses AS address;

CREATE OR REPLACE VIEW mcp.customer_media AS
SELECT
  media.id,
  media.installation_id,
  media.customer_id,
  media.source_app,
  media.source_media_id,
  media.source_route_customer_id,
  media.source_session_id,
  media.client_upload_id,
  media.object_key,
  media.mime_type,
  media.expected_byte_size,
  media.actual_byte_size,
  media.width,
  media.height,
  media.etag,
  media.status,
  media.captured_by,
  media.captured_at,
  media.created_at,
  media.updated_at
FROM shared.customer_media AS media;

REVOKE ALL ON TABLE mcp.customer_addresses FROM PUBLIC;
REVOKE ALL ON TABLE mcp.customer_media FROM PUBLIC;

CREATE OR REPLACE FUNCTION mcp.sync_outlet_media_shared_registry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_core_customer_id text;
  v_customer_id uuid;
  v_customer_active boolean;
  v_active_count integer := 0;
  v_changed integer := 0;
  v_actor text;
BEGIN
  v_actor := COALESCE(NULLIF(NEW.captured_by, ''), 'service:mcp:media-bridge');

  SELECT route_customer.core_customer_id
    INTO v_core_customer_id
    FROM mcp.mcp_route_customers AS route_customer
   WHERE route_customer.installation_id = NEW.installation_id
     AND route_customer.id = NEW.route_customer_id
   LIMIT 1;

  IF NEW.status = 'pending' AND v_core_customer_id IS NOT NULL THEN
    SELECT customer.id, customer.is_active
      INTO v_customer_id, v_customer_active
      FROM shared.customers AS customer
     WHERE customer.installation_id = NEW.installation_id
       AND customer.id::text = v_core_customer_id
     FOR UPDATE;

    IF v_customer_id IS NULL THEN
      RAISE EXCEPTION 'linked_customer_not_found' USING ERRCODE = '23514';
    END IF;
    IF v_customer_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'linked_customer_inactive' USING ERRCODE = '23514';
    END IF;

    SELECT count(*)::integer
      INTO v_active_count
      FROM shared.customer_media AS media
     WHERE media.installation_id = NEW.installation_id
       AND media.customer_id = v_customer_id
       AND media.status IN ('pending', 'ready')
       AND NOT (media.source_app = 'MCP' AND media.source_media_id = NEW.id);

    IF v_active_count >= 3 THEN
      RAISE EXCEPTION 'outlet_media_limit_reached' USING ERRCODE = '23514';
    END IF;

    INSERT INTO shared.customer_media (
      id, installation_id, customer_id, source_app, source_media_id,
      source_route_customer_id, source_session_id, client_upload_id,
      object_key, mime_type, expected_byte_size, status,
      captured_by, captured_at, created_at, updated_at, created_by, updated_by
    ) VALUES (
      gen_random_uuid(), NEW.installation_id, v_customer_id, 'MCP', NEW.id,
      NEW.route_customer_id, NEW.session_id, NEW.client_upload_id,
      NEW.object_key, NEW.mime_type, NEW.expected_byte_size, 'pending',
      v_actor, COALESCE(NEW.captured_at, now()),
      COALESCE(NEW.created_at, now()), COALESCE(NEW.updated_at, now()),
      v_actor, v_actor
    )
    ON CONFLICT DO NOTHING;

  ELSIF NEW.status = 'ready' THEN
    UPDATE shared.customer_media
       SET actual_byte_size = NEW.actual_byte_size,
           width = NEW.width,
           height = NEW.height,
           etag = NEW.etag,
           status = 'ready',
           captured_by = COALESCE(NULLIF(NEW.captured_by, ''), captured_by),
           captured_at = COALESCE(NEW.captured_at, captured_at, now()),
           updated_at = now(),
           updated_by = v_actor
     WHERE installation_id = NEW.installation_id
       AND source_app = 'MCP'
       AND source_media_id = NEW.id
       AND status IN ('pending', 'ready');

    GET DIAGNOSTICS v_changed = ROW_COUNT;
    IF v_changed = 0 THEN
      PERFORM mcp.sync_route_customer_media_to_shared(NEW.route_customer_id);
    END IF;

  ELSIF NEW.status = 'deleted' THEN
    UPDATE shared.customer_media
       SET status = 'deleted',
           updated_at = now(),
           updated_by = v_actor
     WHERE installation_id = NEW.installation_id
       AND source_app = 'MCP'
       AND source_media_id = NEW.id
       AND status <> 'deleted';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION mcp.sync_outlet_media_shared_registry() FROM PUBLIC;

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
    'mcp.product_variants, mcp.route_customers, '
    'mcp.workforce_employees, mcp.customer_addresses, mcp.customer_media TO %I',
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

REVOKE ALL ON FUNCTION shared.grant_mcp_runtime_access(name) FROM PUBLIC;
