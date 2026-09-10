-- Issue #925: Sales Order price-selection mode and history-reference provenance.
-- Forward-only, rerun-safe. Purchase history remains sourced from canonical Sales Orders.

ALTER TABLE sales.sales_order_versions
  ADD COLUMN IF NOT EXISTS price_selection_mode text NOT NULL DEFAULT 'STANDARD';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_order_versions_price_selection_mode_check'
      AND conrelid = 'sales.sales_order_versions'::regclass
  ) THEN
    ALTER TABLE sales.sales_order_versions
      ADD CONSTRAINT sales_order_versions_price_selection_mode_check
      CHECK (price_selection_mode IN ('STANDARD', 'LAST_PURCHASE'));
  END IF;
END $$;

-- Migration 037 created this as an inline CHECK, so replace only that constraint.
ALTER TABLE sales.sales_order_version_lines
  DROP CONSTRAINT IF EXISTS sales_order_version_lines_price_source_check;

ALTER TABLE sales.sales_order_version_lines
  ADD CONSTRAINT sales_order_version_lines_price_source_check
  CHECK (price_source IN ('PRICE_ENGINE', 'MANUAL_OVERRIDE', 'HISTORY_REFERENCE'));

-- Keep price-selection mode immutable together with the confirmed commercial snapshot.
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
      AND NEW.price_selection_mode = OLD.price_selection_mode
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
