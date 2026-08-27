-- Issue #791 / Lô H — canonical SKU weight and immutable Sales Order weight snapshots.
-- Weight is intentionally separate from net_content_* because net content may be volume/count.

ALTER TABLE shared.product_variants
  ADD COLUMN IF NOT EXISTS weight_value numeric(20,6),
  ADD COLUMN IF NOT EXISTS weight_uom_code text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_weight_pair_check') THEN
    ALTER TABLE shared.product_variants
      ADD CONSTRAINT product_variants_weight_pair_check
      CHECK ((weight_value IS NULL AND weight_uom_code IS NULL)
          OR (weight_value IS NOT NULL AND weight_uom_code IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_weight_value_check') THEN
    ALTER TABLE shared.product_variants
      ADD CONSTRAINT product_variants_weight_value_check
      CHECK (weight_value IS NULL OR weight_value > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_weight_uom_check') THEN
    ALTER TABLE shared.product_variants
      ADD CONSTRAINT product_variants_weight_uom_check
      CHECK (weight_uom_code IS NULL OR weight_uom_code IN ('G', 'KG'));
  END IF;
END $$;

COMMENT ON COLUMN shared.product_variants.weight_value IS
  'Canonical shipment weight value for this SKU. Nullable for legacy SKUs with unknown weight.';
COMMENT ON COLUMN shared.product_variants.weight_uom_code IS
  'Shipment weight unit for weight_value. Supported values: G, KG.';

ALTER TABLE sales.sales_order_version_lines
  ADD COLUMN IF NOT EXISTS unit_weight_kg numeric(24,9),
  ADD COLUMN IF NOT EXISTS line_weight_kg numeric(37,9);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_order_version_lines_weight_pair_check') THEN
    ALTER TABLE sales.sales_order_version_lines
      ADD CONSTRAINT sales_order_version_lines_weight_pair_check
      CHECK ((unit_weight_kg IS NULL AND line_weight_kg IS NULL)
          OR (unit_weight_kg IS NOT NULL AND line_weight_kg IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_order_version_lines_unit_weight_check') THEN
    ALTER TABLE sales.sales_order_version_lines
      ADD CONSTRAINT sales_order_version_lines_unit_weight_check
      CHECK (unit_weight_kg IS NULL OR unit_weight_kg > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_order_version_lines_line_weight_check') THEN
    ALTER TABLE sales.sales_order_version_lines
      ADD CONSTRAINT sales_order_version_lines_line_weight_check
      CHECK (line_weight_kg IS NULL OR line_weight_kg > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_order_version_lines_weight_reconcile_check') THEN
    ALTER TABLE sales.sales_order_version_lines
      ADD CONSTRAINT sales_order_version_lines_weight_reconcile_check
      CHECK (line_weight_kg IS NULL OR line_weight_kg = round(unit_weight_kg * ordered_quantity, 9));
  END IF;
END $$;

COMMENT ON COLUMN sales.sales_order_version_lines.unit_weight_kg IS
  'Immutable canonical KG weight snapshot for one ordered SKU unit at Sales Order version creation.';
COMMENT ON COLUMN sales.sales_order_version_lines.line_weight_kg IS
  'Immutable total KG weight snapshot for this Sales Order version line.';
