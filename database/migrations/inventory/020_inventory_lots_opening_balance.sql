-- Phase 4.4: lot, expiry and opening-balance foundation.
-- This migration extends the Phase 4 inventory ledger with lot-aware scope,
-- tracking policies and import tables. It is forward-only and rerunnable.

CREATE TABLE IF NOT EXISTS inventory.product_tracking_policies (
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  base_variant_id uuid NOT NULL,
  lot_tracking_mode text NOT NULL CHECK (lot_tracking_mode IN ('NONE', 'REQUIRED')),
  expiry_tracking_mode text NOT NULL CHECK (expiry_tracking_mode IN ('NONE', 'OPTIONAL', 'REQUIRED')),
  location_required boolean NOT NULL DEFAULT false,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT product_tracking_policies_installation_variant_unique UNIQUE (installation_id, base_variant_id),
  CONSTRAINT product_tracking_policies_variant_installation_fk
    FOREIGN KEY (installation_id, base_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT product_tracking_policies_requires_lot_for_expiry CHECK (
    expiry_tracking_mode = 'NONE' OR lot_tracking_mode = 'REQUIRED'
  )
);

CREATE INDEX IF NOT EXISTS product_tracking_policies_variant_idx
  ON inventory.product_tracking_policies (installation_id, base_variant_id, version DESC);

CREATE TABLE IF NOT EXISTS inventory.inventory_lots (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  base_variant_id uuid NOT NULL,
  lot_code text NOT NULL CHECK (char_length(btrim(lot_code)) BETWEEN 1 AND 100),
  normalized_lot_code text NOT NULL CHECK (
    char_length(normalized_lot_code) BETWEEN 1 AND 100
    AND normalized_lot_code = upper(btrim(normalized_lot_code))
  ),
  manufactured_date date null,
  expiry_date date null,
  supplier_lot_reference text null CHECK (supplier_lot_reference IS NULL OR char_length(btrim(supplier_lot_reference)) BETWEEN 1 AND 160),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT inventory_lots_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT inventory_lots_identity_unique UNIQUE (installation_id, base_variant_id, normalized_lot_code),
  CONSTRAINT inventory_lots_variant_installation_fk
    FOREIGN KEY (installation_id, base_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS inventory_lots_lookup_idx
  ON inventory.inventory_lots (installation_id, base_variant_id, normalized_lot_code, id DESC);

CREATE TABLE IF NOT EXISTS inventory.opening_balance_imports (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  source_key text NOT NULL CHECK (char_length(btrim(source_key)) BETWEEN 1 AND 128),
  source_filename text NULL CHECK (source_filename IS NULL OR char_length(btrim(source_filename)) BETWEEN 1 AND 256),
  content_checksum text NOT NULL CHECK (content_checksum ~ '^[0-9a-f]{64}$'),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status = 'POSTED'),
  document_date date NOT NULL,
  movement_id uuid null,
  row_count integer NOT NULL CHECK (row_count >= 0 AND row_count <= 500),
  source_quantity_total numeric(30,12) NOT NULL,
  base_quantity_total numeric(30,12) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT opening_balance_imports_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT opening_balance_imports_source_unique UNIQUE (installation_id, source_key)
);

CREATE INDEX IF NOT EXISTS opening_balance_imports_lookup_idx
  ON inventory.opening_balance_imports (installation_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS inventory.opening_balance_import_rows (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  import_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  warehouse_id uuid NOT NULL,
  location_id uuid NULL,
  source_variant_id uuid NOT NULL,
  source_sku text NOT NULL CHECK (char_length(source_sku) BETWEEN 1 AND 96),
  source_unit_id uuid NOT NULL,
  source_unit_code text NOT NULL CHECK (char_length(source_unit_code) BETWEEN 1 AND 32),
  source_quantity numeric(20,6) NOT NULL,
  conversion_to_base numeric(20,6) NOT NULL,
  base_variant_id uuid NOT NULL,
  base_sku text NOT NULL CHECK (char_length(base_sku) BETWEEN 1 AND 96),
  base_quantity numeric(30,12) NOT NULL,
  lot_id uuid null,
  lot_code text null,
  expiry_date date null,
  source_line_reference text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT opening_balance_import_rows_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT opening_balance_import_rows_line_unique UNIQUE (installation_id, import_id, line_number),
  CONSTRAINT opening_balance_import_rows_import_fk
    FOREIGN KEY (installation_id, import_id)
    REFERENCES inventory.opening_balance_imports (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT opening_balance_import_rows_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT opening_balance_import_rows_location_fk
    FOREIGN KEY (installation_id, warehouse_id, location_id)
    REFERENCES shared.warehouse_locations (installation_id, warehouse_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT opening_balance_import_rows_source_variant_fk
    FOREIGN KEY (installation_id, source_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT opening_balance_import_rows_base_variant_fk
    FOREIGN KEY (installation_id, base_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT opening_balance_import_rows_source_unit_fk
    FOREIGN KEY (installation_id, source_unit_id)
    REFERENCES shared.units_of_measure (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS opening_balance_import_rows_import_idx
  ON inventory.opening_balance_import_rows (installation_id, import_id, line_number);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'inventory_movement_lines_lot_installation_fk'
       AND conrelid = 'inventory.inventory_movement_lines'::regclass
  ) THEN
    ALTER TABLE inventory.inventory_movement_lines
          ADD COLUMN IF NOT EXISTS lot_id uuid null,
          ADD COLUMN IF NOT EXISTS lot_code text null,
          ADD COLUMN IF NOT EXISTS expiry_date date null;

    ALTER TABLE inventory.inventory_movement_lines
      ADD CONSTRAINT inventory_movement_lines_lot_installation_fk
      FOREIGN KEY (installation_id, lot_id)
      REFERENCES inventory.inventory_lots (installation_id, id)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT;
  ELSE
      ALTER TABLE inventory.inventory_movement_lines
      ADD COLUMN IF NOT EXISTS lot_id uuid null,
      ADD COLUMN IF NOT EXISTS lot_code text null,
      ADD COLUMN IF NOT EXISTS expiry_date date null;
  END IF;
END $$;

INSERT INTO shared.permission_catalog (
  permission_key,
  module,
  label,
  description,
  is_system,
  created_at
) VALUES
  ('core.inventory.tracking-policy.read', 'Kho', 'Xem chính sách lô và hạn', 'Cho phép đọc chính sách theo dõi lô, hạn dùng và yêu cầu vị trí cho SKU inventory-base.', true, now()),
  ('core.inventory.tracking-policy.manage', 'Kho', 'Quản lý chính sách lô và hạn', 'Cho phép tạo, cập nhật và khóa chính sách theo dõi lô, hạn dùng và vị trí.', true, now()),
  ('core.inventory.lot.read', 'Kho', 'Xem danh mục lô', 'Cho phép đọc danh mục lô canonical và tra cứu quan hệ lô của tồn kho.', true, now()),
  ('core.inventory.lot.manage', 'Kho', 'Quản lý danh mục lô', 'Cho phép khởi tạo lô canonical phục vụ posting và opening balance.', true, now()),
  ('core.inventory.opening-balance.import', 'Kho', 'Nhập số dư đầu kỳ', 'Cho phép xác thực và post opening balance qua hợp đồng import idempotent.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE OR REPLACE FUNCTION inventory.prevent_inventory_lot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'inventory_lots_are_append_only';
END;
$$;

DROP TRIGGER IF EXISTS inventory_lots_append_only ON inventory.inventory_lots;
CREATE TRIGGER inventory_lots_append_only
BEFORE UPDATE OR DELETE ON inventory.inventory_lots
FOR EACH ROW EXECUTE FUNCTION inventory.prevent_inventory_lot_mutation();

CREATE OR REPLACE FUNCTION inventory.prevent_opening_balance_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'opening_balance_imports_are_append_only';
END;
$$;

DROP TRIGGER IF EXISTS opening_balance_imports_append_only ON inventory.opening_balance_imports;
CREATE TRIGGER opening_balance_imports_append_only
BEFORE UPDATE OR DELETE ON inventory.opening_balance_imports
FOR EACH ROW EXECUTE FUNCTION inventory.prevent_opening_balance_mutation();

DROP TRIGGER IF EXISTS opening_balance_import_rows_append_only ON inventory.opening_balance_import_rows;
CREATE TRIGGER opening_balance_import_rows_append_only
BEFORE UPDATE OR DELETE ON inventory.opening_balance_import_rows
FOR EACH ROW EXECUTE FUNCTION inventory.prevent_opening_balance_mutation();

CREATE OR REPLACE FUNCTION inventory.project_inventory_balance_from_line()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  movement_posted_at timestamptz;
  previous_context text := current_setting('npp.inventory_balance_write_context', true);
BEGIN
  SELECT movement.posted_at
    INTO movement_posted_at
    FROM inventory.inventory_movements movement
   WHERE movement.installation_id = NEW.installation_id
     AND movement.id = NEW.movement_id;

  IF movement_posted_at IS NULL THEN
    RAISE EXCEPTION 'inventory_movement_missing_for_projection';
  END IF;

  PERFORM set_config('npp.inventory_balance_write_context', 'projector', true);

  INSERT INTO inventory.inventory_balances (
    installation_id,
    warehouse_id,
    location_id,
    base_variant_id,
    lot_id,
    on_hand_quantity,
    reserved_quantity,
    projected_through,
    updated_at
  ) VALUES (
    NEW.installation_id,
    NEW.warehouse_id,
    NEW.location_id,
    NEW.base_variant_id,
    NEW.lot_id,
    NEW.base_quantity_delta,
    0,
    movement_posted_at,
    now()
  )
  ON CONFLICT (
    installation_id,
    warehouse_id,
    location_id,
    base_variant_id,
    lot_id
  ) DO UPDATE
  SET on_hand_quantity = inventory.inventory_balances.on_hand_quantity + EXCLUDED.on_hand_quantity,
      projected_through = CASE
        WHEN inventory.inventory_balances.projected_through IS NULL THEN EXCLUDED.projected_through
        WHEN EXCLUDED.projected_through IS NULL THEN inventory.inventory_balances.projected_through
        ELSE greatest(inventory.inventory_balances.projected_through, EXCLUDED.projected_through)
      END,
      updated_at = now();

  PERFORM set_config(
    'npp.inventory_balance_write_context',
    COALESCE(previous_context, ''),
    true
  );
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config(
      'npp.inventory_balance_write_context',
      COALESCE(previous_context, ''),
      true
    );
    RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION inventory.guard_inventory_negative_stock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_on_hand numeric(30,12);
  current_reserved numeric(30,12);
BEGIN
  IF NEW.base_quantity_delta >= 0 THEN
    RETURN NEW;
  END IF;

  SELECT balance.on_hand_quantity, balance.reserved_quantity
    INTO current_on_hand, current_reserved
    FROM inventory.inventory_balances balance
   WHERE balance.installation_id = NEW.installation_id
     AND balance.warehouse_id = NEW.warehouse_id
     AND balance.location_id IS NOT DISTINCT FROM NEW.location_id
     AND balance.base_variant_id = NEW.base_variant_id
     AND balance.lot_id IS NOT DISTINCT FROM NEW.lot_id
   FOR UPDATE;

  IF NOT FOUND OR current_on_hand + NEW.base_quantity_delta < current_reserved THEN
    RAISE EXCEPTION 'inventory_negative_stock_denied';
  END IF;

  RETURN NEW;
END;
$$;
