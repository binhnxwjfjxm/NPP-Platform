-- MCP orders may be created directly for an existing canonical Công Ty customer.
-- source_employee_id remains the trusted employee provenance; source_outlet_id is optional field-outlet provenance.

ALTER TABLE sales.sales_orders
  DROP CONSTRAINT IF EXISTS sales_orders_source_shape_check;

ALTER TABLE sales.sales_orders
  ADD CONSTRAINT sales_orders_source_shape_check CHECK (
    (source_type = 'MANUAL' AND source_id IS NULL AND source_outlet_id IS NULL)
    OR (source_type IN ('IMPORT', 'API') AND source_id IS NOT NULL AND source_outlet_id IS NULL)
    OR (source_type = 'MCP' AND source_id IS NOT NULL)
  );

COMMENT ON COLUMN sales.sales_orders.source_outlet_id IS
  'Optional MCP field-outlet provenance. NULL when an MCP order is created directly for an existing canonical Công Ty customer without a linked field outlet.';
