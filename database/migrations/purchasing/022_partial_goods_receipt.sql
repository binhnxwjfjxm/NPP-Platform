-- Phase 5.2: partial goods receipt foundation.
-- Goods receipts are installation scoped, append-only after posting and tied to
-- inventory movement posting/reversal through the existing inventory contract.

CREATE SCHEMA IF NOT EXISTS purchasing;

INSERT INTO shared.permission_catalog (
  permission_key,
  module,
  label,
  description,
  is_system,
  created_at
) VALUES
  ('core.goods-receipt.read', 'Mua hàng', 'Xem phiếu nhận hàng', 'Cho phép đọc danh sách và chi tiết phiếu nhận hàng trong phạm vi kho được cấp.', true, now()),
  ('core.goods-receipt.create', 'Mua hàng', 'Tạo phiếu nhận hàng', 'Cho phép tạo phiếu nhận hàng nháp cho một PO đã được duyệt.', true, now()),
  ('core.goods-receipt.update', 'Mua hàng', 'Sửa phiếu nhận hàng', 'Cho phép cập nhật phiếu nhận hàng khi còn ở trạng thái nháp.', true, now()),
  ('core.goods-receipt.post', 'Mua hàng', 'Ghi sổ phiếu nhận hàng', 'Cho phép post phiếu nhận hàng và phát sinh inventory movement theo hợp đồng nội bộ.', true, now()),
  ('core.goods-receipt.reverse', 'Mua hàng', 'Đảo phiếu nhận hàng', 'Cho phép phát hành chứng từ bù để đảo phiếu nhận hàng đã post.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS purchasing.goods_receipts (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  purchase_order_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'reversed')),
  document_number text NULL CHECK (document_number IS NULL OR char_length(btrim(document_number)) BETWEEN 1 AND 160),
  document_number_allocation_id uuid NULL,
  receipt_date date NOT NULL,
  supplier_delivery_reference text NULL CHECK (supplier_delivery_reference IS NULL OR char_length(supplier_delivery_reference) <= 256),
  note text NULL CHECK (note IS NULL OR char_length(note) <= 4000),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  posted_at timestamptz NULL,
  posted_by text NULL CHECK (posted_by IS NULL OR char_length(posted_by) BETWEEN 1 AND 128),
  reversed_at timestamptz NULL,
  reversed_by text NULL CHECK (reversed_by IS NULL OR char_length(reversed_by) BETWEEN 1 AND 128),
  reversal_reason text NULL CHECK (reversal_reason IS NULL OR char_length(reversal_reason) <= 1000),
  inventory_movement_id uuid NULL,
  inventory_reversal_movement_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT goods_receipts_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT goods_receipts_purchase_order_installation_fk
    FOREIGN KEY (installation_id, purchase_order_id)
    REFERENCES purchasing.purchase_orders (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT goods_receipts_warehouse_installation_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT goods_receipts_document_number_allocation_fk
    FOREIGN KEY (installation_id, document_number_allocation_id)
    REFERENCES shared.document_number_allocations (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT goods_receipts_inventory_movement_fk
    FOREIGN KEY (installation_id, inventory_movement_id)
    REFERENCES inventory.inventory_movements (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT goods_receipts_inventory_reversal_movement_fk
    FOREIGN KEY (installation_id, inventory_reversal_movement_id)
    REFERENCES inventory.inventory_movements (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT goods_receipts_draft_shape_check CHECK (
    status <> 'draft'
    OR (
      document_number IS NULL
      AND document_number_allocation_id IS NULL
      AND posted_at IS NULL
      AND posted_by IS NULL
      AND reversed_at IS NULL
      AND reversed_by IS NULL
      AND reversal_reason IS NULL
      AND inventory_movement_id IS NULL
      AND inventory_reversal_movement_id IS NULL
    )
  ),
  CONSTRAINT goods_receipts_posted_shape_check CHECK (
    status <> 'posted'
    OR (
      document_number IS NOT NULL
      AND document_number_allocation_id IS NOT NULL
      AND posted_at IS NOT NULL
      AND posted_by IS NOT NULL
      AND reversed_at IS NULL
      AND reversed_by IS NULL
      AND reversal_reason IS NULL
      AND inventory_movement_id IS NOT NULL
      AND inventory_reversal_movement_id IS NULL
    )
  ),
  CONSTRAINT goods_receipts_reversed_shape_check CHECK (
    status <> 'reversed'
    OR (
      document_number IS NOT NULL
      AND document_number_allocation_id IS NOT NULL
      AND posted_at IS NOT NULL
      AND posted_by IS NOT NULL
      AND reversed_at IS NOT NULL
      AND reversed_by IS NOT NULL
      AND reversal_reason IS NOT NULL
      AND inventory_movement_id IS NOT NULL
      AND inventory_reversal_movement_id IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS goods_receipts_number_installation_unique
  ON purchasing.goods_receipts (installation_id, document_number)
  WHERE document_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS goods_receipts_inventory_movement_unique
  ON purchasing.goods_receipts (installation_id, inventory_movement_id)
  WHERE inventory_movement_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS goods_receipts_inventory_reversal_movement_unique
  ON purchasing.goods_receipts (installation_id, inventory_reversal_movement_id)
  WHERE inventory_reversal_movement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS goods_receipts_installation_status_date_idx
  ON purchasing.goods_receipts (installation_id, status, receipt_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS goods_receipts_po_idx
  ON purchasing.goods_receipts (installation_id, purchase_order_id, receipt_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS goods_receipts_warehouse_idx
  ON purchasing.goods_receipts (installation_id, warehouse_id, receipt_date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS purchasing.goods_receipt_lines (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  goods_receipt_id uuid NOT NULL,
  purchase_order_line_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number BETWEEN 1 AND 10000),
  variant_id uuid NOT NULL,
  sku_snapshot text NOT NULL CHECK (char_length(btrim(sku_snapshot)) BETWEEN 1 AND 96),
  item_name_snapshot text NOT NULL CHECK (char_length(btrim(item_name_snapshot)) BETWEEN 1 AND 256),
  unit_id uuid NOT NULL,
  unit_code_snapshot text NOT NULL CHECK (char_length(btrim(unit_code_snapshot)) BETWEEN 1 AND 32),
  conversion_to_base numeric(20,6) NOT NULL CHECK (conversion_to_base > 0),
  ordered_quantity numeric(20,6) NOT NULL CHECK (ordered_quantity > 0),
  received_quantity_before numeric(20,6) NOT NULL DEFAULT 0 CHECK (received_quantity_before >= 0),
  remaining_quantity_before numeric(20,6) NOT NULL CHECK (remaining_quantity_before >= 0),
  received_quantity numeric(20,6) NOT NULL CHECK (received_quantity > 0),
  base_quantity numeric(20,6) NOT NULL CHECK (base_quantity > 0),
  remaining_quantity_after numeric(20,6) NOT NULL CHECK (remaining_quantity_after >= 0),
  location_id uuid NULL,
  lot_id uuid NULL,
  lot_code_snapshot text NULL CHECK (lot_code_snapshot IS NULL OR char_length(btrim(lot_code_snapshot)) BETWEEN 1 AND 100),
  manufactured_date date NULL,
  expiry_date date NULL,
  supplier_lot_reference text NULL CHECK (supplier_lot_reference IS NULL OR char_length(supplier_lot_reference) <= 160),
  note text NULL CHECK (note IS NULL OR char_length(note) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT goods_receipt_lines_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT goods_receipt_lines_receipt_line_unique UNIQUE (installation_id, goods_receipt_id, line_number),
  CONSTRAINT goods_receipt_lines_receipt_po_line_unique UNIQUE (installation_id, goods_receipt_id, purchase_order_line_id),
  CONSTRAINT goods_receipt_lines_receipt_fk
    FOREIGN KEY (installation_id, goods_receipt_id)
    REFERENCES purchasing.goods_receipts (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT goods_receipt_lines_po_line_fk
    FOREIGN KEY (installation_id, purchase_order_line_id)
    REFERENCES purchasing.purchase_order_lines (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT goods_receipt_lines_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT goods_receipt_lines_location_fk
    FOREIGN KEY (installation_id, warehouse_id, location_id)
    REFERENCES shared.warehouse_locations (installation_id, warehouse_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT goods_receipt_lines_variant_fk
    FOREIGN KEY (installation_id, variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT goods_receipt_lines_unit_fk
    FOREIGN KEY (installation_id, unit_id)
    REFERENCES shared.units_of_measure (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT goods_receipt_lines_lot_fk
    FOREIGN KEY (installation_id, lot_id)
    REFERENCES inventory.inventory_lots (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT goods_receipt_lines_conversion_check CHECK (base_quantity = round(received_quantity * conversion_to_base, 6))
);

CREATE INDEX IF NOT EXISTS goods_receipt_lines_receipt_idx
  ON purchasing.goods_receipt_lines (installation_id, goods_receipt_id, line_number);
CREATE INDEX IF NOT EXISTS goods_receipt_lines_po_line_idx
  ON purchasing.goods_receipt_lines (installation_id, purchase_order_line_id);

CREATE OR REPLACE FUNCTION purchasing.guard_goods_receipt_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'goods_receipts_are_immutable';
  END IF;

  IF OLD.status <> 'draft' THEN
    IF NEW.purchase_order_id IS DISTINCT FROM OLD.purchase_order_id
      OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
      OR NEW.receipt_date IS DISTINCT FROM OLD.receipt_date
      OR NEW.supplier_delivery_reference IS DISTINCT FROM OLD.supplier_delivery_reference
      OR NEW.note IS DISTINCT FROM OLD.note THEN
      RAISE EXCEPTION 'goods_receipts_are_immutable';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS goods_receipts_guard_mutation ON purchasing.goods_receipts;
CREATE TRIGGER goods_receipts_guard_mutation
BEFORE UPDATE OR DELETE ON purchasing.goods_receipts
FOR EACH ROW EXECUTE FUNCTION purchasing.guard_goods_receipt_mutation();

CREATE OR REPLACE FUNCTION purchasing.guard_goods_receipt_line_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_status text;
  target_installation text;
  target_receipt uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_installation := OLD.installation_id;
    target_receipt := OLD.goods_receipt_id;
  ELSE
    target_installation := NEW.installation_id;
    target_receipt := NEW.goods_receipt_id;
  END IF;

  SELECT status INTO current_status
    FROM purchasing.goods_receipts
   WHERE installation_id = target_installation
     AND id = target_receipt;

  IF current_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'goods_receipt_lines_locked';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS goods_receipt_lines_draft_only ON purchasing.goods_receipt_lines;
CREATE TRIGGER goods_receipt_lines_draft_only
BEFORE INSERT OR UPDATE OR DELETE ON purchasing.goods_receipt_lines
FOR EACH ROW EXECUTE FUNCTION purchasing.guard_goods_receipt_line_mutation();
