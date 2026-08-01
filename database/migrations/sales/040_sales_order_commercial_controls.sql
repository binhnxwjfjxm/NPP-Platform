-- Phase 6B.2: Sales Order channel, price provenance and document discount intent.
-- Forward-only, rerun-safe. Existing commercial history is not fabricated or rewritten.

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES (
  'core.sales-order.discount.override',
  'Bán hàng',
  'Chiết khấu bổ sung toàn đơn',
  'Cho phép áp dụng chiết khấu bổ sung toàn đơn có lý do và phân bổ chính xác xuống từng dòng.',
  true,
  now()
)
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

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
  ADD COLUMN IF NOT EXISTS base_unit_price numeric(20,6) NULL,
  ADD COLUMN IF NOT EXISTS system_unit_price numeric(20,6) NULL,
  ADD COLUMN IF NOT EXISTS manual_override_reason text NULL,
  ADD COLUMN IF NOT EXISTS pricing_trace_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Migration 037 deliberately blocks line mutations once a version leaves draft.
-- This one-time provenance backfill must also cover confirmed/superseded/cancelled
-- history. ALTER TABLE takes an ACCESS EXCLUSIVE lock and the migration runner wraps
-- the file in one transaction, so temporarily disabling this single guard cannot be
-- observed by concurrent business traffic; a failure rolls the trigger state back.
ALTER TABLE sales.sales_order_version_lines
  DISABLE TRIGGER sales_order_version_lines_draft_only;

UPDATE sales.sales_order_version_lines
SET
  base_unit_price = COALESCE(base_unit_price, unit_price),
  system_unit_price = COALESCE(system_unit_price, unit_price)
WHERE base_unit_price IS NULL OR system_unit_price IS NULL;

ALTER TABLE sales.sales_order_version_lines
  ENABLE TRIGGER sales_order_version_lines_draft_only;

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
        (base_unit_price IS NULL OR base_unit_price >= 0)
        AND (system_unit_price IS NULL OR system_unit_price >= 0)
        AND unit_price >= 0
        AND (manual_override_reason IS NULL
          OR char_length(btrim(manual_override_reason)) BETWEEN 1 AND 500)
        AND (price_source = 'MANUAL_OVERRIDE' OR manual_override_reason IS NULL)
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

-- The Phase 6B legacy aggregate inserts the line and the Phase 6B.2 facade enriches
-- its price provenance later in the same transaction. Enforce the committed-state
-- invariant at transaction end so no committed line can bypass the facade.
CREATE OR REPLACE FUNCTION sales.enforce_sales_order_line_price_provenance()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  committed_line record;
BEGIN
  SELECT base_unit_price, system_unit_price
    INTO committed_line
    FROM sales.sales_order_version_lines
   WHERE installation_id = NEW.installation_id
     AND id = NEW.id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF committed_line.base_unit_price IS NULL
     OR committed_line.system_unit_price IS NULL THEN
    RAISE EXCEPTION 'sales_order_line_price_provenance_required';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS sales_order_line_price_provenance_deferred
  ON sales.sales_order_version_lines;
CREATE CONSTRAINT TRIGGER sales_order_line_price_provenance_deferred
AFTER INSERT OR UPDATE OF base_unit_price, system_unit_price
ON sales.sales_order_version_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION sales.enforce_sales_order_line_price_provenance();

-- Extend the immutable-version guard so both the Phase 6B.1 walk-in snapshots and
-- the Phase 6B.2 commercial snapshots remain immutable when a confirmed version
-- is superseded.
CREATE OR REPLACE FUNCTION sales.guard_sales_order_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.version_status <> 'draft' THEN
    RAISE EXCEPTION 'sales_order_version_locked';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.version_status <> 'draft' THEN
    IF NOT (
      OLD.version_status = 'confirmed'
      AND NEW.version_status = 'superseded'
      AND NEW.id = OLD.id
      AND NEW.installation_id = OLD.installation_id
      AND NEW.sales_order_id = OLD.sales_order_id
      AND NEW.version_number = OLD.version_number
      AND NEW.customer_mode_snapshot = OLD.customer_mode_snapshot
      AND NEW.walk_in_display_name_snapshot IS NOT DISTINCT FROM OLD.walk_in_display_name_snapshot
      AND NEW.walk_in_phone_snapshot IS NOT DISTINCT FROM OLD.walk_in_phone_snapshot
      AND NEW.customer_id = OLD.customer_id
      AND NEW.customer_code_snapshot = OLD.customer_code_snapshot
      AND NEW.customer_name_snapshot = OLD.customer_name_snapshot
      AND NEW.customer_address_id IS NOT DISTINCT FROM OLD.customer_address_id
      AND NEW.customer_address_snapshot IS NOT DISTINCT FROM OLD.customer_address_snapshot
      AND NEW.warehouse_id = OLD.warehouse_id
      AND NEW.warehouse_code_snapshot = OLD.warehouse_code_snapshot
      AND NEW.warehouse_name_snapshot = OLD.warehouse_name_snapshot
      AND NEW.delivery_mode = OLD.delivery_mode
      AND NEW.source_type = OLD.source_type
      AND NEW.source_id IS NOT DISTINCT FROM OLD.source_id
      AND NEW.source_outlet_id IS NOT DISTINCT FROM OLD.source_outlet_id
      AND NEW.collection_policy = OLD.collection_policy
      AND NEW.currency_code = OLD.currency_code
      AND NEW.requested_delivery_date IS NOT DISTINCT FROM OLD.requested_delivery_date
      AND NEW.note IS NOT DISTINCT FROM OLD.note
      AND NEW.subtotal = OLD.subtotal
      AND NEW.discount_total = OLD.discount_total
      AND NEW.tax_total = OLD.tax_total
      AND NEW.total = OLD.total
      AND NEW.amendment_reason IS NOT DISTINCT FROM OLD.amendment_reason
      AND NEW.based_on_version_number IS NOT DISTINCT FROM OLD.based_on_version_number
      AND NEW.price_override_reason IS NOT DISTINCT FROM OLD.price_override_reason
      AND NEW.sales_channel_id IS NOT DISTINCT FROM OLD.sales_channel_id
      AND NEW.sales_channel_code_snapshot IS NOT DISTINCT FROM OLD.sales_channel_code_snapshot
      AND NEW.sales_channel_name_snapshot IS NOT DISTINCT FROM OLD.sales_channel_name_snapshot
      AND NEW.document_discount_mode = OLD.document_discount_mode
      AND NEW.document_discount_value = OLD.document_discount_value
      AND NEW.document_discount_reason IS NOT DISTINCT FROM OLD.document_discount_reason
      AND NEW.created_at = OLD.created_at
      AND NEW.created_by = OLD.created_by
      AND NEW.confirmed_at = OLD.confirmed_at
      AND NEW.confirmed_by = OLD.confirmed_by
    ) THEN
      RAISE EXCEPTION 'sales_order_version_locked';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
