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
  ADD COLUMN IF NOT EXISTS walk_in_display_name text NULL,
  ADD COLUMN IF NOT EXISTS walk_in_phone text NULL;

ALTER TABLE sales.sales_order_versions
  ADD COLUMN IF NOT EXISTS walk_in_display_name_snapshot text NULL,
  ADD COLUMN IF NOT EXISTS walk_in_phone_snapshot text NULL;

DO $$
BEGIN
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
  WHERE walk_in_phone IS NOT NULL;
