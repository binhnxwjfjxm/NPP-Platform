CREATE SCHEMA IF NOT EXISTS mcp;

REVOKE ALL ON SCHEMA mcp FROM PUBLIC;

CREATE TABLE IF NOT EXISTS mcp.mcp_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid,
  distributor_id text,
  route_code text,
  route_name text NOT NULL,
  area text,
  weekday smallint,
  sales text,
  active boolean NOT NULL DEFAULT true,
  note text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mcp_routes_weekday_check CHECK (weekday IS NULL OR weekday BETWEEN 0 AND 6)
);

CREATE TABLE IF NOT EXISTS mcp.mcp_route_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid,
  route_id uuid NOT NULL REFERENCES mcp.mcp_routes(id) ON DELETE CASCADE,
  customer_id uuid,
  customer_name text NOT NULL,
  phone text,
  area text,
  address text,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  note text,
  geo_lat numeric,
  geo_lng numeric,
  geo_accuracy numeric,
  geo_captured_at timestamptz,
  geo_source text,
  google_maps_url text,
  sync_status text NOT NULL DEFAULT 'pending',
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mcp.mcp_route_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid,
  route_id uuid NOT NULL REFERENCES mcp.mcp_routes(id) ON DELETE RESTRICT,
  route_name text NOT NULL,
  session_date date NOT NULL,
  sales text,
  area text,
  status text NOT NULL DEFAULT 'active',
  planned_customers integer NOT NULL DEFAULT 0,
  visited_customers integer NOT NULL DEFAULT 0,
  order_count integer NOT NULL DEFAULT 0,
  test_count integer NOT NULL DEFAULT 0,
  report_count integer NOT NULL DEFAULT 0,
  followup_count integer NOT NULL DEFAULT 0,
  note text,
  opened_at timestamptz,
  closed_at timestamptz,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mcp.mcp_session_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid,
  session_id uuid NOT NULL REFERENCES mcp.mcp_route_sessions(id) ON DELETE CASCADE,
  route_id uuid NOT NULL REFERENCES mcp.mcp_routes(id) ON DELETE RESTRICT,
  route_customer_id uuid REFERENCES mcp.mcp_route_customers(id) ON DELETE SET NULL,
  customer_id uuid,
  customer_name text NOT NULL,
  phone text,
  area text,
  address text,
  sort_order integer NOT NULL DEFAULT 0,
  visit_status text NOT NULL DEFAULT 'pending',
  status_reason text,
  order_id uuid,
  test_id uuid,
  report_id uuid,
  followup_count integer NOT NULL DEFAULT 0,
  checked_in boolean NOT NULL DEFAULT false,
  checkin_at timestamptz,
  checkin_lat numeric,
  checkin_lng numeric,
  checkin_accuracy numeric,
  checkin_source text,
  note text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mcp.mcp_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid,
  session_id uuid REFERENCES mcp.mcp_route_sessions(id) ON DELETE SET NULL,
  session_customer_id uuid REFERENCES mcp.mcp_session_customers(id) ON DELETE SET NULL,
  route_id uuid REFERENCES mcp.mcp_routes(id) ON DELETE SET NULL,
  route_customer_id uuid REFERENCES mcp.mcp_route_customers(id) ON DELETE SET NULL,
  customer_id uuid,
  customer_name text,
  visit_date date,
  status text NOT NULL DEFAULT 'pending',
  checkin_at timestamptz,
  checkout_at timestamptz,
  geo_lat numeric,
  geo_lng numeric,
  geo_accuracy numeric,
  geo_source text,
  note text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mcp.mcp_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid,
  session_id uuid REFERENCES mcp.mcp_route_sessions(id) ON DELETE SET NULL,
  session_customer_id uuid REFERENCES mcp.mcp_session_customers(id) ON DELETE SET NULL,
  visit_id uuid REFERENCES mcp.mcp_visits(id) ON DELETE SET NULL,
  route_id uuid REFERENCES mcp.mcp_routes(id) ON DELETE SET NULL,
  route_customer_id uuid REFERENCES mcp.mcp_route_customers(id) ON DELETE SET NULL,
  customer_id uuid,
  customer_name text,
  followup_type text,
  title text,
  due_date date,
  status text NOT NULL DEFAULT 'pending',
  priority text,
  owner text,
  note text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mcp.mcp_session_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid,
  session_id uuid NOT NULL REFERENCES mcp.mcp_route_sessions(id) ON DELETE CASCADE,
  route_id uuid REFERENCES mcp.mcp_routes(id) ON DELETE SET NULL,
  route_name text,
  session_date date,
  sales text,
  status text NOT NULL DEFAULT 'draft',
  schema_version text NOT NULL DEFAULT '1',
  kpis jsonb NOT NULL DEFAULT '[]'::jsonb,
  overview jsonb NOT NULL DEFAULT '{}'::jsonb,
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  customer_details jsonb NOT NULL DEFAULT '[]'::jsonb,
  insights jsonb NOT NULL DEFAULT '[]'::jsonb,
  score numeric,
  health text,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_prompt_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_analyzed_at timestamptz,
  summary_text text,
  snapshot_source text,
  snapshot_at timestamptz,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mcp.market_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid,
  report_date date NOT NULL DEFAULT current_date,
  sales text,
  market_area text,
  route_name text,
  market_type text,
  total_shops integer NOT NULL DEFAULT 0,
  competitor_summary text,
  price_summary text,
  demand_summary text,
  company_product_summary text,
  opportunity_summary text,
  risk_summary text,
  next_action text,
  note text,
  sync_status text NOT NULL DEFAULT 'pending',
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mcp.mcp_report_setting_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid,
  group_key text NOT NULL,
  group_name text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mcp_report_setting_groups_key_unique UNIQUE (installation_id, group_key)
);

