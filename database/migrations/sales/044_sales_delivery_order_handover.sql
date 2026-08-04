-- Phase 6D.3: packed allocation -> Delivery Order -> ready-to-dispatch boundary.
-- This migration does not post Inventory OUT, create trips/attempts/POD, or post accounting facts.

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES
  ('core.delivery-order.read', 'Giao nhận', 'Xem chứng từ giao nhận', 'Cho phép đọc phần hàng đã đóng gói và Delivery Order trong phạm vi kho được cấp.', true, now()),
  ('core.delivery-order.create', 'Giao nhận', 'Tạo chứng từ giao nhận', 'Cho phép tạo Delivery Order từ phần hàng đã đóng gói trong phạm vi kho được cấp.', true, now()),
  ('core.delivery-order.confirm', 'Giao nhận', 'Xác nhận sẵn sàng bàn giao', 'Cho phép xác nhận Delivery Order sẵn sàng chuyển sang vận hành giao nhận.', true, now()),
  ('core.delivery-order.cancel', 'Giao nhận', 'Hủy chứng từ giao nhận nháp', 'Cho phép hủy Delivery Order nháp với lý do bắt buộc và trả phần packed về hàng đợi.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS sales.delivery_orders (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  delivery_order_number text NULL
    CHECK (delivery_order_number IS NULL OR char_length(btrim(delivery_order_number)) BETWEEN 1 AND 160),
  delivery_order_number_allocation_id uuid NULL,
  sales_order_id uuid NOT NULL,
  sales_order_version_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  customer_address_id uuid NULL,
  warehouse_id uuid NOT NULL,
  handover_mode text NOT NULL CHECK (handover_mode IN ('DELIVERY', 'PICKUP')),
  customer_code_snapshot text NOT NULL CHECK (char_length(btrim(customer_code_snapshot)) BETWEEN 1 AND 64),
  customer_name_snapshot text NOT NULL CHECK (char_length(btrim(customer_name_snapshot)) BETWEEN 1 AND 256),
  destination_snapshot jsonb NOT NULL CHECK (jsonb_typeof(destination_snapshot) = 'object'),
  warehouse_code_snapshot text NOT NULL CHECK (char_length(btrim(warehouse_code_snapshot)) BETWEEN 1 AND 64),
  warehouse_name_snapshot text NOT NULL CHECK (char_length(btrim(warehouse_name_snapshot)) BETWEEN 1 AND 256),
  requested_delivery_date date NULL,
  collection_policy text NOT NULL CHECK (collection_policy IN (
    'PREPAID', 'COLLECT_ON_DELIVERY', 'COLLECT_AFTER_DELIVERY', 'CREDIT_TERMS'
  )),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready_to_dispatch', 'cancelled')),
  note text NULL CHECK (note IS NULL OR char_length(note) <= 4000),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  create_idempotency_key text NOT NULL CHECK (char_length(create_idempotency_key) BETWEEN 1 AND 128),
  create_payload_hash text NOT NULL CHECK (create_payload_hash ~ '^[0-9a-f]{64}$'),
  confirmed_at timestamptz NULL,
  confirmed_by text NULL CHECK (confirmed_by IS NULL OR char_length(confirmed_by) BETWEEN 1 AND 128),
  cancelled_at timestamptz NULL,
  cancelled_by text NULL CHECK (cancelled_by IS NULL OR char_length(cancelled_by) BETWEEN 1 AND 128),
  cancellation_reason text NULL CHECK (
    cancellation_reason IS NULL OR char_length(btrim(cancellation_reason)) BETWEEN 1 AND 1000
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT delivery_orders_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT delivery_orders_create_idempotency_unique UNIQUE (installation_id, create_idempotency_key),
  CONSTRAINT delivery_orders_order_fk
    FOREIGN KEY (installation_id, sales_order_id)
    REFERENCES sales.sales_orders (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_orders_version_fk
    FOREIGN KEY (installation_id, sales_order_version_id)
    REFERENCES sales.sales_order_versions (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_orders_customer_fk
    FOREIGN KEY (installation_id, customer_id)
    REFERENCES shared.customers (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_orders_address_fk
    FOREIGN KEY (installation_id, customer_address_id)
    REFERENCES shared.customer_addresses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_orders_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_orders_number_allocation_fk
    FOREIGN KEY (installation_id, delivery_order_number_allocation_id)
    REFERENCES shared.document_number_allocations (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_orders_mode_shape CHECK (
    (handover_mode = 'DELIVERY' AND customer_address_id IS NOT NULL)
    OR (handover_mode = 'PICKUP' AND customer_address_id IS NULL)
  ),
  CONSTRAINT delivery_orders_ready_shape CHECK (
    status <> 'ready_to_dispatch'
    OR (
      delivery_order_number IS NOT NULL
      AND delivery_order_number_allocation_id IS NOT NULL
      AND confirmed_at IS NOT NULL
      AND confirmed_by IS NOT NULL
    )
  ),
  CONSTRAINT delivery_orders_cancel_shape CHECK (
    status <> 'cancelled'
    OR (
      cancelled_at IS NOT NULL
      AND cancelled_by IS NOT NULL
      AND cancellation_reason IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS delivery_orders_number_unique
  ON sales.delivery_orders (installation_id, delivery_order_number)
  WHERE delivery_order_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS delivery_orders_queue_idx
  ON sales.delivery_orders (installation_id, warehouse_id, status, created_at, id);
CREATE INDEX IF NOT EXISTS delivery_orders_sales_order_idx
  ON sales.delivery_orders (installation_id, sales_order_id, created_at, id);

CREATE TABLE IF NOT EXISTS sales.delivery_order_lines (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  delivery_order_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number BETWEEN 1 AND 10000),
  sales_order_id uuid NOT NULL,
  sales_order_version_id uuid NOT NULL,
  sales_order_line_id uuid NOT NULL,
  fulfillment_demand_id uuid NOT NULL,
  fulfillment_allocation_id uuid NOT NULL,
  inventory_reservation_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  location_id uuid NULL,
  base_variant_id uuid NOT NULL,
  lot_id uuid NULL,
  sku_snapshot text NOT NULL CHECK (char_length(btrim(sku_snapshot)) BETWEEN 1 AND 96),
  item_name_snapshot text NOT NULL CHECK (char_length(btrim(item_name_snapshot)) BETWEEN 1 AND 256),
  unit_code_snapshot text NOT NULL CHECK (char_length(btrim(unit_code_snapshot)) BETWEEN 1 AND 32),
  packed_base_quantity_snapshot numeric(30,12) NOT NULL CHECK (packed_base_quantity_snapshot > 0),
  delivery_base_quantity numeric(30,12) NOT NULL CHECK (delivery_base_quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT delivery_order_lines_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT delivery_order_lines_number_unique UNIQUE (installation_id, delivery_order_id, line_number),
  CONSTRAINT delivery_order_lines_header_fk
    FOREIGN KEY (installation_id, delivery_order_id)
    REFERENCES sales.delivery_orders (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_order_lines_order_fk
    FOREIGN KEY (installation_id, sales_order_id)
    REFERENCES sales.sales_orders (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_order_lines_version_fk
    FOREIGN KEY (installation_id, sales_order_version_id)
    REFERENCES sales.sales_order_versions (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_order_lines_sales_line_fk
    FOREIGN KEY (installation_id, sales_order_line_id)
    REFERENCES sales.sales_order_version_lines (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_order_lines_demand_fk
    FOREIGN KEY (installation_id, fulfillment_demand_id)
    REFERENCES sales.sales_order_fulfillment_demands (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_order_lines_allocation_fk
    FOREIGN KEY (installation_id, fulfillment_allocation_id)
    REFERENCES sales.sales_order_fulfillment_allocations (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_order_lines_reservation_fk
    FOREIGN KEY (installation_id, inventory_reservation_id)
    REFERENCES inventory.inventory_reservations (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_order_lines_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_order_lines_location_fk
    FOREIGN KEY (installation_id, warehouse_id, location_id)
    REFERENCES shared.warehouse_locations (installation_id, warehouse_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_order_lines_variant_fk
    FOREIGN KEY (installation_id, base_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_order_lines_lot_fk
    FOREIGN KEY (installation_id, lot_id)
    REFERENCES inventory.inventory_lots (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_order_lines_quantity_snapshot_check
    CHECK (delivery_base_quantity <= packed_base_quantity_snapshot)
);

CREATE INDEX IF NOT EXISTS delivery_order_lines_allocation_idx
  ON sales.delivery_order_lines (installation_id, fulfillment_allocation_id, delivery_order_id);
CREATE INDEX IF NOT EXISTS delivery_order_lines_order_idx
  ON sales.delivery_order_lines (installation_id, sales_order_id, delivery_order_id, line_number);

CREATE TABLE IF NOT EXISTS sales.delivery_order_events (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  delivery_order_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('CREATED', 'CONFIRMED', 'CANCELLED')),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  reason text NULL CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 1000),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_order_events_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT delivery_order_events_idempotency_unique UNIQUE (installation_id, idempotency_key),
  CONSTRAINT delivery_order_events_header_fk
    FOREIGN KEY (installation_id, delivery_order_id)
    REFERENCES sales.delivery_orders (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS delivery_order_events_header_idx
  ON sales.delivery_order_events (installation_id, delivery_order_id, occurred_at, id);

CREATE OR REPLACE FUNCTION sales.guard_delivery_order_header_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.delivery_order_write_context', true);
BEGIN
  IF write_context IS DISTINCT FROM 'delivery_order_service' THEN
    RAISE EXCEPTION 'delivery_order_write_requires_service_context';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'delivery_order_delete_forbidden';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.installation_id IS DISTINCT FROM OLD.installation_id
       OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.sales_order_id IS DISTINCT FROM OLD.sales_order_id
       OR NEW.sales_order_version_id IS DISTINCT FROM OLD.sales_order_version_id
       OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.customer_address_id IS DISTINCT FROM OLD.customer_address_id
       OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
       OR NEW.handover_mode IS DISTINCT FROM OLD.handover_mode
       OR NEW.customer_code_snapshot IS DISTINCT FROM OLD.customer_code_snapshot
       OR NEW.customer_name_snapshot IS DISTINCT FROM OLD.customer_name_snapshot
       OR NEW.destination_snapshot IS DISTINCT FROM OLD.destination_snapshot
       OR NEW.warehouse_code_snapshot IS DISTINCT FROM OLD.warehouse_code_snapshot
       OR NEW.warehouse_name_snapshot IS DISTINCT FROM OLD.warehouse_name_snapshot
       OR NEW.requested_delivery_date IS DISTINCT FROM OLD.requested_delivery_date
       OR NEW.collection_policy IS DISTINCT FROM OLD.collection_policy
       OR NEW.note IS DISTINCT FROM OLD.note
       OR NEW.create_idempotency_key IS DISTINCT FROM OLD.create_idempotency_key
       OR NEW.create_payload_hash IS DISTINCT FROM OLD.create_payload_hash
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'delivery_order_immutable_header_changed';
    END IF;

    IF OLD.status = 'draft' AND NEW.status = 'ready_to_dispatch' THEN
      NULL;
    ELSIF OLD.status = 'draft' AND NEW.status = 'cancelled' THEN
      NULL;
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'delivery_order_invalid_status_transition';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_orders_write_guard ON sales.delivery_orders;
CREATE TRIGGER delivery_orders_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales.delivery_orders
FOR EACH ROW EXECUTE FUNCTION sales.guard_delivery_order_header_write();

CREATE OR REPLACE FUNCTION sales.guard_delivery_order_line_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.delivery_order_write_context', true);
  header_record sales.delivery_orders;
  allocation_record sales.sales_order_fulfillment_allocations;
  demand_record sales.sales_order_fulfillment_demands;
  claimed_quantity numeric(30,12);
BEGIN
  IF write_context IS DISTINCT FROM 'delivery_order_service' THEN
    RAISE EXCEPTION 'delivery_order_line_write_requires_service_context';
  END IF;

  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'delivery_order_lines_are_immutable';
  END IF;

  SELECT * INTO header_record
    FROM sales.delivery_orders
   WHERE installation_id = NEW.installation_id
     AND id = NEW.delivery_order_id
   FOR UPDATE;

  IF NOT FOUND OR header_record.status <> 'draft' THEN
    RAISE EXCEPTION 'delivery_order_draft_required';
  END IF;

  SELECT * INTO allocation_record
    FROM sales.sales_order_fulfillment_allocations
   WHERE installation_id = NEW.installation_id
     AND id = NEW.fulfillment_allocation_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'delivery_order_allocation_not_found';
  END IF;

  SELECT * INTO demand_record
    FROM sales.sales_order_fulfillment_demands
   WHERE installation_id = allocation_record.installation_id
     AND id = allocation_record.fulfillment_demand_id
     AND state = 'ACTIVE';

  IF NOT FOUND
     OR allocation_record.packed_base_quantity <= 0
     OR NEW.sales_order_id IS DISTINCT FROM header_record.sales_order_id
     OR NEW.sales_order_version_id IS DISTINCT FROM header_record.sales_order_version_id
     OR NEW.warehouse_id IS DISTINCT FROM header_record.warehouse_id
     OR NEW.sales_order_id IS DISTINCT FROM allocation_record.sales_order_id
     OR NEW.sales_order_version_id IS DISTINCT FROM allocation_record.sales_order_version_id
     OR NEW.sales_order_line_id IS DISTINCT FROM allocation_record.sales_order_line_id
     OR NEW.fulfillment_demand_id IS DISTINCT FROM allocation_record.fulfillment_demand_id
     OR NEW.inventory_reservation_id IS DISTINCT FROM allocation_record.inventory_reservation_id
     OR NEW.warehouse_id IS DISTINCT FROM allocation_record.warehouse_id
     OR NEW.location_id IS DISTINCT FROM allocation_record.location_id
     OR NEW.base_variant_id IS DISTINCT FROM allocation_record.base_variant_id
     OR NEW.lot_id IS DISTINCT FROM allocation_record.lot_id THEN
    RAISE EXCEPTION 'delivery_order_lineage_mismatch';
  END IF;

  SELECT COALESCE(sum(line.delivery_base_quantity), 0)
    INTO claimed_quantity
    FROM sales.delivery_order_lines line
    JOIN sales.delivery_orders header
      ON header.installation_id = line.installation_id
     AND header.id = line.delivery_order_id
   WHERE line.installation_id = NEW.installation_id
     AND line.fulfillment_allocation_id = NEW.fulfillment_allocation_id
     AND header.status IN ('draft', 'ready_to_dispatch');

  IF claimed_quantity + NEW.delivery_base_quantity > allocation_record.packed_base_quantity THEN
    RAISE EXCEPTION 'delivery_order_quantity_exceeds_unclaimed_packed';
  END IF;

  NEW.packed_base_quantity_snapshot := allocation_record.packed_base_quantity;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_order_lines_write_guard ON sales.delivery_order_lines;
CREATE TRIGGER delivery_order_lines_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales.delivery_order_lines
FOR EACH ROW EXECUTE FUNCTION sales.guard_delivery_order_line_write();

CREATE OR REPLACE FUNCTION sales.guard_delivery_order_event_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.delivery_order_write_context', true);
BEGIN
  IF write_context IS DISTINCT FROM 'delivery_order_service' THEN
    RAISE EXCEPTION 'delivery_order_event_write_requires_service_context';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'delivery_order_events_are_append_only';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_order_events_write_guard ON sales.delivery_order_events;
CREATE TRIGGER delivery_order_events_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales.delivery_order_events
FOR EACH ROW EXECUTE FUNCTION sales.guard_delivery_order_event_write();
