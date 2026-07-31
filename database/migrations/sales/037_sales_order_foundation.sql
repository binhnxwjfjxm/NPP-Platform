-- Phase 6B: Sales Order foundation.
-- Commercial versions are immutable after confirmation. This migration does not
-- reserve/issue inventory, create Delivery Orders, or post receivables/payments.

CREATE SCHEMA IF NOT EXISTS sales;

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES
  ('core.sales-order.read', 'Bán hàng', 'Xem đơn bán hàng', 'Cho phép đọc danh sách, chi tiết và lịch sử phiên bản đơn bán hàng trong phạm vi kho được cấp.', true, now()),
  ('core.sales-order.create', 'Bán hàng', 'Tạo đơn bán hàng', 'Cho phép tạo đơn bán hàng ở trạng thái nháp.', true, now()),
  ('core.sales-order.update-draft', 'Bán hàng', 'Sửa đơn bán hàng nháp', 'Cho phép cập nhật phiên bản nháp của đơn bán hàng.', true, now()),
  ('core.sales-order.confirm', 'Bán hàng', 'Xác nhận đơn bán hàng', 'Cho phép xác nhận đơn bán hàng và cấp số chứng từ.', true, now()),
  ('core.sales-order.amend', 'Bán hàng', 'Điều chỉnh đơn bán hàng', 'Cho phép tạo và xác nhận phiên bản điều chỉnh bất biến.', true, now()),
  ('core.sales-order.cancel', 'Bán hàng', 'Hủy đơn bán hàng', 'Cho phép hủy đơn bán hàng theo chính sách trạng thái.', true, now()),
  ('core.sales-order.price.override', 'Bán hàng', 'Ghi đè giá bán', 'Cho phép ghi đè giá bán do hệ thống phân giải khi có lý do.', true, now()),
  ('core.sales-order.credit.override', 'Bán hàng', 'Duyệt ngoại lệ bán chịu', 'Cho phép duyệt ngoại lệ chính sách tín dụng có lý do và audit.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS sales.sales_orders (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  order_number text NULL CHECK (order_number IS NULL OR char_length(btrim(order_number)) BETWEEN 1 AND 160),
  order_number_allocation_id uuid NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'cancelled', 'closed')),
  current_version_number bigint NOT NULL DEFAULT 1 CHECK (current_version_number >= 1),
  source_type text NOT NULL DEFAULT 'MANUAL' CHECK (source_type IN ('MANUAL', 'IMPORT', 'API', 'MCP')),
  source_id text NULL CHECK (source_id IS NULL OR char_length(btrim(source_id)) BETWEEN 1 AND 256),
  source_outlet_id text NULL CHECK (source_outlet_id IS NULL OR char_length(btrim(source_outlet_id)) BETWEEN 1 AND 256),
  customer_id uuid NOT NULL,
  customer_address_id uuid NULL,
  warehouse_id uuid NOT NULL,
  delivery_mode text NOT NULL DEFAULT 'DELIVERY' CHECK (delivery_mode IN ('DELIVERY', 'PICKUP')),
  collection_policy text NOT NULL DEFAULT 'COLLECT_ON_DELIVERY' CHECK (collection_policy IN (
    'PREPAID', 'COLLECT_ON_DELIVERY', 'COLLECT_AFTER_DELIVERY', 'CREDIT_TERMS'
  )),
  fulfillment_status text NOT NULL DEFAULT 'unallocated' CHECK (fulfillment_status IN (
    'unallocated', 'partially_allocated', 'allocated', 'partially_fulfilled', 'fulfilled', 'cancelled'
  )),
  delivery_status text NOT NULL DEFAULT 'pending' CHECK (delivery_status IN (
    'not_required', 'pending', 'ready_to_dispatch', 'dispatched', 'partially_delivered',
    'delivered', 'failed', 'rescheduled', 'returned', 'cancelled'
  )),
  settlement_status text NOT NULL DEFAULT 'not_due' CHECK (settlement_status IN (
    'not_due', 'pending', 'partially_paid', 'paid', 'overpaid', 'refunded', 'written_off'
  )),
  currency_code text NOT NULL DEFAULT 'VND' CHECK (char_length(currency_code) = 3 AND currency_code = upper(currency_code)),
  requested_delivery_date date NULL,
  note text NULL CHECK (note IS NULL OR char_length(note) <= 4000),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  confirmed_at timestamptz NULL,
  confirmed_by text NULL CHECK (confirmed_by IS NULL OR char_length(confirmed_by) BETWEEN 1 AND 128),
  cancelled_at timestamptz NULL,
  cancelled_by text NULL CHECK (cancelled_by IS NULL OR char_length(cancelled_by) BETWEEN 1 AND 128),
  cancellation_reason text NULL CHECK (cancellation_reason IS NULL OR char_length(btrim(cancellation_reason)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT sales_orders_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT sales_orders_customer_installation_fk
    FOREIGN KEY (installation_id, customer_id)
    REFERENCES shared.customers (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sales_orders_address_installation_fk
    FOREIGN KEY (installation_id, customer_address_id)
    REFERENCES shared.customer_addresses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sales_orders_warehouse_installation_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sales_orders_number_allocation_installation_fk
    FOREIGN KEY (installation_id, order_number_allocation_id)
    REFERENCES shared.document_number_allocations (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sales_orders_source_shape_check CHECK (
    (source_type = 'MANUAL' AND source_id IS NULL AND source_outlet_id IS NULL)
    OR (source_type IN ('IMPORT', 'API') AND source_id IS NOT NULL AND source_outlet_id IS NULL)
    OR (source_type = 'MCP' AND source_id IS NOT NULL AND source_outlet_id IS NOT NULL)
  ),
  CONSTRAINT sales_orders_delivery_shape_check CHECK (
    (delivery_mode = 'DELIVERY' AND customer_address_id IS NOT NULL AND delivery_status <> 'not_required')
    OR (delivery_mode = 'PICKUP' AND delivery_status IN ('not_required', 'cancelled'))
  ),
  CONSTRAINT sales_orders_confirmed_shape_check CHECK (
    status NOT IN ('confirmed', 'closed')
    OR (order_number IS NOT NULL AND order_number_allocation_id IS NOT NULL AND confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL)
  ),
  CONSTRAINT sales_orders_cancelled_shape_check CHECK (
    status <> 'cancelled'
    OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancellation_reason IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_orders_number_installation_unique
  ON sales.sales_orders (installation_id, order_number)
  WHERE order_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sales_orders_source_installation_unique
  ON sales.sales_orders (installation_id, source_type, source_id)
  WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_orders_installation_status_date_idx
  ON sales.sales_orders (installation_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS sales_orders_customer_idx
  ON sales.sales_orders (installation_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sales_orders_warehouse_idx
  ON sales.sales_orders (installation_id, warehouse_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sales.sales_order_versions (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  sales_order_id uuid NOT NULL,
  version_number bigint NOT NULL CHECK (version_number >= 1),
  version_status text NOT NULL DEFAULT 'draft' CHECK (version_status IN ('draft', 'confirmed', 'superseded', 'cancelled')),
  customer_id uuid NOT NULL,
  customer_code_snapshot text NOT NULL CHECK (char_length(btrim(customer_code_snapshot)) BETWEEN 1 AND 64),
  customer_name_snapshot text NOT NULL CHECK (char_length(btrim(customer_name_snapshot)) BETWEEN 1 AND 256),
  customer_address_id uuid NULL,
  customer_address_snapshot jsonb NULL,
  warehouse_id uuid NOT NULL,
  warehouse_code_snapshot text NOT NULL CHECK (char_length(btrim(warehouse_code_snapshot)) BETWEEN 1 AND 64),
  warehouse_name_snapshot text NOT NULL CHECK (char_length(btrim(warehouse_name_snapshot)) BETWEEN 1 AND 256),
  delivery_mode text NOT NULL CHECK (delivery_mode IN ('DELIVERY', 'PICKUP')),
  source_type text NOT NULL CHECK (source_type IN ('MANUAL', 'IMPORT', 'API', 'MCP')),
  source_id text NULL,
  source_outlet_id text NULL,
  collection_policy text NOT NULL CHECK (collection_policy IN (
    'PREPAID', 'COLLECT_ON_DELIVERY', 'COLLECT_AFTER_DELIVERY', 'CREDIT_TERMS'
  )),
  currency_code text NOT NULL DEFAULT 'VND' CHECK (char_length(currency_code) = 3 AND currency_code = upper(currency_code)),
  requested_delivery_date date NULL,
  note text NULL CHECK (note IS NULL OR char_length(note) <= 4000),
  subtotal numeric(20,6) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_total numeric(20,6) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  tax_total numeric(20,6) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total numeric(20,6) NOT NULL DEFAULT 0 CHECK (total >= 0),
  amendment_reason text NULL CHECK (amendment_reason IS NULL OR char_length(btrim(amendment_reason)) BETWEEN 1 AND 1000),
  based_on_version_number bigint NULL CHECK (based_on_version_number IS NULL OR based_on_version_number >= 1),
  price_override_reason text NULL CHECK (price_override_reason IS NULL OR char_length(btrim(price_override_reason)) BETWEEN 1 AND 1000),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  confirmed_at timestamptz NULL,
  confirmed_by text NULL CHECK (confirmed_by IS NULL OR char_length(confirmed_by) BETWEEN 1 AND 128),
  CONSTRAINT sales_order_versions_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT sales_order_versions_order_version_unique UNIQUE (installation_id, sales_order_id, version_number),
  CONSTRAINT sales_order_versions_order_installation_fk
    FOREIGN KEY (installation_id, sales_order_id)
    REFERENCES sales.sales_orders (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sales_order_versions_customer_installation_fk
    FOREIGN KEY (installation_id, customer_id)
    REFERENCES shared.customers (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sales_order_versions_address_installation_fk
    FOREIGN KEY (installation_id, customer_address_id)
    REFERENCES shared.customer_addresses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sales_order_versions_warehouse_installation_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sales_order_versions_amount_reconciliation_check CHECK (total = subtotal - discount_total + tax_total),
  CONSTRAINT sales_order_versions_amendment_shape_check CHECK (
    (version_number = 1 AND amendment_reason IS NULL AND based_on_version_number IS NULL)
    OR (version_number > 1 AND amendment_reason IS NOT NULL AND based_on_version_number IS NOT NULL AND based_on_version_number < version_number)
  ),
  CONSTRAINT sales_order_versions_confirmed_shape_check CHECK (
    version_status NOT IN ('confirmed', 'superseded')
    OR (confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_order_versions_one_draft_idx
  ON sales.sales_order_versions (installation_id, sales_order_id)
  WHERE version_status = 'draft';
CREATE INDEX IF NOT EXISTS sales_order_versions_order_idx
  ON sales.sales_order_versions (installation_id, sales_order_id, version_number DESC);

CREATE TABLE IF NOT EXISTS sales.sales_order_version_lines (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  sales_order_version_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number BETWEEN 1 AND 10000),
  variant_id uuid NOT NULL,
  sku_snapshot text NOT NULL CHECK (char_length(btrim(sku_snapshot)) BETWEEN 1 AND 96),
  item_name_snapshot text NOT NULL CHECK (char_length(btrim(item_name_snapshot)) BETWEEN 1 AND 256),
  unit_id uuid NOT NULL,
  unit_code_snapshot text NOT NULL CHECK (char_length(btrim(unit_code_snapshot)) BETWEEN 1 AND 32),
  conversion_to_base numeric(20,6) NOT NULL CHECK (conversion_to_base > 0),
  ordered_quantity numeric(20,6) NOT NULL CHECK (ordered_quantity > 0),
  base_quantity numeric(20,6) NOT NULL CHECK (base_quantity > 0),
  price_list_id uuid NULL,
  price_rule_id uuid NULL,
  price_source text NOT NULL CHECK (price_source IN ('PRICE_ENGINE', 'MANUAL_OVERRIDE')),
  unit_price numeric(20,6) NOT NULL CHECK (unit_price >= 0),
  discount_mode text NOT NULL DEFAULT 'TOTAL_AMOUNT' CHECK (discount_mode IN ('TOTAL_AMOUNT', 'PER_UNIT', 'PERCENT')),
  discount_value numeric(20,6) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  discount_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_mode text NOT NULL DEFAULT 'EXCLUSIVE' CHECK (tax_mode IN ('EXCLUSIVE', 'INCLUSIVE')),
  tax_rate numeric(9,6) NOT NULL DEFAULT 0 CHECK (tax_rate BETWEEN 0 AND 100),
  tax_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  line_subtotal numeric(20,6) NOT NULL CHECK (line_subtotal >= 0),
  line_total numeric(20,6) NOT NULL CHECK (line_total >= 0),
  note text NULL CHECK (note IS NULL OR char_length(note) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT sales_order_version_lines_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT sales_order_version_lines_number_unique UNIQUE (installation_id, sales_order_version_id, line_number),
  CONSTRAINT sales_order_version_lines_variant_unique UNIQUE (installation_id, sales_order_version_id, variant_id),
  CONSTRAINT sales_order_version_lines_version_installation_fk
    FOREIGN KEY (installation_id, sales_order_version_id)
    REFERENCES sales.sales_order_versions (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sales_order_version_lines_variant_installation_fk
    FOREIGN KEY (installation_id, variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sales_order_version_lines_unit_installation_fk
    FOREIGN KEY (installation_id, unit_id)
    REFERENCES shared.units_of_measure (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sales_order_version_lines_conversion_reconciliation_check
    CHECK (base_quantity = round(ordered_quantity * conversion_to_base, 6)),
  CONSTRAINT sales_order_version_lines_amount_reconciliation_check
    CHECK (line_total = line_subtotal - discount_amount + tax_amount)
);

CREATE INDEX IF NOT EXISTS sales_order_version_lines_version_idx
  ON sales.sales_order_version_lines (installation_id, sales_order_version_id, line_number);
CREATE INDEX IF NOT EXISTS sales_order_version_lines_variant_idx
  ON sales.sales_order_version_lines (installation_id, variant_id);

CREATE OR REPLACE FUNCTION sales.guard_sales_order_identity_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.installation_id IS DISTINCT FROM NEW.installation_id
     OR OLD.id IS DISTINCT FROM NEW.id
     OR OLD.source_type IS DISTINCT FROM NEW.source_type
     OR OLD.source_id IS DISTINCT FROM NEW.source_id
     OR OLD.source_outlet_id IS DISTINCT FROM NEW.source_outlet_id
     OR (OLD.order_number IS NOT NULL AND OLD.order_number IS DISTINCT FROM NEW.order_number)
     OR (OLD.order_number_allocation_id IS NOT NULL AND OLD.order_number_allocation_id IS DISTINCT FROM NEW.order_number_allocation_id) THEN
    RAISE EXCEPTION 'sales_order_identity_locked';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_orders_identity_locked ON sales.sales_orders;
CREATE TRIGGER sales_orders_identity_locked
BEFORE UPDATE ON sales.sales_orders
FOR EACH ROW EXECUTE FUNCTION sales.guard_sales_order_identity_mutation();

CREATE OR REPLACE FUNCTION sales.guard_sales_order_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.version_status <> 'draft' THEN
    RAISE EXCEPTION 'sales_order_version_locked';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.version_status <> 'draft' THEN
    IF NOT (
      OLD.version_status = 'confirmed'
      AND NEW.version_status = 'superseded'
      AND NEW.id = OLD.id
      AND NEW.installation_id = OLD.installation_id
      AND NEW.sales_order_id = OLD.sales_order_id
      AND NEW.version_number = OLD.version_number
      AND NEW.customer_id = OLD.customer_id
      AND NEW.customer_code_snapshot = OLD.customer_code_snapshot
      AND NEW.customer_name_snapshot = OLD.customer_name_snapshot
      AND NEW.customer_address_id IS NOT DISTINCT FROM OLD.customer_address_id
      AND NEW.customer_address_snapshot IS NOT DISTINCT FROM OLD.customer_address_snapshot
      AND NEW.warehouse_id = OLD.warehouse_id
      AND NEW.warehouse_code_snapshot = OLD.warehouse_code_snapshot
      AND NEW.warehouse_name_snapshot = OLD.warehouse_name_snapshot
      AND NEW.delivery_mode = OLD.delivery_mode
      AND NEW.source_type = OLD.source_type
      AND NEW.source_id IS NOT DISTINCT FROM OLD.source_id
      AND NEW.source_outlet_id IS NOT DISTINCT FROM OLD.source_outlet_id
      AND NEW.collection_policy = OLD.collection_policy
      AND NEW.currency_code = OLD.currency_code
      AND NEW.requested_delivery_date IS NOT DISTINCT FROM OLD.requested_delivery_date
      AND NEW.note IS NOT DISTINCT FROM OLD.note
      AND NEW.subtotal = OLD.subtotal
      AND NEW.discount_total = OLD.discount_total
      AND NEW.tax_total = OLD.tax_total
      AND NEW.total = OLD.total
      AND NEW.amendment_reason IS NOT DISTINCT FROM OLD.amendment_reason
      AND NEW.based_on_version_number IS NOT DISTINCT FROM OLD.based_on_version_number
      AND NEW.price_override_reason IS NOT DISTINCT FROM OLD.price_override_reason
      AND NEW.created_at = OLD.created_at
      AND NEW.created_by = OLD.created_by
      AND NEW.confirmed_at = OLD.confirmed_at
      AND NEW.confirmed_by = OLD.confirmed_by
    ) THEN
      RAISE EXCEPTION 'sales_order_version_locked';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_order_versions_immutable ON sales.sales_order_versions;
CREATE TRIGGER sales_order_versions_immutable
BEFORE UPDATE OR DELETE ON sales.sales_order_versions
FOR EACH ROW EXECUTE FUNCTION sales.guard_sales_order_version_mutation();

CREATE OR REPLACE FUNCTION sales.guard_sales_order_line_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_status text;
DECLARE target_installation text;
DECLARE target_version uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_installation := OLD.installation_id;
    target_version := OLD.sales_order_version_id;
  ELSE
    target_installation := NEW.installation_id;
    target_version := NEW.sales_order_version_id;
  END IF;
  SELECT version_status INTO current_status
  FROM sales.sales_order_versions
  WHERE installation_id = target_installation AND id = target_version;
  IF current_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'sales_order_version_lines_locked';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_order_version_lines_draft_only ON sales.sales_order_version_lines;
CREATE TRIGGER sales_order_version_lines_draft_only
BEFORE INSERT OR UPDATE OR DELETE ON sales.sales_order_version_lines
FOR EACH ROW EXECUTE FUNCTION sales.guard_sales_order_line_mutation();