CREATE TABLE IF NOT EXISTS mcp.mcp_report_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid,
  group_id uuid REFERENCES mcp.mcp_report_setting_groups(id) ON DELETE SET NULL,
  setting_key text NOT NULL,
  setting_name text NOT NULL,
  value jsonb NOT NULL DEFAULT 'null'::jsonb,
  value_type text NOT NULL DEFAULT 'text',
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  required boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mcp_report_settings_key_unique UNIQUE (installation_id, setting_key)
);

CREATE TABLE IF NOT EXISTS mcp.test_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid,
  title text NOT NULL,
  test_date date NOT NULL DEFAULT current_date,
  sales text,
  status text NOT NULL DEFAULT 'draft',
  note text,
  sync_status text NOT NULL DEFAULT 'pending',
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mcp.test_file_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid,
  file_id uuid NOT NULL REFERENCES mcp.test_files(id) ON DELETE CASCADE,
  product_id uuid,
  product_name text,
  sort_order integer NOT NULL DEFAULT 0,
  note text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mcp.test_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid,
  file_id uuid NOT NULL REFERENCES mcp.test_files(id) ON DELETE CASCADE,
  customer_id uuid,
  customer_name text NOT NULL,
  phone text,
  area text,
  status text NOT NULL DEFAULT 'pending',
  note text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mcp.test_customer_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id uuid,
  file_id uuid NOT NULL REFERENCES mcp.test_files(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES mcp.test_customers(id) ON DELETE CASCADE,
  product_id uuid,
  product_name text,
  status text NOT NULL DEFAULT 'pending',
  note text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_routes_active_name_idx
  ON mcp.mcp_routes (active, route_name);
CREATE INDEX IF NOT EXISTS mcp_route_customers_route_sort_idx
  ON mcp.mcp_route_customers (route_id, sort_order, id);
CREATE INDEX IF NOT EXISTS mcp_route_customers_customer_idx
  ON mcp.mcp_route_customers (customer_id);
CREATE INDEX IF NOT EXISTS mcp_route_sessions_route_date_idx
  ON mcp.mcp_route_sessions (route_id, session_date DESC, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS mcp_route_sessions_one_active_idx
  ON mcp.mcp_route_sessions (route_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS mcp_session_customers_session_sort_idx
  ON mcp.mcp_session_customers (session_id, sort_order, id);
CREATE INDEX IF NOT EXISTS mcp_visits_session_customer_idx
  ON mcp.mcp_visits (session_customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mcp_followups_due_status_idx
  ON mcp.mcp_followups (status, due_date, created_at DESC);
CREATE INDEX IF NOT EXISTS mcp_session_reports_session_idx
  ON mcp.mcp_session_reports (session_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS market_reports_date_idx
  ON mcp.market_reports (report_date DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS test_customers_file_idx
  ON mcp.test_customers (file_id, created_at, id);
CREATE INDEX IF NOT EXISTS test_customer_results_file_customer_idx
  ON mcp.test_customer_results (file_id, customer_id, created_at, id);

CREATE OR REPLACE VIEW mcp.accounts AS
SELECT
  c.id,
  c.installation_id,
  c.customer_code,
  c.legal_name,
  c.trading_name,
  COALESCE(NULLIF(c.trading_name, ''), c.legal_name) AS name,
  COALESCE(NULLIF(c.trading_name, ''), c.legal_name) AS account_name,
  c.phone,
  c.email,
  c.sales_region AS area,
  c.address,
  c.status,
  (c.status = 'active') AS active,
  c.sales_owner,
  c.notes AS note,
  jsonb_build_object(
    'customer_code', c.customer_code,
    'tax_code', c.tax_code,
    'credit_limit', c.credit_limit,
    'payment_term_days', c.payment_term_days,
    'price_list_id', c.price_list_id
  ) AS raw_payload,
  c.created_at,
  c.updated_at
FROM shared.customers c;

CREATE OR REPLACE VIEW mcp.products AS
SELECT
  p.id,
  p.installation_id,
  p.name,
  p.product_code,
  p.brand AS brand_code,
  p.brand AS brand_name,
  p.category,
  p.is_active AS active,
  jsonb_build_object(
    'description', p.description,
    'base_uom', p.base_uom,
    'purchase_uom', p.purchase_uom,
    'sales_uom', p.sales_uom,
    'tax_rate', p.tax_rate,
    'track_lot', p.track_lot,
    'track_expiry', p.track_expiry,
    'is_stock_item', p.is_stock_item,
    'is_service_item', p.is_service_item
  ) AS raw_payload,
  p.created_at,
  p.updated_at
FROM shared.products p;

CREATE OR REPLACE VIEW mcp.product_variants AS
SELECT
  v.id,
  v.installation_id,
  v.product_id,
  v.sku,
  v.variant_name,
  v.size_label,
  v.sell_unit,
  v.pack_unit,
  v.pack_quantity,
  v.is_active AS active,
  '{}'::jsonb AS raw_options,
  jsonb_build_object('is_active', v.is_active) AS raw_payload,
  v.created_at,
  v.updated_at
FROM shared.product_variants v;

CREATE OR REPLACE VIEW mcp.orders AS
SELECT
  o.id,
  o.installation_id,
  o.document_number AS order_code,
  o.order_date,
  COALESCE(NULLIF(c.sales_owner, ''), o.created_by::text) AS sales,
  o.customer_id,
  COALESCE(NULLIF(c.trading_name, ''), c.legal_name, 'Khách hàng chưa xác định') AS customer_name,
  c.phone AS customer_phone,
  c.sales_region AS area,
  c.address AS delivery_address,
  'core_sales_order'::text AS source_type,
  o.id AS source_id,
  o.status,
  o.subtotal,
  o.discount_total,
  o.total_amount AS grand_total,
  o.notes AS note,
  'synced'::text AS sync_status,
  jsonb_build_object(
    'currency', o.currency,
    'tax_total', o.tax_total,
    'version', o.version,
    'approved_at', o.approved_at,
    'confirmed_at', o.confirmed_at,
    'cancelled_at', o.cancelled_at,
    'cancelled_reason', o.cancelled_reason
  ) AS raw_payload,
  o.created_at,
  o.updated_at
FROM sales.orders o
LEFT JOIN shared.customers c ON c.id = o.customer_id;

CREATE OR REPLACE VIEW mcp.order_items AS
SELECT
  l.id,
  l.sales_order_id AS order_id,
  l.product_id,
  NULL::uuid AS variant_id,
  COALESCE(NULLIF(p.name, ''), NULLIF(l.description, ''), l.product_code) AS product_name,
  l.product_code AS sku,
  p.sales_uom AS unit,
  l.ordered_qty AS quantity,
  l.unit_price,
  l.discount_amount AS discount,
  l.line_total,
  NULL::text AS note,
  jsonb_build_object(
    'line_number', l.line_number,
    'discount_rate', l.discount_rate,
    'tax_rate', l.tax_rate,
    'tax_amount', l.tax_amount,
    'line_subtotal', l.line_subtotal
  ) AS raw_payload,
  l.created_at,
  l.updated_at
FROM sales.order_lines l
LEFT JOIN shared.products p ON p.id = l.product_id;

CREATE OR REPLACE VIEW mcp.route_customers AS
SELECT
  id,
  installation_id,
  route_id,
  customer_id,
  customer_name,
  phone,
  area,
  address,
  sort_order,
  active,
  note,
  geo_lat,
  geo_lng,
  geo_accuracy,
  geo_captured_at,
  geo_source,
  google_maps_url,
  sync_status,
  raw_payload,
  created_at,
  updated_at
FROM mcp.mcp_route_customers;

CREATE OR REPLACE FUNCTION shared.grant_mcp_runtime_access(p_role name)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = p_role::text) THEN
    RAISE EXCEPTION 'mcp_runtime_role_not_found:%', p_role;
  END IF;

  EXECUTE format('GRANT USAGE ON SCHEMA mcp TO %I', p_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA mcp TO %I', p_role);
  EXECUTE format('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA mcp TO %I', p_role);
  EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA mcp TO %I', p_role);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA mcp GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', p_role);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA mcp GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %I', p_role);
  EXECUTE format('ALTER ROLE %I IN DATABASE %I SET search_path = mcp, public', p_role, current_database());
END;
$function$;

REVOKE ALL ON ALL TABLES IN SCHEMA mcp FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA mcp FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA mcp FROM PUBLIC;
