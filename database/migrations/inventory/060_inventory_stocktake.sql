-- Phase 7.3: stocktake, blind count, recount, approval and posting.
-- Inventory ledger remains the only stock source of truth. This migration adds
-- a DB-owned scope watermark and append-only stocktake rounds; it never writes balances directly.

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES
  ('core.stocktake.read', 'Kho', 'Xem kiểm kê', 'Cho phép đọc danh sách, chi tiết và lịch sử vòng đếm kiểm kê trong phạm vi kho được cấp.', true, now()),
  ('core.stocktake.create', 'Kho', 'Tạo kiểm kê', 'Cho phép tạo đợt kiểm kê và chụp snapshot tồn theo phạm vi kho được cấp.', true, now()),
  ('core.stocktake.count', 'Kho', 'Ghi nhận số đếm', 'Cho phép nhập số đếm mù và hoàn tất một vòng đếm kiểm kê.', true, now()),
  ('core.stocktake.submit', 'Kho', 'Gửi duyệt kiểm kê', 'Cho phép khóa vòng đếm hiện tại và gửi kết quả kiểm kê để duyệt.', true, now()),
  ('core.stocktake.approve', 'Kho', 'Duyệt kiểm kê', 'Cho phép yêu cầu đếm lại hoặc duyệt một version kiểm kê do người khác gửi.', true, now()),
  ('core.stocktake.post', 'Kho', 'Ghi sổ kiểm kê', 'Cho phép ghi một movement điều chỉnh kiểm kê từ kết quả đã duyệt.', true, now()),
  ('core.stocktake.cancel', 'Kho', 'Hủy kiểm kê', 'Cho phép hủy đợt kiểm kê trước khi gửi duyệt.', true, now()),
  ('core.stocktake.reverse', 'Kho', 'Đảo ghi sổ kiểm kê', 'Cho phép đảo movement kiểm kê khi chưa có movement phát sinh sau đó trên exact scope.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS inventory.inventory_scope_versions (
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  warehouse_id uuid NOT NULL,
  location_id uuid NULL,
  base_variant_id uuid NOT NULL,
  lot_id uuid NULL,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_scope_versions_scope_unique
    UNIQUE NULLS NOT DISTINCT (installation_id, warehouse_id, location_id, base_variant_id, lot_id),
  CONSTRAINT inventory_scope_versions_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_scope_versions_location_fk
    FOREIGN KEY (installation_id, warehouse_id, location_id)
    REFERENCES shared.warehouse_locations (installation_id, warehouse_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_scope_versions_variant_fk
    FOREIGN KEY (installation_id, base_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_scope_versions_lot_fk
    FOREIGN KEY (installation_id, lot_id)
    REFERENCES inventory.inventory_lots (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

INSERT INTO inventory.inventory_scope_versions (
  installation_id, warehouse_id, location_id, base_variant_id, lot_id, version, updated_at
)
SELECT line.installation_id,
       line.warehouse_id,
       line.location_id,
       line.base_variant_id,
       line.lot_id,
       count(*)::bigint,
       max(movement.posted_at)
  FROM inventory.inventory_movement_lines line
  JOIN inventory.inventory_movements movement
    ON movement.installation_id = line.installation_id
   AND movement.id = line.movement_id
 GROUP BY line.installation_id, line.warehouse_id, line.location_id, line.base_variant_id, line.lot_id
ON CONFLICT ON CONSTRAINT inventory_scope_versions_scope_unique DO UPDATE
SET version = greatest(inventory.inventory_scope_versions.version, EXCLUDED.version),
    updated_at = greatest(inventory.inventory_scope_versions.updated_at, EXCLUDED.updated_at);

CREATE OR REPLACE FUNCTION inventory.bump_inventory_scope_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO inventory.inventory_scope_versions (
    installation_id, warehouse_id, location_id, base_variant_id, lot_id, version, updated_at
  ) VALUES (
    NEW.installation_id, NEW.warehouse_id, NEW.location_id, NEW.base_variant_id, NEW.lot_id, 1, now()
  )
  ON CONFLICT ON CONSTRAINT inventory_scope_versions_scope_unique DO UPDATE
  SET version = inventory.inventory_scope_versions.version + 1,
      updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_movement_lines_scope_version ON inventory.inventory_movement_lines;
CREATE TRIGGER inventory_movement_lines_scope_version
AFTER INSERT ON inventory.inventory_movement_lines
FOR EACH ROW EXECUTE FUNCTION inventory.bump_inventory_scope_version();

CREATE TABLE IF NOT EXISTS inventory.stocktakes (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  stocktake_number text NOT NULL CHECK (char_length(btrim(stocktake_number)) BETWEEN 1 AND 64),
  warehouse_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN (
    'draft', 'counted', 'submitted', 'recount_required',
    'approved', 'posted', 'cancelled', 'reversed'
  )),
  current_round integer NOT NULL DEFAULT 1 CHECK (current_round > 0),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  note text NULL CHECK (note IS NULL OR char_length(note) <= 4000),
  inventory_movement_id uuid NULL,
  reversal_movement_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  submitted_at timestamptz NULL,
  submitted_by text NULL,
  approved_at timestamptz NULL,
  approved_by text NULL,
  posted_at timestamptz NULL,
  posted_by text NULL,
  cancelled_at timestamptz NULL,
  cancelled_by text NULL,
  cancel_reason text NULL CHECK (cancel_reason IS NULL OR char_length(btrim(cancel_reason)) BETWEEN 1 AND 2000),
  reversed_at timestamptz NULL,
  reversed_by text NULL,
  reversal_reason text NULL CHECK (reversal_reason IS NULL OR char_length(btrim(reversal_reason)) BETWEEN 1 AND 2000),
  CONSTRAINT stocktakes_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT stocktakes_number_unique UNIQUE (installation_id, stocktake_number),
  CONSTRAINT stocktakes_submitter_approver_separation CHECK (
    approved_by IS NULL OR submitted_by IS NULL OR approved_by <> submitted_by
  ),
  CONSTRAINT stocktakes_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT stocktakes_movement_fk
    FOREIGN KEY (installation_id, inventory_movement_id)
    REFERENCES inventory.inventory_movements (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT stocktakes_reversal_movement_fk
    FOREIGN KEY (installation_id, reversal_movement_id)
    REFERENCES inventory.inventory_movements (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS stocktakes_active_movement_unique
  ON inventory.stocktakes (installation_id, inventory_movement_id)
  WHERE inventory_movement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stocktakes_list_idx
  ON inventory.stocktakes (installation_id, warehouse_id, status, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS inventory.stocktake_rounds (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  stocktake_id uuid NOT NULL,
  round_number integer NOT NULL CHECK (round_number > 0),
  status text NOT NULL CHECK (status IN ('open', 'counted', 'submitted', 'recount_required', 'approved', 'posted')),
  reason text NULL CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  counted_at timestamptz NULL,
  counted_by text NULL,
  submitted_at timestamptz NULL,
  submitted_by text NULL,
  approved_at timestamptz NULL,
  approved_by text NULL,
  CONSTRAINT stocktake_rounds_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT stocktake_rounds_number_unique UNIQUE (installation_id, stocktake_id, round_number),
  CONSTRAINT stocktake_rounds_stocktake_fk
    FOREIGN KEY (installation_id, stocktake_id)
    REFERENCES inventory.stocktakes (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT stocktake_rounds_submitter_approver_separation CHECK (
    approved_by IS NULL OR submitted_by IS NULL OR approved_by <> submitted_by
  )
);

CREATE INDEX IF NOT EXISTS stocktake_rounds_stocktake_idx
  ON inventory.stocktake_rounds (installation_id, stocktake_id, round_number DESC);

CREATE TABLE IF NOT EXISTS inventory.stocktake_lines (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  stocktake_id uuid NOT NULL,
  round_id uuid NOT NULL,
  round_number integer NOT NULL CHECK (round_number > 0),
  line_number integer NOT NULL CHECK (line_number > 0),
  warehouse_id uuid NOT NULL,
  location_id uuid NULL,
  source_variant_id uuid NOT NULL,
  source_sku text NOT NULL CHECK (char_length(source_sku) BETWEEN 1 AND 96),
  source_unit_id uuid NOT NULL,
  source_unit_code text NOT NULL CHECK (char_length(source_unit_code) BETWEEN 1 AND 32),
  conversion_to_base numeric(20,6) NOT NULL CHECK (conversion_to_base > 0),
  base_variant_id uuid NOT NULL,
  base_sku text NOT NULL CHECK (char_length(base_sku) BETWEEN 1 AND 96),
  lot_id uuid NULL,
  lot_code text NULL,
  expiry_date date NULL,
  expected_base_quantity numeric(30,12) NOT NULL,
  counted_base_quantity numeric(30,12) NULL CHECK (counted_base_quantity IS NULL OR counted_base_quantity >= 0),
  final_delta numeric(30,12) NULL,
  snapshot_scope_version bigint NOT NULL CHECK (snapshot_scope_version >= 0),
  posted_scope_version bigint NULL CHECK (posted_scope_version IS NULL OR posted_scope_version >= 0),
  counted_at timestamptz NULL,
  counted_by text NULL,
  CONSTRAINT stocktake_lines_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT stocktake_lines_number_unique UNIQUE (installation_id, round_id, line_number),
  CONSTRAINT stocktake_lines_scope_unique
    UNIQUE NULLS NOT DISTINCT (installation_id, round_id, location_id, base_variant_id, lot_id),
  CONSTRAINT stocktake_lines_stocktake_fk
    FOREIGN KEY (installation_id, stocktake_id)
    REFERENCES inventory.stocktakes (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT stocktake_lines_round_fk
    FOREIGN KEY (installation_id, round_id)
    REFERENCES inventory.stocktake_rounds (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT stocktake_lines_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT stocktake_lines_location_fk
    FOREIGN KEY (installation_id, warehouse_id, location_id)
    REFERENCES shared.warehouse_locations (installation_id, warehouse_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT stocktake_lines_source_variant_fk
    FOREIGN KEY (installation_id, source_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT stocktake_lines_source_unit_fk
    FOREIGN KEY (installation_id, source_unit_id)
    REFERENCES shared.units_of_measure (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT stocktake_lines_base_variant_fk
    FOREIGN KEY (installation_id, base_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT stocktake_lines_lot_fk
    FOREIGN KEY (installation_id, lot_id)
    REFERENCES inventory.inventory_lots (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS stocktake_lines_round_idx
  ON inventory.stocktake_lines (installation_id, stocktake_id, round_number, line_number);
CREATE INDEX IF NOT EXISTS stocktake_lines_scope_idx
  ON inventory.stocktake_lines (installation_id, warehouse_id, location_id, base_variant_id, lot_id);

CREATE OR REPLACE FUNCTION inventory.guard_stocktake_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  header_status text;
  current_round_number integer;
  write_context text := current_setting('npp.stocktake_write_context', true);
BEGIN
  SELECT status, current_round
    INTO header_status, current_round_number
    FROM inventory.stocktakes
   WHERE installation_id = OLD.installation_id
     AND id = OLD.stocktake_id;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stocktake_history_is_append_only';
  END IF;

  IF OLD.expected_base_quantity <> NEW.expected_base_quantity
     OR OLD.snapshot_scope_version <> NEW.snapshot_scope_version
     OR OLD.warehouse_id <> NEW.warehouse_id
     OR OLD.location_id IS DISTINCT FROM NEW.location_id
     OR OLD.base_variant_id <> NEW.base_variant_id
     OR OLD.lot_id IS DISTINCT FROM NEW.lot_id
     OR OLD.source_variant_id <> NEW.source_variant_id
     OR OLD.source_unit_id <> NEW.source_unit_id
     OR OLD.source_quantity <> NEW.source_quantity
     OR OLD.conversion_to_base <> NEW.conversion_to_base THEN
    RAISE EXCEPTION 'stocktake_snapshot_is_immutable';
  END IF;

  IF header_status = 'approved'
     AND write_context = 'posting'
     AND OLD.round_number = current_round_number THEN
    IF OLD.counted_base_quantity IS DISTINCT FROM NEW.counted_base_quantity
       OR OLD.counted_at IS DISTINCT FROM NEW.counted_at
       OR OLD.counted_by IS DISTINCT FROM NEW.counted_by
       OR OLD.final_delta IS NOT NULL
       OR OLD.posted_scope_version IS NOT NULL
       OR NEW.final_delta IS NULL
       OR NEW.posted_scope_version IS NULL THEN
      RAISE EXCEPTION 'stocktake_posting_update_invalid';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.round_number <> current_round_number
     OR header_status IN ('submitted', 'approved', 'posted', 'cancelled', 'reversed') THEN
    RAISE EXCEPTION 'stocktake_round_is_locked';
  END IF;

  IF OLD.final_delta IS DISTINCT FROM NEW.final_delta
     OR OLD.posted_scope_version IS DISTINCT FROM NEW.posted_scope_version THEN
    RAISE EXCEPTION 'stocktake_posting_fields_are_server_owned';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stocktake_lines_history_guard ON inventory.stocktake_lines;
CREATE TRIGGER stocktake_lines_history_guard
BEFORE UPDATE OR DELETE ON inventory.stocktake_lines
FOR EACH ROW EXECUTE FUNCTION inventory.guard_stocktake_history();
