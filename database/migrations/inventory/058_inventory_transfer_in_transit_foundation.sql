-- Phase 7.1: warehouse transfer document and in-transit foundation.
-- A dispatched transfer posts one immutable TRANSFER_ISSUE movement from the source warehouse.
-- In-transit is a projection of dispatched transfer lines; it is not a warehouse, location or vehicle.

INSERT INTO shared.permission_catalog (
  permission_key,
  module,
  label,
  description,
  is_system,
  created_at
) VALUES
  ('core.inventory-transfer.read', 'Kho', 'Xem phiếu chuyển kho', 'Cho phép đọc phiếu chuyển kho và hàng đang đi đường trong phạm vi kho được cấp.', true, now()),
  ('core.inventory-transfer.create', 'Kho', 'Tạo phiếu chuyển kho', 'Cho phép tạo phiếu chuyển kho nháp giữa hai kho được cấp quyền.', true, now()),
  ('core.inventory-transfer.update', 'Kho', 'Sửa phiếu chuyển kho', 'Cho phép cập nhật phiếu chuyển kho khi còn ở trạng thái nháp.', true, now()),
  ('core.inventory-transfer.approve', 'Kho', 'Duyệt phiếu chuyển kho', 'Cho phép duyệt phiếu chuyển kho trước khi xuất kho nguồn.', true, now()),
  ('core.inventory-transfer.dispatch', 'Kho', 'Xuất chuyển kho', 'Cho phép ghi sổ xuất kho nguồn và đưa hàng vào trạng thái đang đi đường.', true, now()),
  ('core.inventory-transfer.cancel', 'Kho', 'Hủy phiếu chuyển kho', 'Cho phép hủy phiếu chuyển kho trước khi xuất kho nguồn.', true, now()),
  ('core.inventory-transfer.reverse', 'Kho', 'Đảo xuất chuyển kho', 'Dành cho slice xử lý đảo/chứng từ bù sau khi chính sách nhận chuyển kho được khóa.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS inventory.inventory_transfers (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  document_number text NULL CHECK (document_number IS NULL OR char_length(btrim(document_number)) BETWEEN 1 AND 160),
  document_number_allocation_id uuid NULL,
  transfer_date date NOT NULL,
  source_warehouse_id uuid NOT NULL,
  destination_warehouse_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'dispatched', 'cancelled')),
  note text NULL CHECK (note IS NULL OR char_length(note) <= 4000),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  inventory_movement_id uuid NULL,
  approved_at timestamptz NULL,
  approved_by text NULL CHECK (approved_by IS NULL OR char_length(approved_by) BETWEEN 1 AND 128),
  dispatched_at timestamptz NULL,
  dispatched_by text NULL CHECK (dispatched_by IS NULL OR char_length(dispatched_by) BETWEEN 1 AND 128),
  cancelled_at timestamptz NULL,
  cancelled_by text NULL CHECK (cancelled_by IS NULL OR char_length(cancelled_by) BETWEEN 1 AND 128),
  cancellation_reason text NULL CHECK (cancellation_reason IS NULL OR char_length(btrim(cancellation_reason)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT inventory_transfers_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT inventory_transfers_distinct_warehouses CHECK (source_warehouse_id <> destination_warehouse_id),
  CONSTRAINT inventory_transfers_source_warehouse_fk
    FOREIGN KEY (installation_id, source_warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_transfers_destination_warehouse_fk
    FOREIGN KEY (installation_id, destination_warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_transfers_number_allocation_fk
    FOREIGN KEY (installation_id, document_number_allocation_id)
    REFERENCES shared.document_number_allocations (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_transfers_movement_fk
    FOREIGN KEY (installation_id, inventory_movement_id)
    REFERENCES inventory.inventory_movements (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_transfers_lifecycle_fields CHECK (
    (status = 'draft' AND approved_at IS NULL AND dispatched_at IS NULL AND cancelled_at IS NULL AND inventory_movement_id IS NULL)
    OR (status = 'approved' AND approved_at IS NOT NULL AND approved_by IS NOT NULL AND dispatched_at IS NULL AND cancelled_at IS NULL AND inventory_movement_id IS NULL)
    OR (status = 'dispatched' AND approved_at IS NOT NULL AND approved_by IS NOT NULL AND dispatched_at IS NOT NULL AND dispatched_by IS NOT NULL AND inventory_movement_id IS NOT NULL AND cancelled_at IS NULL)
    OR (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancellation_reason IS NOT NULL AND dispatched_at IS NULL AND inventory_movement_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_transfers_document_number_unique
  ON inventory.inventory_transfers (installation_id, document_number)
  WHERE document_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS inventory_transfers_scope_status_idx
  ON inventory.inventory_transfers (installation_id, source_warehouse_id, destination_warehouse_id, status, transfer_date DESC);
CREATE INDEX IF NOT EXISTS inventory_transfers_movement_idx
  ON inventory.inventory_transfers (installation_id, inventory_movement_id)
  WHERE inventory_movement_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory.inventory_transfer_lines (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  transfer_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  source_location_id uuid NULL,
  source_variant_id uuid NOT NULL,
  source_sku text NOT NULL CHECK (char_length(source_sku) BETWEEN 1 AND 96 AND source_sku = upper(btrim(source_sku))),
  item_name text NOT NULL CHECK (char_length(btrim(item_name)) BETWEEN 1 AND 256),
  source_unit_id uuid NOT NULL,
  source_unit_code text NOT NULL CHECK (char_length(source_unit_code) BETWEEN 1 AND 32 AND source_unit_code = upper(btrim(source_unit_code))),
  source_quantity numeric(20,6) NOT NULL CHECK (source_quantity > 0),
  conversion_to_base numeric(20,6) NOT NULL CHECK (conversion_to_base > 0),
  base_variant_id uuid NOT NULL,
  base_sku text NOT NULL CHECK (char_length(base_sku) BETWEEN 1 AND 96 AND base_sku = upper(btrim(base_sku))),
  base_quantity numeric(30,12) NOT NULL CHECK (base_quantity > 0),
  lot_id uuid NULL,
  lot_code text NULL CHECK (lot_code IS NULL OR char_length(btrim(lot_code)) BETWEEN 1 AND 100),
  expiry_date date NULL,
  note text NULL CHECK (note IS NULL OR char_length(note) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT inventory_transfer_lines_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT inventory_transfer_lines_number_unique UNIQUE (installation_id, transfer_id, line_number),
  CONSTRAINT inventory_transfer_lines_transfer_fk
    FOREIGN KEY (installation_id, transfer_id)
    REFERENCES inventory.inventory_transfers (installation_id, id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT inventory_transfer_lines_location_fk
    FOREIGN KEY (installation_id, source_location_id)
    REFERENCES shared.warehouse_locations (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_transfer_lines_source_variant_fk
    FOREIGN KEY (installation_id, source_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_transfer_lines_base_variant_fk
    FOREIGN KEY (installation_id, base_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_transfer_lines_unit_fk
    FOREIGN KEY (installation_id, source_unit_id)
    REFERENCES shared.units_of_measure (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_transfer_lines_lot_fk
    FOREIGN KEY (installation_id, lot_id)
    REFERENCES inventory.inventory_lots (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_transfer_lines_exact_quantity CHECK (base_quantity = source_quantity * conversion_to_base)
);

CREATE INDEX IF NOT EXISTS inventory_transfer_lines_transfer_idx
  ON inventory.inventory_transfer_lines (installation_id, transfer_id, line_number);
CREATE INDEX IF NOT EXISTS inventory_transfer_lines_in_transit_idx
  ON inventory.inventory_transfer_lines (installation_id, base_variant_id, lot_id, transfer_id);

CREATE OR REPLACE FUNCTION inventory.guard_inventory_transfer_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('dispatched', 'cancelled') THEN
    RAISE EXCEPTION 'inventory_transfer_is_locked';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_transfers_locked_state_guard ON inventory.inventory_transfers;
CREATE TRIGGER inventory_transfers_locked_state_guard
BEFORE UPDATE OR DELETE ON inventory.inventory_transfers
FOR EACH ROW EXECUTE FUNCTION inventory.guard_inventory_transfer_mutation();

CREATE OR REPLACE FUNCTION inventory.guard_inventory_transfer_line_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_status text;
BEGIN
  SELECT status INTO current_status
  FROM inventory.inventory_transfers
  WHERE installation_id = OLD.installation_id AND id = OLD.transfer_id;
  IF current_status <> 'draft' THEN
    RAISE EXCEPTION 'inventory_transfer_lines_are_locked';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS inventory_transfer_lines_locked_state_guard ON inventory.inventory_transfer_lines;
CREATE TRIGGER inventory_transfer_lines_locked_state_guard
BEFORE UPDATE OR DELETE ON inventory.inventory_transfer_lines
FOR EACH ROW EXECUTE FUNCTION inventory.guard_inventory_transfer_line_mutation();

CREATE OR REPLACE VIEW inventory.inventory_transfer_in_transit AS
SELECT
  transfer.installation_id,
  transfer.id AS transfer_id,
  transfer.document_number,
  transfer.transfer_date,
  transfer.source_warehouse_id,
  transfer.destination_warehouse_id,
  transfer.dispatched_at,
  line.id AS transfer_line_id,
  line.line_number,
  line.source_variant_id,
  line.source_sku,
  line.item_name,
  line.source_unit_id,
  line.source_unit_code,
  line.source_quantity,
  line.conversion_to_base,
  line.base_variant_id,
  line.base_sku,
  line.base_quantity,
  line.lot_id,
  line.lot_code,
  line.expiry_date,
  transfer.inventory_movement_id
FROM inventory.inventory_transfers transfer
JOIN inventory.inventory_transfer_lines line
  ON line.installation_id = transfer.installation_id
 AND line.transfer_id = transfer.id
WHERE transfer.status = 'dispatched';
