CREATE TABLE IF NOT EXISTS mcp.legacy_read_rows (
  installation_id text NOT NULL,
  table_name text NOT NULL,
  row_key text NOT NULL,
  row_data jsonb NOT NULL,
  source_system text NOT NULL DEFAULT 'legacy-unavailable',
  source_updated_at timestamptz,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, table_name, row_key),
  CONSTRAINT mcp_legacy_read_rows_table_name
    CHECK (table_name IN (
      'accounts',
      'market_reports',
      'mcp_followups',
      'mcp_report_setting_groups',
      'mcp_report_settings',
      'mcp_route_customers',
      'mcp_route_sessions',
      'mcp_routes',
      'mcp_session_customers',
      'mcp_session_reports',
      'mcp_visits',
      'order_items',
      'orders',
      'product_variants',
      'products',
      'route_customers',
      'test_customer_results',
      'test_customers',
      'test_file_products',
      'test_files'
    )),
  CONSTRAINT mcp_legacy_read_rows_object_payload
    CHECK (jsonb_typeof(row_data) = 'object')
);

CREATE INDEX IF NOT EXISTS mcp_legacy_read_rows_table_imported_idx
  ON mcp.legacy_read_rows (installation_id, table_name, imported_at DESC);

CREATE INDEX IF NOT EXISTS mcp_legacy_read_rows_payload_gin_idx
  ON mcp.legacy_read_rows USING gin (row_data jsonb_path_ops);

REVOKE ALL ON mcp.legacy_read_rows FROM PUBLIC;
