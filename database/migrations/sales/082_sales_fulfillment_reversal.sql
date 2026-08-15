-- Issue #549 Lane D: append-only Fulfillment reversal and Delivery Order release-for-reversal.
-- Effective picked/packed projections may decrease only inside the canonical reversal service context.

CREATE TABLE IF NOT EXISTS sales.sales_order_fulfillment_reversal_batches (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  sales_order_id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('ALL', 'ELIGIBLE')),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 1000),
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 1 AND 128
    AND idempotency_key ~ '^[A-Za-z0-9._-]+$'
  ),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_order_fulfillment_reversal_batches_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT sales_order_fulfillment_reversal_batches_idempotency_unique UNIQUE (installation_id, idempotency_key),
  CONSTRAINT sales_order_fulfillment_reversal_batches_order_fk
    FOREIGN KEY (installation_id, sales_order_id)
    REFERENCES sales.sales_orders (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS sales_order_fulfillment_reversal_batches_order_idx
  ON sales.sales_order_fulfillment_reversal_batches (installation_id, sales_order_id, occurred_at DESC, id DESC);

CREATE OR REPLACE FUNCTION sales.guard_fulfillment_reversal_batch_write()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('npp.sales_fulfillment_allocation_write_context', true)
       IS DISTINCT FROM 'fulfillment_reversal_service' THEN
    RAISE EXCEPTION 'sales_fulfillment_reversal_batch_requires_service_context';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'sales_fulfillment_reversal_batches_are_append_only';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_order_fulfillment_reversal_batches_write_guard
  ON sales.sales_order_fulfillment_reversal_batches;
CREATE TRIGGER sales_order_fulfillment_reversal_batches_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales.sales_order_fulfillment_reversal_batches
FOR EACH ROW EXECUTE FUNCTION sales.guard_fulfillment_reversal_batch_write();

ALTER TABLE sales.sales_order_fulfillment_allocation_events
  DROP CONSTRAINT IF EXISTS sales_order_fulfillment_allocation_events_event_type_check;
ALTER TABLE sales.sales_order_fulfillment_allocation_events
  ADD CONSTRAINT sales_order_fulfillment_allocation_events_event_type_check
  CHECK (event_type IN ('ALLOCATED', 'PICKED', 'PACKED', 'PICK_REVERSED', 'PACK_REVERSED'));

-- Preserve the original allocation guard for every non-reversal context.
DROP TRIGGER IF EXISTS sales_order_fulfillment_allocations_writer_guard
  ON sales.sales_order_fulfillment_allocations;
CREATE TRIGGER sales_order_fulfillment_allocations_writer_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales.sales_order_fulfillment_allocations
FOR EACH ROW
WHEN (current_setting('npp.sales_fulfillment_allocation_write_context', true)
      IS DISTINCT FROM 'fulfillment_reversal_service')
EXECUTE FUNCTION sales.guard_sales_order_fulfillment_allocation_write();

CREATE OR REPLACE FUNCTION sales.guard_sales_order_fulfillment_allocation_reversal_write()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('npp.sales_fulfillment_allocation_write_context', true)
       IS DISTINCT FROM 'fulfillment_reversal_service' THEN
    RAISE EXCEPTION 'sales_fulfillment_reversal_requires_service_context';
  END IF;
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'sales_fulfillment_reversal_allows_update_only';
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
     OR NEW.operation_idempotency_key IS DISTINCT FROM OLD.operation_idempotency_key
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'sales_fulfillment_allocation_immutable_fields_cannot_change';
  END IF;
  IF NEW.picked_base_quantity > OLD.picked_base_quantity
     OR NEW.packed_base_quantity > OLD.packed_base_quantity
     OR NEW.picked_base_quantity < 0
     OR NEW.packed_base_quantity < 0
     OR NEW.packed_base_quantity > NEW.picked_base_quantity
     OR NEW.picked_base_quantity > NEW.allocated_base_quantity THEN
    RAISE EXCEPTION 'sales_fulfillment_reversal_projection_invalid';
  END IF;
  IF NEW.picked_base_quantity IS NOT DISTINCT FROM OLD.picked_base_quantity
     AND NEW.packed_base_quantity IS NOT DISTINCT FROM OLD.packed_base_quantity THEN
    RAISE EXCEPTION 'sales_fulfillment_reversal_progress_change_required';
  END IF;
  IF NEW.state NOT IN ('ACTIVE', 'COMPLETED') THEN
    RAISE EXCEPTION 'sales_fulfillment_reversal_state_invalid';
  END IF;
  IF NEW.state = 'COMPLETED' AND NEW.packed_base_quantity <> NEW.allocated_base_quantity THEN
    RAISE EXCEPTION 'sales_fulfillment_allocation_completion_requires_full_pack';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_order_fulfillment_allocations_reversal_guard
  ON sales.sales_order_fulfillment_allocations;
CREATE TRIGGER sales_order_fulfillment_allocations_reversal_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales.sales_order_fulfillment_allocations
FOR EACH ROW
WHEN (current_setting('npp.sales_fulfillment_allocation_write_context', true)
      = 'fulfillment_reversal_service')
EXECUTE FUNCTION sales.guard_sales_order_fulfillment_allocation_reversal_write();

DROP TRIGGER IF EXISTS sales_order_fulfillment_allocation_events_writer_guard
  ON sales.sales_order_fulfillment_allocation_events;
CREATE TRIGGER sales_order_fulfillment_allocation_events_writer_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales.sales_order_fulfillment_allocation_events
FOR EACH ROW
WHEN (current_setting('npp.sales_fulfillment_allocation_write_context', true)
      IS DISTINCT FROM 'fulfillment_reversal_service')
EXECUTE FUNCTION sales.guard_sales_order_fulfillment_allocation_event_write();

CREATE OR REPLACE FUNCTION sales.guard_sales_order_fulfillment_allocation_reversal_event_write()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('npp.sales_fulfillment_allocation_write_context', true)
       IS DISTINCT FROM 'fulfillment_reversal_service' THEN
    RAISE EXCEPTION 'sales_fulfillment_reversal_event_requires_service_context';
  END IF;
  IF TG_OP <> 'INSERT'
     OR NEW.event_type NOT IN ('PICK_REVERSED', 'PACK_REVERSED')
     OR NEW.quantity_delta <= 0
     OR NEW.reason IS NULL
     OR btrim(NEW.reason) = '' THEN
    RAISE EXCEPTION 'sales_fulfillment_reversal_event_invalid';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_order_fulfillment_allocation_events_reversal_guard
  ON sales.sales_order_fulfillment_allocation_events;
CREATE TRIGGER sales_order_fulfillment_allocation_events_reversal_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales.sales_order_fulfillment_allocation_events
FOR EACH ROW
WHEN (current_setting('npp.sales_fulfillment_allocation_write_context', true)
      = 'fulfillment_reversal_service')
EXECUTE FUNCTION sales.guard_sales_order_fulfillment_allocation_reversal_event_write();

-- Preserve the 045 demand guard except when projection is caused by a canonical reversal.
DROP TRIGGER IF EXISTS sales_order_fulfillment_demands_writer_guard
  ON sales.sales_order_fulfillment_demands;
CREATE TRIGGER sales_order_fulfillment_demands_writer_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales.sales_order_fulfillment_demands
FOR EACH ROW
WHEN (current_setting('npp.sales_fulfillment_write_context', true)
      IS DISTINCT FROM 'fulfillment_reversal_service')
EXECUTE FUNCTION sales.guard_sales_order_fulfillment_demand_write();

CREATE OR REPLACE FUNCTION sales.guard_sales_order_fulfillment_demand_reversal_write()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('npp.sales_fulfillment_write_context', true)
       IS DISTINCT FROM 'fulfillment_reversal_service' THEN
    RAISE EXCEPTION 'sales_fulfillment_demand_reversal_requires_service_context';
  END IF;
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'sales_fulfillment_demand_reversal_allows_update_only';
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
     OR NEW.allocated_base_quantity IS DISTINCT FROM OLD.allocated_base_quantity
     OR NEW.issued_base_quantity IS DISTINCT FROM OLD.issued_base_quantity
     OR NEW.cancelled_base_quantity IS DISTINCT FROM OLD.cancelled_base_quantity
     OR NEW.state IS DISTINCT FROM OLD.state
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'sales_fulfillment_demand_reversal_immutable_fields_changed';
  END IF;
  IF NEW.picked_base_quantity > OLD.picked_base_quantity
     OR NEW.packed_base_quantity > OLD.packed_base_quantity
     OR NEW.picked_base_quantity < 0
     OR NEW.packed_base_quantity < 0
     OR NEW.issued_base_quantity > NEW.packed_base_quantity
     OR NEW.packed_base_quantity > NEW.picked_base_quantity
     OR NEW.picked_base_quantity > NEW.allocated_base_quantity THEN
    RAISE EXCEPTION 'sales_fulfillment_demand_reversal_projection_invalid';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_order_fulfillment_demands_reversal_guard
  ON sales.sales_order_fulfillment_demands;
CREATE TRIGGER sales_order_fulfillment_demands_reversal_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales.sales_order_fulfillment_demands
FOR EACH ROW
WHEN (current_setting('npp.sales_fulfillment_write_context', true)
      = 'fulfillment_reversal_service')
EXECUTE FUNCTION sales.guard_sales_order_fulfillment_demand_reversal_write();

CREATE OR REPLACE FUNCTION sales.project_sales_order_fulfillment_allocation_progress()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous_context text := current_setting('npp.sales_fulfillment_write_context', true);
  allocation_context text := current_setting('npp.sales_fulfillment_allocation_write_context', true);
  target_demand_id uuid;
  target_order_id uuid;
  target_installation_id text;
  target_actor_id text;
  progress_status text;
BEGIN
  target_demand_id := COALESCE(NEW.fulfillment_demand_id, OLD.fulfillment_demand_id);
  target_order_id := COALESCE(NEW.sales_order_id, OLD.sales_order_id);
  target_installation_id := COALESCE(NEW.installation_id, OLD.installation_id);
  target_actor_id := COALESCE(NEW.updated_by, OLD.updated_by);
  PERFORM set_config(
    'npp.sales_fulfillment_write_context',
    CASE WHEN allocation_context = 'fulfillment_reversal_service'
      THEN 'fulfillment_reversal_service' ELSE 'fulfillment_service' END,
    true
  );
  UPDATE sales.sales_order_fulfillment_demands demand
     SET allocated_base_quantity = totals.allocated_quantity,
         picked_base_quantity = totals.picked_quantity,
         packed_base_quantity = totals.packed_quantity,
         updated_at = now(),
         updated_by = target_actor_id
    FROM (
      SELECT COALESCE(sum(allocation.allocated_base_quantity), 0)::numeric(30,12) AS allocated_quantity,
             COALESCE(sum(allocation.picked_base_quantity), 0)::numeric(30,12) AS picked_quantity,
             COALESCE(sum(allocation.packed_base_quantity), 0)::numeric(30,12) AS packed_quantity
        FROM sales.sales_order_fulfillment_allocations allocation
       WHERE allocation.installation_id = target_installation_id
         AND allocation.fulfillment_demand_id = target_demand_id
    ) totals
   WHERE demand.installation_id = target_installation_id
     AND demand.id = target_demand_id;
  SELECT CASE
    WHEN count(*) = 0 THEN NULL
    WHEN sum(demand.packed_base_quantity) = sum(demand.reserved_base_quantity)
         AND sum(demand.reserved_base_quantity) > 0
         AND sum(demand.backordered_base_quantity) = 0 THEN 'packed'
    WHEN sum(demand.packed_base_quantity) > 0 THEN 'partially_packed'
    WHEN sum(demand.picked_base_quantity) = sum(demand.reserved_base_quantity)
         AND sum(demand.reserved_base_quantity) > 0
         AND sum(demand.backordered_base_quantity) = 0 THEN 'picked'
    WHEN sum(demand.picked_base_quantity) > 0 THEN 'partially_picked'
    WHEN sum(demand.allocated_base_quantity) = sum(demand.reserved_base_quantity)
         AND sum(demand.reserved_base_quantity) > 0
         AND sum(demand.backordered_base_quantity) = 0 THEN 'allocated'
    WHEN sum(demand.allocated_base_quantity) > 0 THEN 'partially_allocated'
    WHEN sum(demand.reserved_base_quantity) = 0 THEN 'backordered'
    WHEN sum(demand.backordered_base_quantity) > 0 THEN 'partially_reserved'
    ELSE 'reserved'
  END INTO progress_status
    FROM sales.sales_order_fulfillment_demands demand
   WHERE demand.installation_id = target_installation_id
     AND demand.sales_order_id = target_order_id
     AND demand.state = 'ACTIVE';
  UPDATE sales.sales_orders
     SET fulfillment_status = COALESCE(progress_status, fulfillment_status),
         updated_at = now(), updated_by = target_actor_id
   WHERE installation_id = target_installation_id
     AND id = target_order_id
     AND status = 'confirmed';
  PERFORM set_config('npp.sales_fulfillment_write_context', COALESCE(previous_context, ''), true);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('npp.sales_fulfillment_write_context', COALESCE(previous_context, ''), true);
  RAISE;
END;
$$;

-- Delivery Order release is a separate reversal action; ordinary draft cancel stays unchanged.
ALTER TABLE sales.delivery_order_events
  DROP CONSTRAINT IF EXISTS delivery_order_events_event_type_check;
ALTER TABLE sales.delivery_order_events
  ADD CONSTRAINT delivery_order_events_event_type_check CHECK (event_type IN (
    'CREATED', 'CONFIRMED', 'CANCELLED',
    'INVENTORY_ISSUED', 'PICKUP_HANDED_OVER', 'MANUAL_HANDED_OVER',
    'INVENTORY_ISSUE_REVERSED', 'RELEASED_FOR_REVERSAL'
  ));

DROP TRIGGER IF EXISTS delivery_orders_write_guard ON sales.delivery_orders;
CREATE TRIGGER delivery_orders_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales.delivery_orders
FOR EACH ROW
WHEN (current_setting('npp.delivery_order_write_context', true)
      IS DISTINCT FROM 'delivery_reversal_service')
EXECUTE FUNCTION sales.guard_delivery_order_header_write();

CREATE OR REPLACE FUNCTION sales.guard_delivery_order_reversal_write()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('npp.delivery_order_write_context', true)
       IS DISTINCT FROM 'delivery_reversal_service' THEN
    RAISE EXCEPTION 'delivery_order_reversal_requires_service_context';
  END IF;
  IF TG_OP <> 'UPDATE'
     OR OLD.status <> 'ready_to_dispatch'
     OR NEW.status <> 'cancelled'
     OR NEW.cancelled_at IS NULL
     OR NEW.cancelled_by IS NULL
     OR NEW.cancellation_reason IS NULL
     OR btrim(NEW.cancellation_reason) = '' THEN
    RAISE EXCEPTION 'delivery_order_invalid_reversal_transition';
  END IF;
  IF NEW.installation_id IS DISTINCT FROM OLD.installation_id
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.sales_order_id IS DISTINCT FROM OLD.sales_order_id
     OR NEW.sales_order_version_id IS DISTINCT FROM OLD.sales_order_version_id
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.customer_address_id IS DISTINCT FROM OLD.customer_address_id
     OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
     OR NEW.handover_mode IS DISTINCT FROM OLD.handover_mode
     OR NEW.create_idempotency_key IS DISTINCT FROM OLD.create_idempotency_key
     OR NEW.create_payload_hash IS DISTINCT FROM OLD.create_payload_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'delivery_order_immutable_header_changed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_orders_reversal_guard ON sales.delivery_orders;
CREATE TRIGGER delivery_orders_reversal_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales.delivery_orders
FOR EACH ROW
WHEN (current_setting('npp.delivery_order_write_context', true) = 'delivery_reversal_service')
EXECUTE FUNCTION sales.guard_delivery_order_reversal_write();

DROP TRIGGER IF EXISTS delivery_order_events_write_guard ON sales.delivery_order_events;
CREATE TRIGGER delivery_order_events_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales.delivery_order_events
FOR EACH ROW
WHEN (current_setting('npp.delivery_order_write_context', true)
      IS DISTINCT FROM 'delivery_reversal_service')
EXECUTE FUNCTION sales.guard_delivery_order_event_write();

CREATE OR REPLACE FUNCTION sales.guard_delivery_order_reversal_event_write()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('npp.delivery_order_write_context', true) IS DISTINCT FROM 'delivery_reversal_service'
     OR TG_OP <> 'INSERT'
     OR NEW.event_type <> 'RELEASED_FOR_REVERSAL'
     OR NEW.reason IS NULL
     OR btrim(NEW.reason) = '' THEN
    RAISE EXCEPTION 'delivery_order_reversal_event_invalid';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_order_events_reversal_guard ON sales.delivery_order_events;
CREATE TRIGGER delivery_order_events_reversal_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales.delivery_order_events
FOR EACH ROW
WHEN (current_setting('npp.delivery_order_write_context', true) = 'delivery_reversal_service')
EXECUTE FUNCTION sales.guard_delivery_order_reversal_event_write();
