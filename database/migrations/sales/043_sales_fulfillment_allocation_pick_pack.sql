-- Phase 6D.2: exact location/lot allocation, pick and pack.
-- Allocation creates an exact Inventory reservation and keeps immutable lineage
-- to the active Sales fulfillment demand. Delivery Order and Inventory OUT are later phases.

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES
  ('core.fulfillment.allocate', 'Kho', 'Phân bổ hàng cho đơn', 'Cho phép phân bổ phần hàng đã giữ của đơn bán hàng vào đúng vị trí và lô trong phạm vi kho được cấp.', true, now()),
  ('core.fulfillment.pick', 'Kho', 'Xác nhận soạn hàng', 'Cho phép xác nhận số lượng thực tế đã lấy từ allocation của đơn bán hàng.', true, now()),
  ('core.fulfillment.pack', 'Kho', 'Xác nhận đóng gói', 'Cho phép xác nhận số lượng đã đóng gói từ phần đã soạn.', true, now()),
  ('core.fulfillment.override-allocation-policy', 'Kho', 'Đổi thứ tự lô được đề xuất', 'Cho phép phân bổ thủ công khác FEFO/FIFO khi có lý do bắt buộc.', true, now())
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
    'partially_allocated', 'allocated',
    'partially_picked', 'picked',
    'partially_packed', 'packed',
    'partially_issued', 'issued',
    'partially_fulfilled', 'fulfilled', 'cancelled'
  ));

