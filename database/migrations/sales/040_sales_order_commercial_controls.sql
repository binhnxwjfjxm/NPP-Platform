-- Phase 6B.2: Sales Order channel, price provenance and document discount intent.
-- Forward-only, rerun-safe. Existing commercial history is not fabricated or rewritten.

ALTER TABLE shared.sales_order_settings
  ADD COLUMN IF NOT EXISTS default_sales_channel_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_order_settings_default_channel_fk'
      AND conrelid = 'shared.sales_order_settings'::regclass
  ) THEN
    ALTER TABLE shared.sales_order_settings
      ADD CONSTRAINT sales_order_settings_default_channel_fk
      FOREIGN KEY (installation_id, default_sales_channel_id)
      REFERENCES shared.sales_channels (installation_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE sales.sales_orders
  ADD COLUMN IF NOT EXISTS sales_channel_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_orders_sales_channel_fk'
      AND conrelid = 'sales.sales_orders'::regclass
  ) THEN
    ALTER TABLE sales.sales_orders
      ADD CONSTRAINT sales_orders_sales_channel_fk
      FOREIGN KEY (installation_id, sales_channel_id)
      REFERENCES shared.sales_channels (installation_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS sales_orders_channel_idx
  ON sales.sales_orders (installation_id, sales_channel_id, updated_at DESC)
  WHERE sales_channel_id IS NOT NULL;

ALTER TABLE sales.sales_order_versions
  ADD COLUMN IF NOT EXISTS sales_channel_id uuid NULL,
  ADD COLUMN IF NOT EXISTS sales_channel_code_snapshot text NULL,
  ADD COLUMN IF NOT EXISTS sales_channel_name_snapshot text NULL,
  ADD COLUMN IF NOT EXISTS document_discount_mode text NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS document_discount_value numeric(24,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS document_discount_reason text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_order_versions_sales_channel_fk'
      AND conrelid = 'sales.sales_order_versions'::regclass
  ) THEN
    ALTER TABLE sales.sales_order_versions
      ADD CONSTRAINT sales_order_versions_sales_channel_fk
      FOREIGN KEY (installation_id, sales_channel_id)
      REFERENCES shared.sales_channels (installation_id, id)
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_order_versions_channel_snapshot_shape_check'
      AND conrelid = 'sales.sales_order_versions'::regclass
  ) THEN
    ALTER TABLE sales.sales_order_versions
      ADD CONSTRAINT sales_order_versions_channel_snapshot_shape_check
      CHECK (
        (sales_channel_id IS NULL
          AND sales_channel_code_snapshot IS NULL
          AND sales_channel_name_snapshot IS NULL)
        OR
        (sales_channel_id IS NOT NULL
          AND sales_channel_code_snapshot IS NOT NULL
          AND char_length(btrim(sales_channel_code_snapshot)) BETWEEN 1 AND 64
          AND sales_channel_name_snapshot IS NOT NULL
          AND char_length(btrim(sales_channel_name_snapshot)) BETWEEN 1 AND 256)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_order_versions_document_discount_mode_check'
      AND conrelid = 'sales.sales_order_versions'::regclass
  ) THEN
    ALTER TABLE sales.sales_order_versions
      ADD CONSTRAINT sales_order_versions_document_discount_mode_check
      CHECK (document_discount_mode IN ('NONE', 'PERCENT', 'TOTAL_AMOUNT'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_order_versions_document_discount_value_check'
      AND conrelid = 'sales.sales_order_versions'::regclass
  ) THEN
    ALTER TABLE sales.sales_order_versions
      ADD CONSTRAINT sales_order_versions_document_discount_value_check
      CHECK (
        document_discount_value >= 0
        AND (document_discount_mode <> 'PERCENT' OR document_discount_value <= 100)
        AND (document_discount_mode <> 'NONE' OR document_discount_value = 0)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_order_versions_document_discount_reason_check'
      AND conrelid = 'sales.sales_order_versions'::regclass
  ) THEN
    ALTER TABLE sales.sales_order_versions
      ADD CONSTRAINT sales_order_versions_document_discount_reason_check
      CHECK (
        (document_discount_value = 0 AND document_discount_reason IS NULL)
        OR
        (document_discount_value > 0
          AND document_discount_reason IS NOT NULL
          AND char_length(btrim(document_discount_reason)) BETWEEN 1 AND 1000)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS sales_order_versions_channel_idx
  ON sales.sales_order_versions (installation_id, sales_channel_id, sales_order_id, version_number)
  WHERE sales_channel_id IS NOT NULL;

ALTER TABLE sales.sales_order_version_lines
  ADD COLUMN IF NOT EXISTS base_unit_price numeric(24,0) NULL,
  ADD COLUMN IF NOT EXISTS system_unit_price numeric(24,0) NULL,
  ADD COLUMN IF NOT EXISTS manual_override_reason text NULL,
  ADD COLUMN IF NOT EXISTS pricing_trace_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE sales.sales_order_version_lines
SET
  base_unit_price = COALESCE(base_unit_price, unit_price),
  system_unit_price = COALESCE(system_unit_price, unit_price)
WHERE base_unit_price IS NULL OR system_unit_price IS NULL;

ALTER TABLE sales.sales_order_version_lines
  ALTER COLUMN base_unit_price SET NOT NULL,
  ALTER COLUMN system_unit_price SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_order_version_lines_price_provenance_check'
      AND conrelid = 'sales.sales_order_version_lines'::regclass
  ) THEN
    ALTER TABLE sales.sales_order_version_lines
      ADD CONSTRAINT sales_order_version_lines_price_provenance_check
      CHECK (
        base_unit_price >= 0
        AND system_unit_price >= 0
        AND unit_price >= 0
        AND (
          (price_source = 'MANUAL_OVERRIDE'
            AND manual_override_reason IS NOT NULL
            AND char_length(btrim(manual_override_reason)) BETWEEN 1 AND 500)
          OR
          (price_source <> 'MANUAL_OVERRIDE' AND manual_override_reason IS NULL)
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_order_version_lines_pricing_trace_array_check'
      AND conrelid = 'sales.sales_order_version_lines'::regclass
  ) THEN
    ALTER TABLE sales.sales_order_version_lines
      ADD CONSTRAINT sales_order_version_lines_pricing_trace_array_check
      CHECK (jsonb_typeof(pricing_trace_snapshot) = 'array');
  END IF;
END $$;

INSERT INTO shared.permissions (permission_key, description)
VALUES (
  'core.sales-order.discount.override',
  'Apply a reasoned supplemental document discount to a Sales Order'
)
ON CONFLICT (permission_key) DO UPDATE
SET description = EXCLUDED.description;
