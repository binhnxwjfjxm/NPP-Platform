-- Phase 5.4: supplier return foundation.
-- Supplier returns issue previously accepted, posted inventory back to the same supplier.
-- Draft and approval stages are non-posting. Posting allocates the official number atomically.
-- Reversals use the standard inventory reversal contract.

CREATE SCHEMA IF NOT EXISTS purchasing;

INSERT INTO shared.permission_catalog (
  permission_key,
  module,
  label,
  description,
  is_system,
  created_at
) VALUES
  ('core.supplier-return.read', 'Mua hàng', 'Xem phiếu trả nhà cung cấp', 'Cho phép đọc danh sách, chi tiết và lịch sử phiếu trả nhà cung cấp trong phạm vi kho được cấp.', true, now()),
  ('core.supplier-return.create', 'Mua hàng', 'Tạo phiếu trả nhà cung cấp', 'Cho phép tạo phiếu trả nhà cung cấp nháp từ các dòng phiếu nhận hàng đã ghi sổ.', true, now()),
  ('core.supplier-return.update', 'Mua hàng', 'Sửa phiếu trả nhà cung cấp', 'Cho phép cập nhật phiếu trả nhà cung cấp khi còn ở trạng thái nháp.', true, now()),
  ('core.supplier-return.submit', 'Mua hàng', 'Gửi duyệt phiếu trả nhà cung cấp', 'Cho phép chuyển phiếu trả nhà cung cấp từ nháp sang chờ duyệt.', true, now()),
  ('core.supplier-return.approve', 'Mua hàng', 'Duyệt phiếu trả nhà cung cấp', 'Cho phép duyệt phiếu trả nhà cung cấp trước khi ghi sổ.', true, now()),
  ('core.supplier-return.cancel', 'Mua hàng', 'Hủy phiếu trả nhà cung cấp', 'Cho phép hủy phiếu trả nhà cung cấp trước khi ghi sổ với lý do bắt buộc.', true, now()),
  ('core.supplier-return.post', 'Mua hàng', 'Ghi sổ phiếu trả nhà cung cấp', 'Cho phép ghi sổ phiếu trả nhà cung cấp và phát sinh inventory movement xuất kho.', true, now()),
  ('core.supplier-return.reverse', 'Mua hàng', 'Đảo phiếu trả nhà cung cấp', 'Cho phép phát hành chứng từ bù để đảo phiếu trả nhà cung cấp đã ghi sổ.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS purchasing.supplier_returns (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  supplier_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'pending_approval', 'approved', 'posted', 'reversed', 'cancelled'
  )),
  document_number text NULL CHECK (document_number IS NULL OR char_length(btrim(document_number)) BETWEEN 1 AND 160),
  document_number_allocation_id uuid NULL,
  return_date date NOT NULL,
  note text NULL CHECK (note IS NULL OR char_length(note) <= 4000),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  submitted_at timestamptz NULL,
  submitted_by text NULL CHECK (submitted_by IS NULL OR char_length(submitted_by) BETWEEN 1 AND 128),
  approved_at timestamptz NULL,
  approved_by text NULL CHECK (approved_by IS NULL OR char_length(approved_by) BETWEEN 1 AND 128),
  cancelled_at timestamptz NULL,
  cancelled_by text NULL CHECK (cancelled_by IS NULL OR char_length(cancelled_by) BETWEEN 1 AND 128),
  cancellation_reason text NULL CHECK (cancellation_reason IS NULL OR char_length(cancellation_reason) <= 1000),
  posted_at timestamptz NULL,
  posted_by text NULL CHECK (posted_by IS NULL OR char_length(posted_by) BETWEEN 1 AND 128),
  reversed_at timestamptz NULL,
  reversed_by text NULL CHECK (reversed_by IS NULL OR char_length(reversed_by) BETWEEN 1 AND 128),
  reversal_reason text NULL CHECK (reversal_reason IS NULL OR char_length(reversal_reason) <= 2000),
  inventory_movement_id uuid NULL,
  inventory_reversal_movement_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT supplier_returns_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT supplier_returns_supplier_installation_fk
    FOREIGN KEY (installation_id, supplier_id)
    REFERENCES shared.suppliers (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT supplier_returns_warehouse_installation_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT supplier_returns_document_number_allocation_fk
    FOREIGN KEY (installation_id, document_number_allocation_id)
    REFERENCES shared.document_number_allocations (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT supplier_returns_inventory_movement_fk
    FOREIGN KEY (installation_id, inventory_movement_id)
    REFERENCES inventory.inventory_movements (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT supplier_returns_inventory_reversal_movement_fk
    FOREIGN KEY (installation_id, inventory_reversal_movement_id)
    REFERENCES inventory.inventory_movements (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT supplier_returns_draft_shape_check CHECK (
    status <> 'draft'
    OR (
      document_number IS NULL
      AND document_number_allocation_id IS NULL
      AND submitted_at IS NULL
      AND submitted_by IS NULL
      AND approved_at IS NULL
      AND approved_by IS NULL
      AND cancelled_at IS NULL
      AND cancelled_by IS NULL
      AND cancellation_reason IS NULL
      AND posted_at IS NULL
      AND posted_by IS NULL
      AND reversed_at IS NULL
      AND reversed_by IS NULL
      AND reversal_reason IS NULL
      AND inventory_movement_id IS NULL
      AND inventory_reversal_movement_id IS NULL
    )
  ),
  CONSTRAINT supplier_returns_pending_shape_check CHECK (
    status <> 'pending_approval'
    OR (
      submitted_at IS NOT NULL
      AND submitted_by IS NOT NULL
      AND approved_at IS NULL
      AND approved_by IS NULL
      AND cancelled_at IS NULL
      AND cancelled_by IS NULL
      AND posted_at IS NULL
      AND posted_by IS NULL
      AND reversed_at IS NULL
      AND reversed_by IS NULL
      AND reversal_reason IS NULL
      AND document_number IS NULL
      AND document_number_allocation_id IS NULL
      AND inventory_movement_id IS NULL
      AND inventory_reversal_movement_id IS NULL
    )
  ),
  CONSTRAINT supplier_returns_approved_shape_check CHECK (
    status <> 'approved'
    OR (
      submitted_at IS NOT NULL
      AND submitted_by IS NOT NULL
      AND approved_at IS NOT NULL
      AND approved_by IS NOT NULL
      AND cancelled_at IS NULL
      AND cancelled_by IS NULL
      AND posted_at IS NULL
      AND posted_by IS NULL
      AND reversed_at IS NULL
      AND reversed_by IS NULL
      AND reversal_reason IS NULL
      AND document_number IS NULL
      AND document_number_allocation_id IS NULL
      AND inventory_movement_id IS NULL
      AND inventory_reversal_movement_id IS NULL
    )
  ),
  CONSTRAINT supplier_returns_posted_shape_check CHECK (
    status <> 'posted'
    OR (
      document_number IS NOT NULL
      AND document_number_allocation_id IS NOT NULL
      AND submitted_at IS NOT NULL
      AND submitted_by IS NOT NULL
      AND approved_at IS NOT NULL
      AND approved_by IS NOT NULL
      AND posted_at IS NOT NULL
      AND posted_by IS NOT NULL
      AND cancelled_at IS NULL
      AND cancelled_by IS NULL
      AND reversal_reason IS NULL
      AND reversed_at IS NULL
      AND reversed_by IS NULL
      AND inventory_movement_id IS NOT NULL
      AND inventory_reversal_movement_id IS NULL
    )
  ),
  CONSTRAINT supplier_returns_reversed_shape_check CHECK (
    status <> 'reversed'
    OR (
      document_number IS NOT NULL
      AND document_number_allocation_id IS NOT NULL
      AND submitted_at IS NOT NULL
      AND submitted_by IS NOT NULL
      AND approved_at IS NOT NULL
      AND approved_by IS NOT NULL
      AND posted_at IS NOT NULL
      AND posted_by IS NOT NULL
      AND reversed_at IS NOT NULL
      AND reversed_by IS NOT NULL
      AND reversal_reason IS NOT NULL
      AND inventory_movement_id IS NOT NULL
      AND inventory_reversal_movement_id IS NOT NULL
    )
  ),
  CONSTRAINT supplier_returns_cancelled_shape_check CHECK (
    status <> 'cancelled'
    OR (
      cancelled_at IS NOT NULL
      AND cancelled_by IS NOT NULL
      AND cancellation_reason IS NOT NULL
      AND document_number IS NULL
      AND document_number_allocation_id IS NULL
      AND inventory_movement_id IS NULL
      AND inventory_reversal_movement_id IS NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS supplier_returns_number_installation_unique
  ON purchasing.supplier_returns (installation_id, document_number)
  WHERE document_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS supplier_returns_inventory_movement_unique
  ON purchasing.supplier_returns (installation_id, inventory_movement_id)
  WHERE inventory_movement_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS supplier_returns_inventory_reversal_movement_unique
  ON purchasing.supplier_returns (installation_id, inventory_reversal_movement_id)
  WHERE inventory_reversal_movement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS supplier_returns_installation_status_date_idx
  ON purchasing.supplier_returns (installation_id, status, return_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS supplier_returns_supplier_idx
  ON purchasing.supplier_returns (installation_id, supplier_id, return_date DESC);
CREATE INDEX IF NOT EXISTS supplier_returns_warehouse_idx
  ON purchasing.supplier_returns (installation_id, warehouse_id, return_date DESC);

CREATE TABLE IF NOT EXISTS purchasing.supplier_return_lines (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  supplier_return_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number BETWEEN 1 AND 10000),
  source_goods_receipt_id uuid NOT NULL,
  source_goods_receipt_number text NOT NULL CHECK (char_length(btrim(source_goods_receipt_number)) BETWEEN 1 AND 160),
  source_goods_receipt_status text NOT NULL CHECK (char_length(btrim(source_goods_receipt_status)) BETWEEN 1 AND 64),
  source_goods_receipt_line_id uuid NOT NULL,
  source_goods_receipt_line_number integer NOT NULL CHECK (source_goods_receipt_line_number BETWEEN 1 AND 10000),
  source_purchase_order_id uuid NOT NULL,
  source_purchase_order_number text NOT NULL CHECK (char_length(btrim(source_purchase_order_number)) BETWEEN 1 AND 160),
  source_purchase_order_line_id uuid NOT NULL,
  source_purchase_order_line_number integer NOT NULL CHECK (source_purchase_order_line_number BETWEEN 1 AND 10000),
  source_supplier_id uuid NOT NULL,
  source_supplier_code text NOT NULL CHECK (char_length(btrim(source_supplier_code)) BETWEEN 1 AND 96),
  source_supplier_name text NOT NULL CHECK (char_length(btrim(source_supplier_name)) BETWEEN 1 AND 256),
  source_warehouse_id uuid NOT NULL,
  source_warehouse_code text NOT NULL CHECK (char_length(btrim(source_warehouse_code)) BETWEEN 1 AND 32),
  source_warehouse_name text NOT NULL CHECK (char_length(btrim(source_warehouse_name)) BETWEEN 1 AND 256),
  source_variant_id uuid NOT NULL,
  source_sku_snapshot text NOT NULL CHECK (char_length(btrim(source_sku_snapshot)) BETWEEN 1 AND 96),
  source_item_name_snapshot text NOT NULL CHECK (char_length(btrim(source_item_name_snapshot)) BETWEEN 1 AND 256),
  source_unit_id uuid NOT NULL,
  source_unit_code_snapshot text NOT NULL CHECK (char_length(btrim(source_unit_code_snapshot)) BETWEEN 1 AND 32),
  base_variant_id uuid NOT NULL,
  base_sku_snapshot text NOT NULL CHECK (char_length(btrim(base_sku_snapshot)) BETWEEN 1 AND 96),
  conversion_to_base numeric(20,6) NOT NULL CHECK (conversion_to_base > 0),
  source_accepted_quantity numeric(20,6) NOT NULL CHECK (source_accepted_quantity > 0),
  return_quantity numeric(20,6) NOT NULL CHECK (return_quantity > 0),
  base_quantity numeric(20,6) NOT NULL CHECK (base_quantity > 0),
  reason_code text NOT NULL CHECK (char_length(btrim(reason_code)) BETWEEN 1 AND 64),
  reason_note text NOT NULL CHECK (char_length(btrim(reason_note)) BETWEEN 1 AND 2000),
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
  CONSTRAINT supplier_return_lines_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT supplier_return_lines_return_line_unique UNIQUE (installation_id, supplier_return_id, line_number),
  CONSTRAINT supplier_return_lines_return_source_line_unique UNIQUE (installation_id, supplier_return_id, source_goods_receipt_line_id),
  CONSTRAINT supplier_return_lines_return_fk
    FOREIGN KEY (installation_id, supplier_return_id)
    REFERENCES purchasing.supplier_returns (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT supplier_return_lines_goods_receipt_fk
    FOREIGN KEY (installation_id, source_goods_receipt_id)
    REFERENCES purchasing.goods_receipts (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT supplier_return_lines_goods_receipt_line_fk
    FOREIGN KEY (installation_id, source_goods_receipt_line_id)
    REFERENCES purchasing.goods_receipt_lines (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT supplier_return_lines_purchase_order_fk
    FOREIGN KEY (installation_id, source_purchase_order_id)
    REFERENCES purchasing.purchase_orders (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT supplier_return_lines_purchase_order_line_fk
    FOREIGN KEY (installation_id, source_purchase_order_line_id)
    REFERENCES purchasing.purchase_order_lines (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT supplier_return_lines_supplier_fk
    FOREIGN KEY (installation_id, source_supplier_id)
    REFERENCES shared.suppliers (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT supplier_return_lines_warehouse_fk
    FOREIGN KEY (installation_id, source_warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT supplier_return_lines_location_fk
    FOREIGN KEY (installation_id, source_warehouse_id, location_id)
    REFERENCES shared.warehouse_locations (installation_id, warehouse_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT supplier_return_lines_variant_fk
    FOREIGN KEY (installation_id, source_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT supplier_return_lines_unit_fk
    FOREIGN KEY (installation_id, source_unit_id)
    REFERENCES shared.units_of_measure (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT supplier_return_lines_base_variant_fk
    FOREIGN KEY (installation_id, base_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT supplier_return_lines_conversion_check CHECK (base_quantity = round(return_quantity * conversion_to_base, 6)),
  CONSTRAINT supplier_return_lines_reason_check CHECK (
    char_length(btrim(reason_code)) > 0
    AND char_length(btrim(reason_note)) > 0
  )
);

CREATE INDEX IF NOT EXISTS supplier_return_lines_return_idx
  ON purchasing.supplier_return_lines (installation_id, supplier_return_id, line_number);
CREATE INDEX IF NOT EXISTS supplier_return_lines_source_goods_receipt_line_idx
  ON purchasing.supplier_return_lines (installation_id, source_goods_receipt_line_id);
CREATE INDEX IF NOT EXISTS supplier_return_lines_source_goods_receipt_idx
  ON purchasing.supplier_return_lines (installation_id, source_goods_receipt_id);

CREATE OR REPLACE FUNCTION purchasing.guard_supplier_return_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_status text;
  target_installation text;
  target_return uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_installation := OLD.installation_id;
    target_return := OLD.supplier_return_id;
  ELSE
    target_installation := NEW.installation_id;
    target_return := NEW.supplier_return_id;
  END IF;

  SELECT status INTO current_status
  FROM purchasing.supplier_returns
  WHERE installation_id = target_installation AND id = target_return;

  IF current_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'supplier_returns_locked';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supplier_return_lines_draft_only ON purchasing.supplier_return_lines;
CREATE TRIGGER supplier_return_lines_draft_only
BEFORE INSERT OR UPDATE OR DELETE ON purchasing.supplier_return_lines
FOR EACH ROW EXECUTE FUNCTION purchasing.guard_supplier_return_mutation();

CREATE OR REPLACE FUNCTION purchasing.guard_supplier_return_document_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'supplier_returns_are_immutable';
  END IF;

  IF OLD.status <> 'draft' THEN
    IF NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
      OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
      OR NEW.return_date IS DISTINCT FROM OLD.return_date
      OR NEW.note IS DISTINCT FROM OLD.note THEN
      RAISE EXCEPTION 'supplier_returns_are_immutable';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supplier_returns_guard_mutation ON purchasing.supplier_returns;
CREATE TRIGGER supplier_returns_guard_mutation
BEFORE UPDATE OR DELETE ON purchasing.supplier_returns
FOR EACH ROW EXECUTE FUNCTION purchasing.guard_supplier_return_document_mutation();

CREATE OR REPLACE FUNCTION purchasing.guard_goods_receipt_reversal_with_supplier_returns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'posted' AND NEW.status = 'reversed' THEN
    IF EXISTS (
      SELECT 1
        FROM purchasing.supplier_return_lines srl
        JOIN purchasing.supplier_returns sr
          ON sr.installation_id = srl.installation_id
         AND sr.id = srl.supplier_return_id
       WHERE srl.installation_id = OLD.installation_id
         AND srl.source_goods_receipt_id = OLD.id
         AND sr.status IN ('pending_approval', 'approved', 'posted')
    ) THEN
      RAISE EXCEPTION 'goods_receipt_has_active_supplier_return';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS goods_receipts_supplier_return_reversal_guard ON purchasing.goods_receipts;
CREATE TRIGGER goods_receipts_supplier_return_reversal_guard
BEFORE UPDATE ON purchasing.goods_receipts
FOR EACH ROW EXECUTE FUNCTION purchasing.guard_goods_receipt_reversal_with_supplier_returns();
