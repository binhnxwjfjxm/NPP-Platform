-- Keep MCP runtime least-privilege after VPS cutover: expose only the employee/address
-- fields needed by customer and route authorization through MCP-owned read models.

CREATE OR REPLACE VIEW mcp.workforce_employees AS
SELECT
  employee.id,
  employee.installation_id,
  employee.code,
  employee.full_name,
  employee.is_active
FROM shared.employees AS employee;

CREATE OR REPLACE VIEW mcp.customer_addresses AS
SELECT
  address.id,
  address.installation_id,
  address.customer_id,
  address.label,
  address.address_line1,
  address.is_default,
  address.is_active,
  address.created_at,
  address.updated_at
FROM shared.customer_addresses AS address;

REVOKE ALL ON TABLE mcp.workforce_employees FROM PUBLIC;
REVOKE ALL ON TABLE mcp.customer_addresses FROM PUBLIC;

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
    'mcp.workforce_employees, mcp.customer_addresses TO %I',
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
