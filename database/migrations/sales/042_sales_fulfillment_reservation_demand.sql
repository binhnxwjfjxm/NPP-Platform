-- Phase 6D.1: warehouse-level reservation demand and fulfillment projection.
-- Confirmation creates demand at warehouse + inventory-base SKU scope.
-- Exact location/lot reservation remains owned by Phase 6D.2 allocation.

ALTER TABLE shared.sales_order_settings
  ADD COLUMN IF NOT EXISTS allow_backorder boolean NOT NULL DEFAULT true;
ALTER TABLE shared.sales_order_settings
  ALTER COLUMN allow_backorder SET DEFAULT true;

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES
  ('core.fulfillment.read', 'Bán hàng', 'Xem tình trạng giữ hàng', 'Cho phép xem số lượng đã giữ, còn thiếu và tiến độ thực hiện của đơn bán hàng trong phạm vi kho được cấp.', true, now()),
  ('core.fulfillment.configure-backorder', 'Bán hàng', 'Cấu hình cho phép thiếu hàng', 'Cho phép thay đổi chính sách cho xác nhận đơn khi tồn khả dụng không đủ.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

ALTER TABLE sales.sales_orders
  DROP CONSTRAINT IF EXISTS sales_orders_fulfillment_status_check;
ALTER TABLE sales.sales_orders
  ADD CONSTRAINT sales_orders_fulfillment_status_check
  CHECK (fulfillment_status IN (
    'unallocated', 'backordered', 'partially_reserved', 'reserved',
    'partially_allocated', 'allocated', 'partially_fulfilled',
    'fulfilled', 'cancelled'
  ));

CREATE TABLE IF NOT EXISTS sales.sales_order_fulfillment_demands (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  sales_order_id uuid NOT NULL,
  sales_order_version_id uuid NOT NULL,
  sales_order_line_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number BETWEEN 1 AND 10000),
  warehouse_id uuid NOT NULL,
  sales_variant_id uuid NOT NULL,
  base_variant_id uuid NOT NULL,
  sku_snapshot text NOT NULL CHECK (char_length(btrim(sku_snapshot)) BETWEEN 1 AND 96),
  ordered_base_quantity numeric(30,12) NOT NULL CHECK (ordered_base_quantity > 0),
  reserved_base_quantity numeric(30,12) NOT NULL DEFAULT 0 CHECK (reserved_base_quantity >= 0),
  backordered_base_quantity numeric(30,12) NOT NULL DEFAULT 0 CHECK (backordered_base_quantity >= 0),
  allocated_base_quantity numeric(30,12) NOT NULL DEFAULT 0 CHECK (allocated_base_quantity >= 0),
  picked_base_quantity numeric(30,12) NOT NULL DEFAULT 0 CHECK (picked_base_quantity >= 0),
  packed_base_quantity numeric(30,12) NOT NULL DEFAULT 0 CHECK (packed_base_quantity >= 0),
  issued_base_quantity numeric(30,12) NOT NULL DEFAULT 0 CHECK (issued_base_quantity >= 0),
  cancelled_base_quantity numeric(30,12) NOT NULL DEFAULT 0 CHECK (cancelled_base_quantity >= 0),
  state text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'SUPERSEDED', 'CANCELLED', 'COMPLETED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT sales_order_fulfillment_demands_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT sales_order_fulfillment_demands_version_line_unique
    UNIQUE (installation_id, sales_order_version_id, sales_order_line_id),
  CONSTRAINT sales_order_fulfillment_demands_quantity_reconcile CHECK (
    ordered_base_quantity = reserved_base_quantity + backordered_base_quantity
    AND allocated_base_quantity <= reserved_base_quantity
    AND picked_base_quantity <= allocated_base_quantity
    AND packed_base_quantity <= picked_base_quantity
    AND issued_base_quantity <= packed_base_quantity
    AND cancelled_base_quantity <= ordered_base_quantity - issued_base_quantity
  ),
  CONSTRAINT sales_order_fulfillment_demands_order_fk
    FOREIGN KEY (installation_id, sales_order_id)
    REFERENCES sales.sales_orders (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sales_order_fulfillment_demands_version_fk
    FOREIGN KEY (installation_id, sales_order_version_id)
    REFERENCES sales.sales_order_versions (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sales_order_fulfillment_demands_line_fk
    FOREIGN KEY (installation_id, sales_order_line_id)
    REFERENCES sales.sales_order_version_lines (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sales_order_fulfillment_demands_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sales_order_fulfillment_demands_sales_variant_fk
    FOREIGN KEY (installation_id, sales_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sales_order_fulfillment_demands_base_variant_fk
    FOREIGN KEY (installation_id, base_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS sales_order_fulfillment_demands_order_idx
  ON sales.sales_order_fulfillment_demands (
    installation_id, sales_order_id, state, line_number
  );
CREATE INDEX IF NOT EXISTS sales_order_fulfillment_demands_scope_idx
  ON sales.sales_order_fulfillment_demands (
    installation_id, warehouse_id, base_variant_id, state
  );
CREATE INDEX IF NOT EXISTS sales_order_fulfillment_demands_backorder_idx
  ON sales.sales_order_fulfillment_demands (
    installation_id, warehouse_id, backordered_base_quantity DESC, created_at ASC
  ) WHERE state = 'ACTIVE' AND backordered_base_quantity > 0;

CREATE OR REPLACE FUNCTION sales.guard_sales_order_fulfillment_demand_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.sales_fulfillment_write_context', true);
BEGIN
  IF write_context IS DISTINCT FROM 'fulfillment_service' THEN
    RAISE EXCEPTION 'sales_fulfillment_demand_write_requires_service_context';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'sales_fulfillment_demands_cannot_be_deleted';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'ACTIVE' THEN
      RAISE EXCEPTION 'sales_fulfillment_demand_must_start_active';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.installation_id IS DISTINCT FROM OLD.installation_id
     OR NEW.sales_order_id IS DISTINCT FROM OLD.sales_order_id
     OR NEW.sales_order_version_id IS DISTINCT FROM OLD.sales_order_version_id
     OR NEW.sales_order_line_id IS DISTINCT FROM OLD.sales_order_line_id
     OR NEW.line_number IS DISTINCT FROM OLD.line_number
     OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
     OR NEW.sales_variant_id IS DISTINCT FROM OLD.sales_variant_id
     OR NEW.base_variant_id IS DISTINCT FROM OLD.base_variant_id
     OR NEW.sku_snapshot IS DISTINCT FROM OLD.sku_snapshot
     OR NEW.ordered_base_quantity IS DISTINCT FROM OLD.ordered_base_quantity
     OR NEW.reserved_base_quantity IS DISTINCT FROM OLD.reserved_base_quantity
     OR NEW.backordered_base_quantity IS DISTINCT FROM OLD.backordered_base_quantity
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'sales_fulfillment_demand_immutable_fields_cannot_change';
  END IF;

  IF OLD.state <> 'ACTIVE' THEN
    RAISE EXCEPTION 'sales_fulfillment_demand_terminal_state_is_immutable';
  END IF;

  IF NEW.allocated_base_quantity < OLD.allocated_base_quantity
     OR NEW.picked_base_quantity < OLD.picked_base_quantity
     OR NEW.packed_base_quantity < OLD.packed_base_quantity
     OR NEW.issued_base_quantity < OLD.issued_base_quantity
     OR NEW.cancelled_base_quantity < OLD.cancelled_base_quantity THEN
    RAISE EXCEPTION 'sales_fulfillment_progress_cannot_decrease';
  END IF;

  IF NEW.state NOT IN ('ACTIVE', 'SUPERSEDED', 'CANCELLED', 'COMPLETED') THEN
    RAISE EXCEPTION 'sales_fulfillment_demand_invalid_state_transition';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_order_fulfillment_demands_writer_guard
  ON sales.sales_order_fulfillment_demands;
CREATE TRIGGER sales_order_fulfillment_demands_writer_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales.sales_order_fulfillment_demands
FOR EACH ROW EXECUTE FUNCTION sales.guard_sales_order_fulfillment_demand_write();

-- Exact reservations and Sales reservation demand share one warehouse/SKU lock.
-- The trigger is a database backstop in addition to the service-level preflight.
CREATE OR REPLACE FUNCTION inventory.guard_inventory_reservation_against_sales_demand()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  warehouse_on_hand numeric(30,12);
  warehouse_reserved numeric(30,12);
  fulfillment_reserved numeric(30,12);
BEGIN
  IF NEW.state <> 'ACTIVE' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', 'sales-fulfillment-scope', NEW.installation_id, NEW.warehouse_id, NEW.base_variant_id),
    0
  ));

  SELECT COALESCE(sum(balance.on_hand_quantity), 0),
         COALESCE(sum(balance.reserved_quantity), 0)
    INTO warehouse_on_hand, warehouse_reserved
    FROM inventory.inventory_balances balance
   WHERE balance.installation_id = NEW.installation_id
     AND balance.warehouse_id = NEW.warehouse_id
     AND balance.base_variant_id = NEW.base_variant_id;

  SELECT COALESCE(sum(
           demand.reserved_base_quantity - demand.allocated_base_quantity
         ), 0)
    INTO fulfillment_reserved
    FROM sales.sales_order_fulfillment_demands demand
   WHERE demand.installation_id = NEW.installation_id
     AND demand.warehouse_id = NEW.warehouse_id
     AND demand.base_variant_id = NEW.base_variant_id
     AND demand.state = 'ACTIVE';

  IF NEW.quantity > greatest(
       warehouse_on_hand - warehouse_reserved - fulfillment_reserved,
       0
     ) THEN
    RAISE EXCEPTION 'inventory_sales_fulfillment_reservation_denied';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_reservations_sales_demand_guard
  ON inventory.inventory_reservations;
CREATE TRIGGER inventory_reservations_sales_demand_guard
BEFORE INSERT ON inventory.inventory_reservations
FOR EACH ROW EXECUTE FUNCTION inventory.guard_inventory_reservation_against_sales_demand();

-- Preserve exact-scope protection and add the warehouse-level demand backstop.
CREATE OR REPLACE FUNCTION inventory.guard_inventory_negative_stock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  exact_on_hand numeric(30,12);
  exact_reserved numeric(30,12);
  warehouse_on_hand numeric(30,12);
  warehouse_reserved numeric(30,12);
  fulfillment_reserved numeric(30,12);
BEGIN
  IF NEW.base_quantity_delta >= 0 THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', 'sales-fulfillment-scope', NEW.installation_id, NEW.warehouse_id, NEW.base_variant_id),
    0
  ));

  SELECT balance.on_hand_quantity, balance.reserved_quantity
    INTO exact_on_hand, exact_reserved
    FROM inventory.inventory_balances balance
   WHERE balance.installation_id = NEW.installation_id
     AND balance.warehouse_id = NEW.warehouse_id
     AND balance.location_id IS NOT DISTINCT FROM NEW.location_id
     AND balance.base_variant_id = NEW.base_variant_id
     AND balance.lot_id IS NOT DISTINCT FROM NEW.lot_id
   FOR UPDATE;

  IF NOT FOUND OR exact_on_hand + NEW.base_quantity_delta < exact_reserved THEN
    RAISE EXCEPTION 'inventory_negative_stock_denied';
  END IF;

  SELECT COALESCE(sum(balance.on_hand_quantity), 0),
         COALESCE(sum(balance.reserved_quantity), 0)
    INTO warehouse_on_hand, warehouse_reserved
    FROM inventory.inventory_balances balance
   WHERE balance.installation_id = NEW.installation_id
     AND balance.warehouse_id = NEW.warehouse_id
     AND balance.base_variant_id = NEW.base_variant_id;

  SELECT COALESCE(sum(
           demand.reserved_base_quantity - demand.allocated_base_quantity
         ), 0)
    INTO fulfillment_reserved
    FROM sales.sales_order_fulfillment_demands demand
   WHERE demand.installation_id = NEW.installation_id
     AND demand.warehouse_id = NEW.warehouse_id
     AND demand.base_variant_id = NEW.base_variant_id
     AND demand.state = 'ACTIVE';

  IF warehouse_on_hand + NEW.base_quantity_delta
       < warehouse_reserved + fulfillment_reserved THEN
    RAISE EXCEPTION 'inventory_sales_fulfillment_reservation_denied';
  END IF;

  RETURN NEW;
END;
$$;
