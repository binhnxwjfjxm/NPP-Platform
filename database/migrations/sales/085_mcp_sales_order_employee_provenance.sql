-- Lô 4: MCP Sales Order employee provenance.
-- New MCP orders persist the trusted employee from the MCP server context.
-- Historical rows are intentionally not backfilled: route ownership is not employee provenance.
-- Customer Ordering provenance remains owned by its existing portal-user contract.

ALTER TABLE sales.sales_orders
  ADD COLUMN IF NOT EXISTS source_employee_id uuid NULL;

ALTER TABLE sales.sales_order_versions
  ADD COLUMN IF NOT EXISTS source_employee_id uuid NULL;

ALTER TABLE sales.sales_orders
  ADD CONSTRAINT sales_orders_source_employee_installation_fk
    FOREIGN KEY (installation_id, source_employee_id)
    REFERENCES shared.employees (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  ADD CONSTRAINT sales_orders_source_employee_shape_check
    CHECK (source_employee_id IS NULL OR source_type = 'MCP');

ALTER TABLE sales.sales_order_versions
  ADD CONSTRAINT sales_order_versions_source_employee_installation_fk
    FOREIGN KEY (installation_id, source_employee_id)
    REFERENCES shared.employees (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  ADD CONSTRAINT sales_order_versions_source_employee_shape_check
    CHECK (source_employee_id IS NULL OR source_type = 'MCP');

CREATE INDEX IF NOT EXISTS sales_orders_source_employee_idx
  ON sales.sales_orders (installation_id, source_employee_id, created_at DESC)
  WHERE source_employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sales_order_versions_source_employee_idx
  ON sales.sales_order_versions (installation_id, source_employee_id, sales_order_id, version_number DESC)
  WHERE source_employee_id IS NOT NULL;

COMMENT ON COLUMN sales.sales_orders.source_employee_id IS
  'Trusted MCP employee provenance captured at Sales Order creation; NULL for non-MCP and historical unknown provenance.';

COMMENT ON COLUMN sales.sales_order_versions.source_employee_id IS
  'Snapshot of Sales Order source employee provenance for this version; copied from the prior version on amendment.';