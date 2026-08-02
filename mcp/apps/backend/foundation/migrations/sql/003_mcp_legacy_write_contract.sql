CREATE SCHEMA IF NOT EXISTS mcp;

ALTER TABLE mcp.market_reports
  ADD COLUMN IF NOT EXISTS report_type text,
  ADD COLUMN IF NOT EXISTS content text,
  ADD COLUMN IF NOT EXISTS display_summary text,
  ADD COLUMN IF NOT EXISTS stock_summary text,
  ADD COLUMN IF NOT EXISTS selected_competitor_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS selected_used_product_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS selected_setting_item_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS mcp.mcp_report_templates (
  id text PRIMARY KEY DEFAULT ('report_template_' || replace(gen_random_uuid()::text, '-', '')),
  installation_id text,
  title text NOT NULL,
  report_type text NOT NULL DEFAULT 'market_report',
  scope_type text NOT NULL DEFAULT 'global',
  content text NOT NULL DEFAULT '',
  price_summary text NOT NULL DEFAULT '',
  competitor_summary text NOT NULL DEFAULT '',
  display_summary text NOT NULL DEFAULT '',
  stock_summary text NOT NULL DEFAULT '',
  demand_summary text NOT NULL DEFAULT '',
  opportunity_summary text NOT NULL DEFAULT '',
  risk_summary text NOT NULL DEFAULT '',
  next_action text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  note text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mcp.mcp_outlet_media (
  id text PRIMARY KEY DEFAULT ('mom_' || replace(gen_random_uuid()::text, '-', '')),
  installation_id text NOT NULL,
  route_customer_id text NOT NULL REFERENCES mcp.mcp_route_customers(id) ON DELETE CASCADE,
  session_id text NOT NULL REFERENCES mcp.mcp_route_sessions(id) ON DELETE CASCADE,
  object_key text NOT NULL UNIQUE,
  media_type text NOT NULL DEFAULT 'storefront' CHECK (media_type IN ('storefront')),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/webp', 'image/png')),
  expected_byte_size bigint NOT NULL CHECK (expected_byte_size > 0 AND expected_byte_size <= 5242880),
  actual_byte_size bigint,
  width integer,
  height integer,
  etag text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ready', 'failed', 'deleting', 'delete_failed', 'deleted')),
  client_upload_id text NOT NULL,
  captured_by text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  geo_lat double precision,
  geo_lng double precision,
  geo_accuracy double precision,
  delete_requested_at timestamptz,
  deleted_at timestamptz,
  delete_attempt_count integer NOT NULL DEFAULT 0,
  last_delete_error text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (installation_id, client_upload_id),
  CHECK ((geo_lat IS NULL AND geo_lng IS NULL) OR (geo_lat BETWEEN -90 AND 90 AND geo_lng BETWEEN -180 AND 180)),
  CHECK (geo_accuracy IS NULL OR geo_accuracy >= 0)
);

CREATE TABLE IF NOT EXISTS mcp.mcp_storage_delete_jobs (
  id text PRIMARY KEY DEFAULT ('msdj_' || replace(gen_random_uuid()::text, '-', '')),
  installation_id text NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('route_customer', 'route')),
  target_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'finalizing', 'failed', 'completed')),
  requested_by text,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (installation_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS mcp.mcp_archive_intents (
  id text PRIMARY KEY DEFAULT ('mai_' || replace(gen_random_uuid()::text, '-', '')),
  installation_id text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('route.archive', 'route-customer.archive')),
  idempotency_key text NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('route', 'route_customer')),
  target_id text NOT NULL,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_hash text NOT NULL,
  delete_job_id text REFERENCES mcp.mcp_storage_delete_jobs(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'failed', 'completed')),
  response_status integer,
  response_payload jsonb,
  last_error text,
  attempt_count integer NOT NULL DEFAULT 0,
  requested_by text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (installation_id, operation, idempotency_key),
  UNIQUE (installation_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS mcp_report_templates_status_sort_idx
  ON mcp.mcp_report_templates (status, sort_order, title);
CREATE INDEX IF NOT EXISTS mcp_outlet_media_route_customer_idx
  ON mcp.mcp_outlet_media (route_customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mcp_outlet_media_session_idx
  ON mcp.mcp_outlet_media (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mcp_outlet_media_pending_idx
  ON mcp.mcp_outlet_media (status, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS mcp_outlet_media_delete_retry_idx
  ON mcp.mcp_outlet_media (status, updated_at) WHERE status IN ('deleting', 'delete_failed');
CREATE INDEX IF NOT EXISTS mcp_storage_delete_jobs_ready_idx
  ON mcp.mcp_storage_delete_jobs (installation_id, status, updated_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS mcp_archive_intents_status_idx
  ON mcp.mcp_archive_intents (installation_id, status, updated_at)
  WHERE status IN ('pending', 'processing', 'failed');

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
      OR privileged.rolname IN ('pg_read_all_data', 'pg_write_all_data')
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

REVOKE ALL ON FUNCTION shared.grant_mcp_runtime_access(name) FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA mcp FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA mcp FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA mcp FROM PUBLIC;
