-- Issue #791 Lô D: allow one SKU to occupy multiple independent Sales Order lines.
-- Line identity stays sales_order_version_lines.id; variant_id remains product identity only.

ALTER TABLE sales.sales_order_version_lines
  DROP CONSTRAINT IF EXISTS sales_order_version_lines_variant_unique;

CREATE INDEX IF NOT EXISTS sales_order_version_lines_version_variant_line_idx
  ON sales.sales_order_version_lines (
    installation_id,
    sales_order_version_id,
    variant_id,
    line_number
  );
