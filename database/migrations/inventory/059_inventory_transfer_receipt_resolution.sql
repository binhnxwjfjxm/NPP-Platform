-- Phase 7.2: transfer receipt, partial receipt, shortage closure and damage/overage evidence.
-- Dispatch remains immutable. Receipt/resolution facts are append-only and the in-transit
-- projection is derived from the dispatch quantity minus effective accepted, damaged and short quantities.

INSERT INTO shared.permission_catalog (
  permission_key,
  module,
  label,
  description,
  is_system,
  created_at
) VALUES
  ('core.inventory-transfer.receive', 'Kho', 'Nhận hàng chuyển kho', 'Cho phép ghi nhận hàng đạt, hư hỏng và hàng thừa chờ xác minh tại kho đích.', true, now()),
  ('core.inventory-transfer.damage-approve', 'Kho', 'Duyệt hư hỏng chuyển kho', 'Cho phép quản lý kho đích xác nhận biên bản hư hỏng của lần nhận chuyển kho.', true, now()),
  ('core.inventory-transfer.resolve', 'Kho', 'Đóng chênh lệch chuyển kho', 'Cho phép quản lý kho đóng phần thiếu có lý do, không sửa số lượng xuất gốc.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS inventory.inventory_transfer_receipts (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  transfer_id uuid NOT NULL,
  receipt_sequence integer NOT NULL CHECK (receipt_sequence > 0),
  receipt_date date NOT NULL,
  inventory_movement_id uuid NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  note text NULL CHECK (note IS NULL OR char_length(note) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT inventory_transfer_receipts_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT inventory_transfer_receipts_sequence_unique UNIQUE (installation_id, transfer_id, receipt_sequence),
  CONSTRAINT inventory_transfer_receipts_idempotency_unique UNIQUE (installation_id, idempotency_key),
  CONSTRAINT inventory_transfer_receipts_transfer_fk
    FOREIGN KEY (installation_id, transfer_id)
    REFERENCES inventory.inventory_transfers (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_transfer_receipts_movement_fk
    FOREIGN KEY (installation_id, inventory_movement_id)
    REFERENCES inventory.inventory_movements (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS inventory_transfer_receipts_transfer_idx
  ON inventory.inventory_transfer_receipts (installation_id, transfer_id, receipt_sequence);
CREATE INDEX IF NOT EXISTS inventory_transfer_receipts_movement_idx
  ON inventory.inventory_transfer_receipts (installation_id, inventory_movement_id)
  WHERE inventory_movement_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory.inventory_transfer_receipt_lines (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  receipt_id uuid NOT NULL,
  transfer_line_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  destination_location_id uuid NULL,
  accepted_source_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (accepted_source_quantity >= 0),
  damaged_source_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (damaged_source_quantity >= 0),
  over_source_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK (over_source_quantity >= 0),
  conversion_to_base numeric(20,6) NOT NULL CHECK (conversion_to_base > 0),
  accepted_base_quantity numeric(30,12) NOT NULL DEFAULT 0 CHECK (accepted_base_quantity >= 0),
  damaged_base_quantity numeric(30,12) NOT NULL DEFAULT 0 CHECK (damaged_base_quantity >= 0),
  over_base_quantity numeric(30,12) NOT NULL DEFAULT 0 CHECK (over_base_quantity >= 0),
  note text NULL CHECK (note IS NULL OR char_length(note) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT inventory_transfer_receipt_lines_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT inventory_transfer_receipt_lines_number_unique UNIQUE (installation_id, receipt_id, line_number),
  CONSTRAINT inventory_transfer_receipt_lines_transfer_line_unique UNIQUE (installation_id, receipt_id, transfer_line_id),
  CONSTRAINT inventory_transfer_receipt_lines_receipt_fk
    FOREIGN KEY (installation_id, receipt_id)
    REFERENCES inventory.inventory_transfer_receipts (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_transfer_receipt_lines_transfer_line_fk
    FOREIGN KEY (installation_id, transfer_line_id)
    REFERENCES inventory.inventory_transfer_lines (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_transfer_receipt_lines_location_fk
    FOREIGN KEY (installation_id, destination_location_id)
    REFERENCES shared.warehouse_locations (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_transfer_receipt_lines_has_quantity CHECK (
    accepted_source_quantity + damaged_source_quantity + over_source_quantity > 0
  ),
  CONSTRAINT inventory_transfer_receipt_lines_accepted_exact CHECK (
    accepted_base_quantity = accepted_source_quantity * conversion_to_base
  ),
  CONSTRAINT inventory_transfer_receipt_lines_damaged_exact CHECK (
    damaged_base_quantity = damaged_source_quantity * conversion_to_base
  ),
  CONSTRAINT inventory_transfer_receipt_lines_over_exact CHECK (
    over_base_quantity = over_source_quantity * conversion_to_base
  )
);

CREATE INDEX IF NOT EXISTS inventory_transfer_receipt_lines_transfer_line_idx
  ON inventory.inventory_transfer_receipt_lines (installation_id, transfer_line_id, receipt_id);

CREATE TABLE IF NOT EXISTS inventory.inventory_transfer_damage_approvals (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  receipt_id uuid NOT NULL,
  approval_note text NULL CHECK (approval_note IS NULL OR char_length(approval_note) <= 2000),
  approved_at timestamptz NOT NULL DEFAULT now(),
  approved_by text NOT NULL CHECK (char_length(approved_by) BETWEEN 1 AND 128),
  CONSTRAINT inventory_transfer_damage_approvals_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT inventory_transfer_damage_approvals_receipt_unique UNIQUE (installation_id, receipt_id),
  CONSTRAINT inventory_transfer_damage_approvals_receipt_fk
    FOREIGN KEY (installation_id, receipt_id)
    REFERENCES inventory.inventory_transfer_receipts (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS inventory.inventory_transfer_short_closures (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  transfer_id uuid NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
  closed_at timestamptz NOT NULL DEFAULT now(),
  closed_by text NOT NULL CHECK (char_length(closed_by) BETWEEN 1 AND 128),
  CONSTRAINT inventory_transfer_short_closures_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT inventory_transfer_short_closures_transfer_unique UNIQUE (installation_id, transfer_id),
  CONSTRAINT inventory_transfer_short_closures_transfer_fk
    FOREIGN KEY (installation_id, transfer_id)
    REFERENCES inventory.inventory_transfers (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS inventory.inventory_transfer_short_closure_lines (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  closure_id uuid NOT NULL,
  transfer_line_id uuid NOT NULL,
  short_source_quantity numeric(20,6) NOT NULL CHECK (short_source_quantity > 0),
  conversion_to_base numeric(20,6) NOT NULL CHECK (conversion_to_base > 0),
  short_base_quantity numeric(30,12) NOT NULL CHECK (short_base_quantity > 0),
  CONSTRAINT inventory_transfer_short_closure_lines_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT inventory_transfer_short_closure_lines_transfer_line_unique UNIQUE (installation_id, closure_id, transfer_line_id),
  CONSTRAINT inventory_transfer_short_closure_lines_closure_fk
    FOREIGN KEY (installation_id, closure_id)
    REFERENCES inventory.inventory_transfer_short_closures (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_transfer_short_closure_lines_transfer_line_fk
    FOREIGN KEY (installation_id, transfer_line_id)
    REFERENCES inventory.inventory_transfer_lines (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_transfer_short_closure_lines_exact CHECK (
    short_base_quantity = short_source_quantity * conversion_to_base
  )
);

CREATE TABLE IF NOT EXISTS inventory.inventory_transfer_receipt_reversals (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  receipt_id uuid NOT NULL,
  reversal_movement_id uuid NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
  reversed_at timestamptz NOT NULL DEFAULT now(),
  reversed_by text NOT NULL CHECK (char_length(reversed_by) BETWEEN 1 AND 128),
  CONSTRAINT inventory_transfer_receipt_reversals_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT inventory_transfer_receipt_reversals_receipt_unique UNIQUE (installation_id, receipt_id),
  CONSTRAINT inventory_transfer_receipt_reversals_receipt_fk
    FOREIGN KEY (installation_id, receipt_id)
    REFERENCES inventory.inventory_transfer_receipts (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT inventory_transfer_receipt_reversals_movement_fk
    FOREIGN KEY (installation_id, reversal_movement_id)
    REFERENCES inventory.inventory_movements (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION inventory.prevent_inventory_transfer_resolution_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'inventory_transfer_resolution_rows_are_append_only';
END;
$$;

DROP TRIGGER IF EXISTS inventory_transfer_receipts_append_only ON inventory.inventory_transfer_receipts;
CREATE TRIGGER inventory_transfer_receipts_append_only
BEFORE UPDATE OR DELETE ON inventory.inventory_transfer_receipts
FOR EACH ROW EXECUTE FUNCTION inventory.prevent_inventory_transfer_resolution_mutation();

DROP TRIGGER IF EXISTS inventory_transfer_receipt_lines_append_only ON inventory.inventory_transfer_receipt_lines;
CREATE TRIGGER inventory_transfer_receipt_lines_append_only
BEFORE UPDATE OR DELETE ON inventory.inventory_transfer_receipt_lines
FOR EACH ROW EXECUTE FUNCTION inventory.prevent_inventory_transfer_resolution_mutation();

DROP TRIGGER IF EXISTS inventory_transfer_damage_approvals_append_only ON inventory.inventory_transfer_damage_approvals;
CREATE TRIGGER inventory_transfer_damage_approvals_append_only
BEFORE UPDATE OR DELETE ON inventory.inventory_transfer_damage_approvals
FOR EACH ROW EXECUTE FUNCTION inventory.prevent_inventory_transfer_resolution_mutation();

DROP TRIGGER IF EXISTS inventory_transfer_short_closures_append_only ON inventory.inventory_transfer_short_closures;
CREATE TRIGGER inventory_transfer_short_closures_append_only
BEFORE UPDATE OR DELETE ON inventory.inventory_transfer_short_closures
FOR EACH ROW EXECUTE FUNCTION inventory.prevent_inventory_transfer_resolution_mutation();

DROP TRIGGER IF EXISTS inventory_transfer_short_closure_lines_append_only ON inventory.inventory_transfer_short_closure_lines;
CREATE TRIGGER inventory_transfer_short_closure_lines_append_only
BEFORE UPDATE OR DELETE ON inventory.inventory_transfer_short_closure_lines
FOR EACH ROW EXECUTE FUNCTION inventory.prevent_inventory_transfer_resolution_mutation();

DROP TRIGGER IF EXISTS inventory_transfer_receipt_reversals_append_only ON inventory.inventory_transfer_receipt_reversals;
CREATE TRIGGER inventory_transfer_receipt_reversals_append_only
BEFORE UPDATE OR DELETE ON inventory.inventory_transfer_receipt_reversals
FOR EACH ROW EXECUTE FUNCTION inventory.prevent_inventory_transfer_resolution_mutation();

CREATE OR REPLACE VIEW inventory.inventory_transfer_line_resolution AS
SELECT
  line.installation_id,
  line.transfer_id,
  line.id AS transfer_line_id,
  line.source_quantity AS dispatched_source_quantity,
  line.base_quantity AS dispatched_base_quantity,
  COALESCE(receipt.accepted_source_quantity, 0)::numeric(20,6) AS accepted_source_quantity,
  COALESCE(receipt.damaged_source_quantity, 0)::numeric(20,6) AS damaged_source_quantity,
  COALESCE(receipt.over_source_quantity, 0)::numeric(20,6) AS over_source_quantity,
  COALESCE(receipt.accepted_base_quantity, 0)::numeric(30,12) AS accepted_base_quantity,
  COALESCE(receipt.damaged_base_quantity, 0)::numeric(30,12) AS damaged_base_quantity,
  COALESCE(receipt.over_base_quantity, 0)::numeric(30,12) AS over_base_quantity,
  COALESCE(shortage.short_source_quantity, 0)::numeric(20,6) AS short_source_quantity,
  COALESCE(shortage.short_base_quantity, 0)::numeric(30,12) AS short_base_quantity,
  greatest(
    line.source_quantity
      - COALESCE(receipt.accepted_source_quantity, 0)
      - COALESCE(receipt.damaged_source_quantity, 0)
      - COALESCE(shortage.short_source_quantity, 0),
    0
  )::numeric(20,6) AS remaining_source_quantity,
  greatest(
    line.base_quantity
      - COALESCE(receipt.accepted_base_quantity, 0)
      - COALESCE(receipt.damaged_base_quantity, 0)
      - COALESCE(shortage.short_base_quantity, 0),
    0
  )::numeric(30,12) AS remaining_base_quantity
FROM inventory.inventory_transfer_lines line
LEFT JOIN LATERAL (
  SELECT
    sum(receipt_line.accepted_source_quantity) AS accepted_source_quantity,
    sum(receipt_line.damaged_source_quantity) AS damaged_source_quantity,
    sum(receipt_line.over_source_quantity) AS over_source_quantity,
    sum(receipt_line.accepted_base_quantity) AS accepted_base_quantity,
    sum(receipt_line.damaged_base_quantity) AS damaged_base_quantity,
    sum(receipt_line.over_base_quantity) AS over_base_quantity
  FROM inventory.inventory_transfer_receipt_lines receipt_line
  JOIN inventory.inventory_transfer_receipts receipt_header
    ON receipt_header.installation_id = receipt_line.installation_id
   AND receipt_header.id = receipt_line.receipt_id
  LEFT JOIN inventory.inventory_transfer_receipt_reversals reversal
    ON reversal.installation_id = receipt_header.installation_id
   AND reversal.receipt_id = receipt_header.id
  WHERE receipt_line.installation_id = line.installation_id
    AND receipt_line.transfer_line_id = line.id
    AND reversal.id IS NULL
) receipt ON true
LEFT JOIN LATERAL (
  SELECT
    sum(short_line.short_source_quantity) AS short_source_quantity,
    sum(short_line.short_base_quantity) AS short_base_quantity
  FROM inventory.inventory_transfer_short_closure_lines short_line
  JOIN inventory.inventory_transfer_short_closures closure
    ON closure.installation_id = short_line.installation_id
   AND closure.id = short_line.closure_id
  WHERE short_line.installation_id = line.installation_id
    AND short_line.transfer_line_id = line.id
) shortage ON true;

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
  resolution.remaining_source_quantity AS source_quantity,
  line.source_quantity AS dispatched_source_quantity,
  line.conversion_to_base,
  line.base_variant_id,
  line.base_sku,
  resolution.remaining_base_quantity AS base_quantity,
  line.base_quantity AS dispatched_base_quantity,
  resolution.accepted_base_quantity,
  resolution.damaged_base_quantity,
  resolution.short_base_quantity,
  resolution.over_base_quantity,
  line.lot_id,
  line.lot_code,
  line.expiry_date,
  transfer.inventory_movement_id
FROM inventory.inventory_transfers transfer
JOIN inventory.inventory_transfer_lines line
  ON line.installation_id = transfer.installation_id
 AND line.transfer_id = transfer.id
JOIN inventory.inventory_transfer_line_resolution resolution
  ON resolution.installation_id = line.installation_id
 AND resolution.transfer_line_id = line.id
WHERE transfer.status = 'dispatched'
  AND resolution.remaining_base_quantity > 0;
