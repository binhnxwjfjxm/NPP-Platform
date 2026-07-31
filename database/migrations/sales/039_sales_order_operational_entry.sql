-- Phase 6B.1: installation-owned Sales Order entry settings and walk-in snapshots.
-- This migration does not post inventory, delivery, receivable, payment or tax accounting facts.

CREATE TABLE IF NOT EXISTS shared.sales_order_settings (
  installation_id text NOT NULL PRIMARY KEY
    CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  walk_in_customer_id uuid NULL,
  default_tax_mode text NOT NULL DEFAULT 'EXCLUSIVE'
    CHECK (default_tax_mode IN ('EXCLUSIVE', 'INCLUSIVE')),
  default_tax_rate numeric(9,6) NOT NULL DEFAULT 0
    CHECK (default_tax_rate BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT sales_order_settings_walk_in_customer_fk
    FOREIGN KEY (installation_id, walk_in_customer_id)
    REFERENCES shared.customers (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

ALTER TABLE sales.sales_orders
  ADD COLUMN IF NOT EXISTS customer_mode text NOT NULL DEFAULT 'EXISTING',
  ADD COLUMN IF NOT EXISTS walk_in_display_name text NULL,
  ADD COLUMN IF NOT EXISTS walk_in_phone text NULL;

ALTER TABLE sales.sales_order_versions
  ADD COLUMN IF NOT EXISTS customer_mode_snapshot text NOT NULL DEFAULT 'EXISTING',
  ADD COLUMN IF NOT EXISTS walk_in_display_name_snapshot text NULL,
  ADD COLUMN IF NOT EXISTS walk_in_phone_snapshot text NULL;

CREATE OR REPLACE FUNCTION sales.sales_order_normalize_customer_mode()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.customer_mode IS NULL THEN
    NEW.customer_mode := CASE
      WHEN NEW.walk_in_display_name IS NOT NULL OR NEW.walk_in_phone IS NOT NULL THEN 'WALK_IN'
      ELSE 'EXISTING'
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_orders_normalize_customer_mode_trigger
  ON sales.sales_orders;
CREATE TRIGGER sales_orders_normalize_customer_mode_trigger
BEFORE INSERT OR UPDATE OF customer_mode, walk_in_display_name, walk_in_phone
ON sales.sales_orders
FOR EACH ROW
EXECUTE FUNCTION sales.sales_order_normalize_customer_mode();

CREATE OR REPLACE FUNCTION sales.sales_order_version_normalize_customer_mode()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.customer_mode_snapshot IS NULL THEN
    NEW.customer_mode_snapshot := CASE
      WHEN NEW.walk_in_display_name_snapshot IS NOT NULL OR NEW.walk_in_phone_snapshot IS NOT NULL THEN 'WALK_IN'
      ELSE 'EXISTING'
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_order_versions_normalize_customer_mode_trigger
  ON sales.sales_order_versions;
CREATE TRIGGER sales_order_versions_normalize_customer_mode_trigger
BEFORE INSERT OR UPDATE OF customer_mode_snapshot, walk_in_display_name_snapshot, walk_in_phone_snapshot
ON sales.sales_order_versions
FOR EACH ROW
EXECUTE FUNCTION sales.sales_order_version_normalize_customer_mode();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_orders_customer_mode_check'
      AND conrelid = 'sales.sales_orders'::regclass
  ) THEN
    ALTER TABLE sales.sales_orders
      ADD CONSTRAINT sales_orders_customer_mode_check
      CHECK (customer_mode IN ('EXISTING', 'WALK_IN'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_order_versions_customer_mode_check'
      AND conrelid = 'sales.sales_order_versions'::regclass
  ) THEN
    ALTER TABLE sales.sales_order_versions
      ADD CONSTRAINT sales_order_versions_customer_mode_check
      CHECK (customer_mode_snapshot IN ('EXISTING', 'WALK_IN'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_orders_walk_in_shape_check'
      AND conrelid = 'sales.sales_orders'::regclass
  ) THEN
    ALTER TABLE sales.sales_orders
      ADD CONSTRAINT sales_orders_walk_in_shape_check
      CHECK (
        customer_mode <> 'WALK_IN'
        OR (delivery_mode = 'PICKUP'
            AND customer_address_id IS NULL
            AND collection_policy IN ('PREPAID', 'COLLECT_ON_DELIVERY'))
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_order_versions_walk_in_shape_check'
      AND conrelid = 'sales.sales_order_versions'::regclass
  ) THEN
    ALTER TABLE sales.sales_order_versions
      ADD CONSTRAINT sales_order_versions_walk_in_shape_check
      CHECK (
        customer_mode_snapshot <> 'WALK_IN'
        OR (delivery_mode = 'PICKUP'
            AND customer_address_id IS NULL
            AND collection_policy IN ('PREPAID', 'COLLECT_ON_DELIVERY'))
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_orders_walk_in_name_length_check'
      AND conrelid = 'sales.sales_orders'::regclass
  ) THEN
    ALTER TABLE sales.sales_orders
      ADD CONSTRAINT sales_orders_walk_in_name_length_check
      CHECK (walk_in_display_name IS NULL OR char_length(btrim(walk_in_display_name)) BETWEEN 1 AND 256);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_orders_walk_in_phone_length_check'
      AND conrelid = 'sales.sales_orders'::regclass
  ) THEN
    ALTER TABLE sales.sales_orders
      ADD CONSTRAINT sales_orders_walk_in_phone_length_check
      CHECK (walk_in_phone IS NULL OR char_length(btrim(walk_in_phone)) BETWEEN 1 AND 64);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_order_versions_walk_in_name_length_check'
      AND conrelid = 'sales.sales_order_versions'::regclass
  ) THEN
    ALTER TABLE sales.sales_order_versions
      ADD CONSTRAINT sales_order_versions_walk_in_name_length_check
      CHECK (walk_in_display_name_snapshot IS NULL OR char_length(btrim(walk_in_display_name_snapshot)) BETWEEN 1 AND 256);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_order_versions_walk_in_phone_length_check'
      AND conrelid = 'sales.sales_order_versions'::regclass
  ) THEN
    ALTER TABLE sales.sales_order_versions
      ADD CONSTRAINT sales_order_versions_walk_in_phone_length_check
      CHECK (walk_in_phone_snapshot IS NULL OR char_length(btrim(walk_in_phone_snapshot)) BETWEEN 1 AND 64);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS sales_orders_walk_in_phone_idx
  ON sales.sales_orders (installation_id, walk_in_phone)
  WHERE customer_mode = 'WALK_IN' AND walk_in_phone IS NOT NULL;
