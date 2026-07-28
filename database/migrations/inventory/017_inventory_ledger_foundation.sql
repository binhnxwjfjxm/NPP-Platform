-- Phase 4.1: immutable inventory movement ledger foundation.
-- Ledger rows are posted facts only. Balance projection, reservations, lot master data,
-- opening-balance import UI and costing are deliberately outside this migration.

CREATE SCHEMA IF NOT EXISTS inventory;

INSERT INTO shared.permission_catalog (
  permission_key,
  module,
  label,
  description,
  is_system,
  created_at
) VALUES
  ('core.inventory.read', 'Kho', 'Xem sổ kho', 'Cho phép đọc movement và drill-down sổ kho trong phạm vi kho được cấp.', true, now()),
  ('core.inventory.post', 'Kho', 'Ghi sổ kho', 'Cho phép domain nội bộ ghi movement kho theo hợp đồng idempotent và phạm vi kho.', true, now()),
  ('core.inventory.reverse', 'Kho', 'Đảo movement kho', 'Cho phép tạo movement đảo cho movement đã post trong phạm vi kho được cấp.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'warehouse_locations_installation_warehouse_id_unique'
      AND conrelid = 'shared.warehouse_locations'::regclass
  ) THEN
    ALTER TABLE shared.warehouse_locations
      ADD CONSTRAINT warehouse_locations_installation_warehouse_id_unique
      UNIQUE (installation_id, warehouse_id, id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS inventory.inventory_movements (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  movement_type text NOT NULL CHECK (
    char_length(movement_type) BETWEEN 1 AND 64
    AND movement_type = upper(btrim(movement_type))
    AND movement_type ~ '^[A-Z0-9_.-]{1,64}$'
  ),
  source_domain text NOT NULL CHECK (
    char_length(source_domain) BETWEEN 1 AND 64
    AND source_domain = upper(btrim(source_domain))
    AND source_domain ~ '^[A-Z0-9_.-]{1,64}$'
  ),
  source_document_type text NULL CHECK (
    source_document_type IS NULL OR (
      char_length(source_document_type) BETWEEN 1 AND 64
      AND source_document_type = upper(btrim(source_document_type))
      AND source_document_type ~ '^[A-Z0-9_.-]{1,64}$'
    )
  ),
  source_document_id text NULL CHECK (source_document_id IS NULL OR char_length(btrim(source_document_id)) BETWEEN 1 AND 160),
  source_document_number text NULL CHECK (source_document_number IS NULL OR char_length(btrim(source_document_number)) BETWEEN 1 AND 160),
  document_date date NOT NULL,
  posted_at timestamptz NOT NULL DEFAULT now(),
  posted_by text NOT NULL CHECK (char_length(posted_by) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  reversal_of_movement_id uuid NULL,
  document_number text NULL CHECK (document_number IS NULL OR char_length(btrim(document_number)) BETWEEN 1 AND 160),
  reason_code text NULL CHECK (reason_code IS NULL OR char_length(btrim(reason_code)) BETWEEN 1 AND 64),
  reason_note text NULL CHECK (reason_note IS NULL OR char_length(btrim(reason_note)) BETWEEN 1 AND 2000),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT inventory_movements_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT inventory_movements_idempotency_unique UNIQUE (installation_id, idempotency_key),
  CONSTRAINT inventory_movements_reversal_not_self CHECK (reversal_of_movement_id IS NULL OR reversal_of_movement_id <> id),
  CONSTRAINT inventory_movements_reversal_installation_fk
    FOREIGN KEY (installation_id, reversal_of_movement_id)
    REFERENCES inventory.inventory_movements (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_movements_one_reversal_idx
  ON inventory.inventory_movements (installation_id, reversal_of_movement_id)
  WHERE reversal_of_movement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inventory_movements_installation_date_idx
  ON inventory.inventory_movements (installation_id, document_date DESC, posted_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS inventory_movements_source_idx
  ON inventory.inventory_movements (installation_id, source_domain, source_document_type, source_document_id);
CREATE INDEX IF NOT EXISTS inventory_movements_request_idx
  ON inventory.inventory_movements (installation_id, request_id);

CREATE TABLE IF NOT EXISTS inventory.inventory_movement_lines (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  movement_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  warehouse_id uuid NOT NULL,
  location_id uuid NULL,
  source_variant_id uuid NOT NULL,
  source_sku text NOT NULL CHECK (
    char_length(source_sku) BETWEEN 1 AND 96
    AND source_sku = upper(btrim(source_sku))
  ),
  source_unit_id uuid NOT NULL,
  source_unit_code text NOT NULL CHECK (
    char_length(source_unit_code) BETWEEN 1 AND 32
    AND source_unit_code = upper(btrim(source_unit_code))
  ),
  source_quantity numeric(20,6) NOT NULL CHECK (source_quantity > 0),
  conversion_to_base numeric(20,6) NOT NULL CHECK (conversion_to_base > 0),
  base_variant_id uuid NOT NULL,
  base_sku text NOT NULL CHECK (
    char_length(base_sku) BETWEEN 1 AND 96
    AND base_sku = upper(btrim(base_sku))
  ),
  direction text NOT NULL CHECK (direction IN ('IN', 'OUT')),
  base_quantity_delta numeric(30,12) NOT NULL CHECK (base_quantity_delta <> 0),
  source_line_reference text NULL CHECK (source_line_reference IS NULL OR char_length(btrim(source_line_reference)) BETWEEN 1 AND 160),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT inventory_movement_lines_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT inventory_movement_lines_number_unique UNIQUE (installation_id, movement_id, line_number),
  CONSTRAINT inventory_movement_lines_movement_installation_fk
    FOREIGN KEY (installation_id, movement_id)
    REFERENCES inventory.inventory_movements (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT inventory_movement_lines_warehouse_installation_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT inventory_movement_lines_location_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id, location_id)
    REFERENCES shared.warehouse_locations (installation_id, warehouse_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT inventory_movement_lines_source_variant_installation_fk
    FOREIGN KEY (installation_id, source_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT inventory_movement_lines_base_variant_installation_fk
    FOREIGN KEY (installation_id, base_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT inventory_movement_lines_source_unit_installation_fk
    FOREIGN KEY (installation_id, source_unit_id)
    REFERENCES shared.units_of_measure (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT inventory_movement_lines_direction_sign_check CHECK (
    (direction = 'IN' AND base_quantity_delta > 0)
    OR (direction = 'OUT' AND base_quantity_delta < 0)
  ),
  CONSTRAINT inventory_movement_lines_exact_conversion_check CHECK (
    abs(base_quantity_delta) = source_quantity * conversion_to_base
  )
);

CREATE INDEX IF NOT EXISTS inventory_movement_lines_movement_idx
  ON inventory.inventory_movement_lines (installation_id, movement_id, line_number);
CREATE INDEX IF NOT EXISTS inventory_movement_lines_scope_idx
  ON inventory.inventory_movement_lines (installation_id, warehouse_id, location_id, base_variant_id);
CREATE INDEX IF NOT EXISTS inventory_movement_lines_variant_idx
  ON inventory.inventory_movement_lines (installation_id, base_variant_id, movement_id);

CREATE OR REPLACE FUNCTION inventory.prevent_inventory_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'inventory_ledger_rows_are_append_only';
END;
$$;

DROP TRIGGER IF EXISTS inventory_movements_append_only ON inventory.inventory_movements;
CREATE TRIGGER inventory_movements_append_only
BEFORE UPDATE OR DELETE ON inventory.inventory_movements
FOR EACH ROW EXECUTE FUNCTION inventory.prevent_inventory_ledger_mutation();

DROP TRIGGER IF EXISTS inventory_movement_lines_append_only ON inventory.inventory_movement_lines;
CREATE TRIGGER inventory_movement_lines_append_only
BEFORE UPDATE OR DELETE ON inventory.inventory_movement_lines
FOR EACH ROW EXECUTE FUNCTION inventory.prevent_inventory_ledger_mutation();