CREATE TABLE IF NOT EXISTS sales.sales_order_fulfillment_allocations (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  fulfillment_demand_id uuid NOT NULL,
  sales_order_id uuid NOT NULL,
  sales_order_version_id uuid NOT NULL,
  sales_order_line_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  location_id uuid NULL,
  base_variant_id uuid NOT NULL,
  lot_id uuid NULL,
  inventory_reservation_id uuid NOT NULL,
  allocation_sequence integer NOT NULL CHECK (allocation_sequence BETWEEN 1 AND 10000),
  allocation_policy text NOT NULL CHECK (allocation_policy IN ('FEFO', 'FIFO', 'MANUAL')),
  policy_rank integer NOT NULL CHECK (policy_rank BETWEEN 1 AND 1000000),
  manual_override_reason text NULL CHECK (
    manual_override_reason IS NULL
    OR char_length(btrim(manual_override_reason)) BETWEEN 1 AND 1000
  ),
  allocated_base_quantity numeric(30,12) NOT NULL CHECK (allocated_base_quantity > 0),
  picked_base_quantity numeric(30,12) NOT NULL DEFAULT 0 CHECK (picked_base_quantity >= 0),
  packed_base_quantity numeric(30,12) NOT NULL DEFAULT 0 CHECK (packed_base_quantity >= 0),
  state text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'COMPLETED')),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  CONSTRAINT sales_order_fulfillment_allocations_installation_id_unique
    UNIQUE (installation_id, id),
  CONSTRAINT sales_order_fulfillment_allocations_reservation_unique
    UNIQUE (installation_id, inventory_reservation_id),
  CONSTRAINT sales_order_fulfillment_allocations_idempotency_unique
    UNIQUE (installation_id, idempotency_key),
  CONSTRAINT sales_order_fulfillment_allocations_quantity_check CHECK (
    picked_base_quantity <= allocated_base_quantity
    AND packed_base_quantity <= picked_base_quantity
  ),
  CONSTRAINT sales_order_fulfillment_allocations_manual_shape CHECK (
    (allocation_policy = 'MANUAL' AND manual_override_reason IS NOT NULL)
    OR (allocation_policy IN ('FEFO', 'FIFO') AND manual_override_reason IS NULL)
  ),
  CONSTRAINT sales_order_fulfillment_allocations_demand_fk
    FOREIGN KEY (installation_id, fulfillment_demand_id)
    REFERENCES sales.sales_order_fulfillment_demands (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sales_order_fulfillment_allocations_order_fk
    FOREIGN KEY (installation_id, sales_order_id)
    REFERENCES sales.sales_orders (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sales_order_fulfillment_allocations_version_fk
    FOREIGN KEY (installation_id, sales_order_version_id)
    REFERENCES sales.sales_order_versions (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sales_order_fulfillment_allocations_line_fk
    FOREIGN KEY (installation_id, sales_order_line_id)
    REFERENCES sales.sales_order_version_lines (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sales_order_fulfillment_allocations_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sales_order_fulfillment_allocations_location_fk
    FOREIGN KEY (installation_id, warehouse_id, location_id)
    REFERENCES shared.warehouse_locations (installation_id, warehouse_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sales_order_fulfillment_allocations_variant_fk
    FOREIGN KEY (installation_id, base_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sales_order_fulfillment_allocations_lot_fk
    FOREIGN KEY (installation_id, lot_id)
    REFERENCES inventory.inventory_lots (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT sales_order_fulfillment_allocations_inventory_reservation_fk
    FOREIGN KEY (installation_id, inventory_reservation_id)
    REFERENCES inventory.inventory_reservations (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_order_fulfillment_allocations_scope_unique
  ON sales.sales_order_fulfillment_allocations (
    installation_id,
    fulfillment_demand_id,
    COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
CREATE INDEX IF NOT EXISTS sales_order_fulfillment_allocations_order_idx
  ON sales.sales_order_fulfillment_allocations (
    installation_id, sales_order_id, state, allocation_sequence
  );
CREATE INDEX IF NOT EXISTS sales_order_fulfillment_allocations_demand_idx
  ON sales.sales_order_fulfillment_allocations (
    installation_id, fulfillment_demand_id, state, allocation_sequence
  );
CREATE INDEX IF NOT EXISTS sales_order_fulfillment_allocations_pick_queue_idx
  ON sales.sales_order_fulfillment_allocations (
    installation_id, warehouse_id, state, created_at, allocation_sequence
  ) WHERE picked_base_quantity < allocated_base_quantity;
CREATE INDEX IF NOT EXISTS sales_order_fulfillment_allocations_pack_queue_idx
  ON sales.sales_order_fulfillment_allocations (
    installation_id, warehouse_id, state, created_at, allocation_sequence
  ) WHERE packed_base_quantity < picked_base_quantity;

CREATE TABLE IF NOT EXISTS sales.sales_order_fulfillment_allocation_events (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  allocation_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('ALLOCATED', 'PICKED', 'PACKED')),
  quantity_delta numeric(30,12) NOT NULL CHECK (quantity_delta > 0),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  reason text NULL CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 1000),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_order_fulfillment_allocation_events_installation_id_unique
    UNIQUE (installation_id, id),
  CONSTRAINT sales_order_fulfillment_allocation_events_idempotency_unique
    UNIQUE (installation_id, idempotency_key),
  CONSTRAINT sales_order_fulfillment_allocation_events_allocation_fk
    FOREIGN KEY (installation_id, allocation_id)
    REFERENCES sales.sales_order_fulfillment_allocations (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS sales_order_fulfillment_allocation_events_allocation_idx
  ON sales.sales_order_fulfillment_allocation_events (
    installation_id, allocation_id, occurred_at, id
  );

CREATE OR REPLACE FUNCTION sales.guard_sales_order_fulfillment_allocation_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.sales_fulfillment_allocation_write_context', true);
  demand_record sales.sales_order_fulfillment_demands;
  reservation_record inventory.inventory_reservations;
  allocated_total numeric(30,12);
BEGIN
  IF write_context IS DISTINCT FROM 'fulfillment_allocation_service' THEN
    RAISE EXCEPTION 'sales_fulfillment_allocation_write_requires_service_context';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'sales_fulfillment_allocations_cannot_be_deleted';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT * INTO demand_record
      FROM sales.sales_order_fulfillment_demands
     WHERE installation_id = NEW.installation_id
       AND id = NEW.fulfillment_demand_id
       AND state = 'ACTIVE'
     FOR UPDATE;

    IF demand_record IS NULL THEN
      RAISE EXCEPTION 'sales_fulfillment_active_demand_required';
    END IF;

    IF NEW.sales_order_id IS DISTINCT FROM demand_record.sales_order_id
       OR NEW.sales_order_version_id IS DISTINCT FROM demand_record.sales_order_version_id
       OR NEW.sales_order_line_id IS DISTINCT FROM demand_record.sales_order_line_id
       OR NEW.warehouse_id IS DISTINCT FROM demand_record.warehouse_id
       OR NEW.base_variant_id IS DISTINCT FROM demand_record.base_variant_id THEN
      RAISE EXCEPTION 'sales_fulfillment_allocation_lineage_mismatch';
    END IF;

    SELECT COALESCE(sum(allocation.allocated_base_quantity), 0)
      INTO allocated_total
      FROM sales.sales_order_fulfillment_allocations allocation
     WHERE allocation.installation_id = NEW.installation_id
       AND allocation.fulfillment_demand_id = NEW.fulfillment_demand_id;

    IF allocated_total + NEW.allocated_base_quantity > demand_record.reserved_base_quantity THEN
      RAISE EXCEPTION 'sales_fulfillment_allocation_exceeds_reserved_demand';
    END IF;

    SELECT * INTO reservation_record
      FROM inventory.inventory_reservations
     WHERE installation_id = NEW.installation_id
       AND id = NEW.inventory_reservation_id;

    IF reservation_record IS NULL
       OR reservation_record.state <> 'ACTIVE'
       OR reservation_record.warehouse_id IS DISTINCT FROM NEW.warehouse_id
       OR reservation_record.location_id IS DISTINCT FROM NEW.location_id
       OR reservation_record.base_variant_id IS DISTINCT FROM NEW.base_variant_id
       OR reservation_record.lot_id IS DISTINCT FROM NEW.lot_id
       OR reservation_record.quantity IS DISTINCT FROM NEW.allocated_base_quantity
       OR reservation_record.source_domain <> 'SALES'
       OR reservation_record.source_document_type <> 'SALES_FULFILLMENT_ALLOCATION'
       OR reservation_record.source_document_id IS DISTINCT FROM NEW.id::text THEN
      RAISE EXCEPTION 'sales_fulfillment_exact_reservation_mismatch';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.installation_id IS DISTINCT FROM OLD.installation_id
     OR NEW.fulfillment_demand_id IS DISTINCT FROM OLD.fulfillment_demand_id
     OR NEW.sales_order_id IS DISTINCT FROM OLD.sales_order_id
     OR NEW.sales_order_version_id IS DISTINCT FROM OLD.sales_order_version_id
     OR NEW.sales_order_line_id IS DISTINCT FROM OLD.sales_order_line_id
     OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
     OR NEW.location_id IS DISTINCT FROM OLD.location_id
     OR NEW.base_variant_id IS DISTINCT FROM OLD.base_variant_id
     OR NEW.lot_id IS DISTINCT FROM OLD.lot_id
     OR NEW.inventory_reservation_id IS DISTINCT FROM OLD.inventory_reservation_id
     OR NEW.allocation_sequence IS DISTINCT FROM OLD.allocation_sequence
     OR NEW.allocation_policy IS DISTINCT FROM OLD.allocation_policy
     OR NEW.policy_rank IS DISTINCT FROM OLD.policy_rank
     OR NEW.manual_override_reason IS DISTINCT FROM OLD.manual_override_reason
     OR NEW.allocated_base_quantity IS DISTINCT FROM OLD.allocated_base_quantity
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'sales_fulfillment_allocation_immutable_fields_cannot_change';
  END IF;

  IF NEW.picked_base_quantity < OLD.picked_base_quantity
     OR NEW.packed_base_quantity < OLD.packed_base_quantity THEN
    RAISE EXCEPTION 'sales_fulfillment_allocation_progress_cannot_decrease';
  END IF;

  IF OLD.state = 'COMPLETED' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'sales_fulfillment_completed_allocation_is_immutable';
  END IF;

  IF NEW.state = 'COMPLETED'
     AND NEW.packed_base_quantity <> NEW.allocated_base_quantity THEN
    RAISE EXCEPTION 'sales_fulfillment_allocation_completion_requires_full_pack';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_order_fulfillment_allocations_writer_guard
  ON sales.sales_order_fulfillment_allocations;
CREATE TRIGGER sales_order_fulfillment_allocations_writer_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales.sales_order_fulfillment_allocations
FOR EACH ROW EXECUTE FUNCTION sales.guard_sales_order_fulfillment_allocation_write();

CREATE OR REPLACE FUNCTION sales.guard_sales_order_fulfillment_allocation_event_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.sales_fulfillment_allocation_write_context', true);
BEGIN
  IF write_context IS DISTINCT FROM 'fulfillment_allocation_service' THEN
    RAISE EXCEPTION 'sales_fulfillment_allocation_event_write_requires_service_context';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'sales_fulfillment_allocation_events_are_append_only';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_order_fulfillment_allocation_events_writer_guard
  ON sales.sales_order_fulfillment_allocation_events;
CREATE TRIGGER sales_order_fulfillment_allocation_events_writer_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales.sales_order_fulfillment_allocation_events
FOR EACH ROW EXECUTE FUNCTION sales.guard_sales_order_fulfillment_allocation_event_write();

CREATE OR REPLACE FUNCTION sales.project_sales_order_fulfillment_allocation_progress()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  previous_context text := current_setting('npp.sales_fulfillment_write_context', true);
  target_demand_id uuid := COALESCE(NEW.fulfillment_demand_id, OLD.fulfillment_demand_id);
  target_order_id uuid := COALESCE(NEW.sales_order_id, OLD.sales_order_id);
  target_installation_id text := COALESCE(NEW.installation_id, OLD.installation_id);
  progress_status text;
BEGIN
  PERFORM set_config('npp.sales_fulfillment_write_context', 'fulfillment_service', true);

  UPDATE sales.sales_order_fulfillment_demands demand
     SET allocated_base_quantity = totals.allocated_quantity,
         picked_base_quantity = totals.picked_quantity,
         packed_base_quantity = totals.packed_quantity,
         updated_at = now(),
         updated_by = COALESCE(NEW.updated_by, OLD.updated_by)
    FROM (
      SELECT
        COALESCE(sum(allocation.allocated_base_quantity), 0)::numeric(30,12) AS allocated_quantity,
        COALESCE(sum(allocation.picked_base_quantity), 0)::numeric(30,12) AS picked_quantity,
        COALESCE(sum(allocation.packed_base_quantity), 0)::numeric(30,12) AS packed_quantity
      FROM sales.sales_order_fulfillment_allocations allocation
      WHERE allocation.installation_id = target_installation_id
        AND allocation.fulfillment_demand_id = target_demand_id
    ) totals
   WHERE demand.installation_id = target_installation_id
     AND demand.id = target_demand_id;

  SELECT CASE
    WHEN sum(demand.packed_base_quantity) = sum(demand.reserved_base_quantity)
         AND sum(demand.reserved_base_quantity) > 0 THEN 'packed'
    WHEN sum(demand.packed_base_quantity) > 0 THEN 'partially_packed'
    WHEN sum(demand.picked_base_quantity) = sum(demand.reserved_base_quantity)
         AND sum(demand.reserved_base_quantity) > 0 THEN 'picked'
    WHEN sum(demand.picked_base_quantity) > 0 THEN 'partially_picked'
    WHEN sum(demand.allocated_base_quantity) = sum(demand.reserved_base_quantity)
         AND sum(demand.reserved_base_quantity) > 0 THEN 'allocated'
    WHEN sum(demand.allocated_base_quantity) > 0 THEN 'partially_allocated'
    WHEN sum(demand.reserved_base_quantity) = 0 THEN 'backordered'
    WHEN sum(demand.backordered_base_quantity) > 0 THEN 'partially_reserved'
    ELSE 'reserved'
  END
    INTO progress_status
    FROM sales.sales_order_fulfillment_demands demand
   WHERE demand.installation_id = target_installation_id
     AND demand.sales_order_id = target_order_id
     AND demand.state = 'ACTIVE';

  UPDATE sales.sales_orders
     SET fulfillment_status = COALESCE(progress_status, fulfillment_status),
         updated_at = now(),
         updated_by = COALESCE(NEW.updated_by, OLD.updated_by)
   WHERE installation_id = target_installation_id
     AND id = target_order_id
     AND status = 'confirmed';

  PERFORM set_config(
    'npp.sales_fulfillment_write_context',
    COALESCE(previous_context, ''),
    true
  );
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config(
      'npp.sales_fulfillment_write_context',
      COALESCE(previous_context, ''),
      true
    );
    RAISE;
END;
$$;

DROP TRIGGER IF EXISTS sales_order_fulfillment_allocations_project_progress
  ON sales.sales_order_fulfillment_allocations;
CREATE TRIGGER sales_order_fulfillment_allocations_project_progress
AFTER INSERT OR UPDATE OF picked_base_quantity, packed_base_quantity, state
ON sales.sales_order_fulfillment_allocations
FOR EACH ROW EXECUTE FUNCTION sales.project_sales_order_fulfillment_allocation_progress();
