CREATE SCHEMA IF NOT EXISTS mcp;

ALTER TABLE mcp.orders
  ADD COLUMN IF NOT EXISTS core_sales_order_id uuid,
  ADD COLUMN IF NOT EXISTS core_sales_order_number text,
  ADD COLUMN IF NOT EXISTS core_sales_order_status text,
  ADD COLUMN IF NOT EXISTS core_sales_order_version bigint,
  ADD COLUMN IF NOT EXISTS core_sales_order_total numeric(20, 6),
  ADD COLUMN IF NOT EXISTS core_sales_order_currency text,
  ADD COLUMN IF NOT EXISTS core_sales_order_fingerprint char(64),
  ADD COLUMN IF NOT EXISTS core_sales_order_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS core_sales_order_last_synced_at timestamptz;

ALTER TABLE mcp.orders
  DROP CONSTRAINT IF EXISTS mcp_orders_core_sales_order_status;
ALTER TABLE mcp.orders
  ADD CONSTRAINT mcp_orders_core_sales_order_status
  CHECK (
    core_sales_order_status IS NULL
    OR core_sales_order_status IN ('draft', 'confirmed', 'cancelled', 'closed')
  );

ALTER TABLE mcp.orders
  DROP CONSTRAINT IF EXISTS mcp_orders_core_sales_order_shape;
ALTER TABLE mcp.orders
  ADD CONSTRAINT mcp_orders_core_sales_order_shape
  CHECK (
    (
      core_sales_order_id IS NULL
      AND core_sales_order_number IS NULL
      AND core_sales_order_status IS NULL
      AND core_sales_order_version IS NULL
      AND core_sales_order_total IS NULL
      AND core_sales_order_currency IS NULL
      AND core_sales_order_fingerprint IS NULL
      AND core_sales_order_submitted_at IS NULL
      AND core_sales_order_last_synced_at IS NULL
    )
    OR
    (
      core_sales_order_id IS NOT NULL
      AND core_sales_order_status IS NOT NULL
      AND core_sales_order_version IS NOT NULL
      AND core_sales_order_version > 0
      AND core_sales_order_total IS NOT NULL
      AND core_sales_order_total >= 0
      AND core_sales_order_currency = 'VND'
      AND core_sales_order_fingerprint ~ '^[0-9a-f]{64}$'
      AND core_sales_order_submitted_at IS NOT NULL
      AND core_sales_order_last_synced_at IS NOT NULL
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS mcp_orders_core_sales_order_unique
  ON mcp.orders (installation_id, core_sales_order_id)
  WHERE core_sales_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS mcp_orders_core_sales_order_status_idx
  ON mcp.orders (installation_id, core_sales_order_status, core_sales_order_last_synced_at DESC)
  WHERE core_sales_order_id IS NOT NULL;
