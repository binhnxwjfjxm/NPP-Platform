-- Phase 5.1: Purchase Order foundation.
-- Purchase orders are installation scoped. Drafts are editable; approved/cancelled
-- documents are immutable through the service contract. No inventory or payable
-- posting is performed by this migration.

CREATE SCHEMA IF NOT EXISTS purchasing;

INSERT INTO shared.permission_catalog (
  permission_key,
  module,
  label,
  description,
  is_system,
  created_at
) VALUES
  ('core.purchase-order.read', 'Mua hàng', 'Xem đơn đặt hàng', 'Cho phép đọc danh sách và chi tiết đơn đặt hàng trong phạm vi kho được cấp.', true, now()),
  ('core.purchase-order.create', 'Mua hàng', 'Tạo đơn đặt hàng', 'Cho phép tạo đơn đặt hàng ở trạng thái nháp.', true, now()),
  ('core.purchase-order.update', 'Mua hàng', 'Sửa đơn đặt hàng', 'Cho phép cập nhật đơn đặt hàng khi còn ở trạng thái nháp.', true, now()),
  ('core.purchase-order.submit', 'Mua hàng', 'Gửi duyệt đơn đặt hàng', 'Cho phép gửi đơn đặt hàng nháp sang trạng thái chờ duyệt.', true, now()),
  ('core.purchase-order.approve', 'Mua hàng', 'Duyệt đơn đặt hàng', 'Cho phép duyệt đơn đặt hàng, cấp số chứng từ và khóa nội dung.', true, now()),
  ('core.purchase-order.cancel', 'Mua hàng', 'Hủy đơn đặt hàng', 'Cho phép hủy đơn đặt hàng theo chính sách trạng thái.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS purchasing.purchase_orders (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  document_number text NULL CHECK (document_number IS NULL OR char_length(btrim(document_number)) BETWEEN 1 AND 160),
  document_number_allocation_id uuid NULL,
  supplier_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'pending_approval', 'approved', 'partially_received', 'fully_received', 'closed', 'cancelled'
  )),
  order_date date NOT NULL,
  expected_date date NULL,
  supplier_reference text NULL CHECK (supplier_reference IS NULL OR char_length(supplier_reference) <= 256),
  currency_code text NOT NULL DEFAULT 'VND' CHECK (
    char_length(currency_code) = 3 AND currency_code = upper(currency_code)
  ),
  note text NULL CHECK (note IS NULL OR char_length(note) <= 4000),
  subtotal numeric(20,6) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_total numeric(20,6) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  tax_total numeric(20,6) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total numeric(20,6) NOT NULL DEFAULT 0 CHECK (total >= 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  submitted_at timestamptz NULL,
  submitted_by text NULL CHECK (submitted_by IS NULL OR char_length(submitted_by) BETWEEN 1 AND 128),
  approved_at timestamptz NULL,
  approved_by text NULL CHECK (approved_by IS NULL OR char_length(approved_by) BETWEEN 1 AND 128),
  cancelled_at timestamptz NULL,
  cancelled_by text NULL CHECK (cancelled_by IS NULL OR char_length(cancelled_by) BETWEEN 1 AND 128),
  cancellation_reason text NULL CHECK (cancellation_reason IS NULL OR char_length(cancellation_reason) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT purchase_orders_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT purchase_orders_supplier_installation_fk
    FOREIGN KEY (installation_id, supplier_id)
    REFERENCES shared.suppliers (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT purchase_orders_warehouse_installation_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT purchase_orders_number_allocation_installation_fk
    FOREIGN KEY (installation_id, document_number_allocation_id)
    REFERENCES shared.document_number_allocations (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT purchase_orders_approval_shape_check CHECK (
    (status = 'approved' AND document_number IS NOT NULL AND approved_at IS NOT NULL AND approved_by IS NOT NULL)
    OR status <> 'approved'
  ),
  CONSTRAINT purchase_orders_cancel_shape_check CHECK (
    (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)
    OR status <> 'cancelled'
  ),
  CONSTRAINT purchase_orders_totals_check CHECK (total = subtotal - discount_total + tax_total)
);

CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_number_installation_unique
  ON purchasing.purchase_orders (installation_id, document_number)
  WHERE document_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS purchase_orders_installation_status_date_idx
  ON purchasing.purchase_orders (installation_id, status, order_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS purchase_orders_supplier_idx
  ON purchasing.purchase_orders (installation_id, supplier_id, order_date DESC);
CREATE INDEX IF NOT EXISTS purchase_orders_warehouse_idx
  ON purchasing.purchase_orders (installation_id, warehouse_id, order_date DESC);

CREATE TABLE IF NOT EXISTS purchasing.purchase_order_lines (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  purchase_order_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number BETWEEN 1 AND 10000),
  variant_id uuid NOT NULL,
  sku_snapshot text NOT NULL CHECK (char_length(btrim(sku_snapshot)) BETWEEN 1 AND 96),
  item_name_snapshot text NOT NULL CHECK (char_length(btrim(item_name_snapshot)) BETWEEN 1 AND 256),
  unit_id uuid NOT NULL,
  unit_code_snapshot text NOT NULL CHECK (char_length(btrim(unit_code_snapshot)) BETWEEN 1 AND 32),
  conversion_to_base numeric(20,6) NOT NULL CHECK (conversion_to_base > 0),
  ordered_quantity numeric(20,6) NOT NULL CHECK (ordered_quantity > 0),
  base_quantity numeric(20,6) NOT NULL CHECK (base_quantity > 0),
  unit_price numeric(20,6) NOT NULL CHECK (unit_price >= 0),
  discount_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  line_total numeric(20,6) NOT NULL CHECK (line_total >= 0),
  note text NULL CHECK (note IS NULL OR char_length(note) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT purchase_order_lines_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT purchase_order_lines_order_line_unique UNIQUE (installation_id, purchase_order_id, line_number),
  CONSTRAINT purchase_order_lines_variant_unique UNIQUE (installation_id, purchase_order_id, variant_id),
  CONSTRAINT purchase_order_lines_order_installation_fk
    FOREIGN KEY (installation_id, purchase_order_id)
    REFERENCES purchasing.purchase_orders (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT purchase_order_lines_variant_installation_fk
    FOREIGN KEY (installation_id, variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT purchase_order_lines_unit_installation_fk
    FOREIGN KEY (installation_id, unit_id)
    REFERENCES shared.units_of_measure (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT purchase_order_lines_conversion_product_check
    CHECK (base_quantity = round(ordered_quantity * conversion_to_base, 6)),
  CONSTRAINT purchase_order_lines_amounts_total_check
    CHECK (line_total = round(ordered_quantity * unit_price - discount_amount + tax_amount, 6))
);

CREATE INDEX IF NOT EXISTS purchase_order_lines_order_idx
  ON purchasing.purchase_order_lines (installation_id, purchase_order_id, line_number);
CREATE INDEX IF NOT EXISTS purchase_order_lines_variant_idx
  ON purchasing.purchase_order_lines (installation_id, variant_id);

CREATE OR REPLACE FUNCTION purchasing.guard_purchase_order_line_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_status text;
  target_installation text;
  target_order uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_installation := OLD.installation_id;
    target_order := OLD.purchase_order_id;
  ELSE
    target_installation := NEW.installation_id;
    target_order := NEW.purchase_order_id;
  END IF;

  SELECT status INTO current_status
  FROM purchasing.purchase_orders
  WHERE installation_id = target_installation AND id = target_order;

  IF current_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'purchase_order_lines_locked';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS purchase_order_lines_draft_only ON purchasing.purchase_order_lines;
CREATE TRIGGER purchase_order_lines_draft_only
BEFORE INSERT OR UPDATE OR DELETE ON purchasing.purchase_order_lines
FOR EACH ROW EXECUTE FUNCTION purchasing.guard_purchase_order_line_mutation();
