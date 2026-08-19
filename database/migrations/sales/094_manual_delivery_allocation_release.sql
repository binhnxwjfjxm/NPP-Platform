-- Issue #622: Giao thủ công may release stock allocations that have not started physical execution.
-- Released allocation and reservation rows remain immutable history; nothing is deleted or rewritten.

ALTER TABLE sales.sales_order_fulfillment_allocations
  DROP CONSTRAINT IF EXISTS sales_order_fulfillment_allocations_state_check;
ALTER TABLE sales.sales_order_fulfillment_allocations
  ADD CONSTRAINT sales_order_fulfillment_allocations_state_check
  CHECK (state IN ('ACTIVE', 'COMPLETED', 'RELEASED'));

ALTER TABLE sales.sales_order_fulfillment_allocation_events
  DROP CONSTRAINT IF EXISTS sales_order_fulfillment_allocation_events_event_type_check;
ALTER TABLE sales.sales_order_fulfillment_allocation_events
  ADD CONSTRAINT sales_order_fulfillment_allocation_events_event_type_check
  CHECK (event_type IN ('ALLOCATED', 'PICKED', 'PACKED', 'PICK_REVERSED', 'PACK_REVERSED', 'RELEASED'));

-- Once released, an allocation is terminal and remains historical evidence.
CREATE OR REPLACE FUNCTION sales.guard_released_fulfillment_allocation_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.state = 'RELEASED' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'sales_fulfillment_released_allocation_is_immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS sales_order_fulfillment_allocations_released_immutable_guard
  ON sales.sales_order_fulfillment_allocations;
CREATE TRIGGER sales_order_fulfillment_allocations_released_immutable_guard
BEFORE UPDATE ON sales.sales_order_fulfillment_allocations
FOR EACH ROW EXECUTE FUNCTION sales.guard_released_fulfillment_allocation_immutable();

-- A released allocation must not stop the old demand from becoming SUPERSEDED.
CREATE OR REPLACE FUNCTION sales.guard_allocated_fulfillment_demand_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.state = 'ACTIVE'
     AND NEW.state IS DISTINCT FROM OLD.state
     AND EXISTS (
       SELECT 1
         FROM sales.sales_order_fulfillment_allocations allocation
        WHERE allocation.installation_id = OLD.installation_id
          AND allocation.fulfillment_demand_id = OLD.id
          AND allocation.state <> 'RELEASED'
     ) THEN
    RAISE EXCEPTION 'sales_fulfillment_transition_blocked_by_allocation';
  END IF;
  RETURN NEW;
END;
$$;

-- Preserve the shared hold contract, adding one narrow projection context that may only
-- reduce allocated quantity after the matching exact reservation/allocation was released.
CREATE OR REPLACE FUNCTION sales.guard_sales_order_fulfillment_demand_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.sales_fulfillment_write_context', true);
BEGIN
  IF write_context IS NULL
     OR write_context NOT IN (
       'fulfillment_service',
       'delivery_issue_service',
       'fulfillment_hold_service',
       'fulfillment_release_service'
     ) THEN
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

  IF write_context = 'fulfillment_hold_service' THEN
    IF OLD.state <> 'ACTIVE' THEN
      RAISE EXCEPTION 'sales_fulfillment_demand_terminal_state_is_immutable';
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
       OR NEW.allocated_base_quantity IS DISTINCT FROM OLD.allocated_base_quantity
       OR NEW.picked_base_quantity IS DISTINCT FROM OLD.picked_base_quantity
       OR NEW.packed_base_quantity IS DISTINCT FROM OLD.packed_base_quantity
       OR NEW.issued_base_quantity IS DISTINCT FROM OLD.issued_base_quantity
       OR NEW.cancelled_base_quantity IS DISTINCT FROM OLD.cancelled_base_quantity
       OR NEW.state IS DISTINCT FROM OLD.state
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'sales_fulfillment_hold_service_may_change_hold_only';
    END IF;

    IF OLD.picked_base_quantity <> 0
       OR OLD.packed_base_quantity <> 0
       OR OLD.issued_base_quantity <> 0 THEN
      RAISE EXCEPTION 'sales_fulfillment_hold_locked_after_execution';
    END IF;

    IF COALESCE(NEW.allocation_target_base_quantity, NEW.ordered_base_quantity)
         < NEW.allocated_base_quantity THEN
      RAISE EXCEPTION 'sales_fulfillment_hold_below_allocated_quantity';
    END IF;
    RETURN NEW;
  END IF;

  IF write_context = 'fulfillment_release_service' THEN
    IF OLD.state <> 'ACTIVE'
       OR NEW.state IS DISTINCT FROM OLD.state
       OR OLD.picked_base_quantity <> 0
       OR OLD.packed_base_quantity <> 0
       OR OLD.issued_base_quantity <> 0
       OR NEW.picked_base_quantity <> 0
       OR NEW.packed_base_quantity <> 0
       OR NEW.issued_base_quantity <> 0 THEN
      RAISE EXCEPTION 'sales_fulfillment_release_locked_after_execution';
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
       OR NEW.allocation_target_base_quantity IS DISTINCT FROM OLD.allocation_target_base_quantity
       OR NEW.reserved_base_quantity IS DISTINCT FROM OLD.reserved_base_quantity
       OR NEW.backordered_base_quantity IS DISTINCT FROM OLD.backordered_base_quantity
       OR NEW.cancelled_base_quantity IS DISTINCT FROM OLD.cancelled_base_quantity
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'sales_fulfillment_release_may_change_allocated_projection_only';
    END IF;
    IF NEW.allocated_base_quantity < 0
       OR NEW.allocated_base_quantity > OLD.allocated_base_quantity THEN
      RAISE EXCEPTION 'sales_fulfillment_release_projection_invalid';
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
     OR NEW.allocation_target_base_quantity IS DISTINCT FROM OLD.allocation_target_base_quantity
     OR NEW.reserved_base_quantity IS DISTINCT FROM OLD.reserved_base_quantity
     OR NEW.backordered_base_quantity IS DISTINCT FROM OLD.backordered_base_quantity
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'sales_fulfillment_demand_immutable_fields_cannot_change';
  END IF;

  IF write_context = 'delivery_issue_service' THEN
    IF NEW.allocated_base_quantity IS DISTINCT FROM OLD.allocated_base_quantity
       OR NEW.picked_base_quantity IS DISTINCT FROM OLD.picked_base_quantity
       OR NEW.packed_base_quantity IS DISTINCT FROM OLD.packed_base_quantity
       OR NEW.cancelled_base_quantity IS DISTINCT FROM OLD.cancelled_base_quantity
       OR NEW.state IS DISTINCT FROM OLD.state
       OR NEW.issued_base_quantity < 0
       OR NEW.issued_base_quantity > NEW.packed_base_quantity THEN
      RAISE EXCEPTION 'sales_fulfillment_issue_projection_invalid';
    END IF;
    RETURN NEW;
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

-- Ordinary allocation writes and reversal writes keep their existing guards. Release gets
-- its own narrow guard, so it cannot become a generic way to mutate fulfillment history.
DROP TRIGGER IF EXISTS sales_order_fulfillment_allocations_writer_guard
  ON sales.sales_order_fulfillment_allocations;
CREATE TRIGGER sales_order_fulfillment_allocations_writer_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales.sales_order_fulfillment_allocations
FOR EACH ROW
WHEN (
  current_setting('npp.sales_fulfillment_allocation_write_context', true)
    IS DISTINCT FROM 'fulfillment_reversal_service'
  AND current_setting('npp.sales_fulfillment_allocation_write_context', true)
    IS DISTINCT FROM 'fulfillment_release_service'
)
EXECUTE FUNCTION sales.guard_sales_order_fulfillment_allocation_write();

CREATE OR REPLACE FUNCTION sales.guard_sales_order_fulfillment_allocation_release_write()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  demand_issued numeric(30,12);
  reservation_state text;
  claimed_quantity numeric(30,12);
BEGIN
  IF current_setting('npp.sales_fulfillment_allocation_write_context', true)
       IS DISTINCT FROM 'fulfillment_release_service' THEN
    RAISE EXCEPTION 'sales_fulfillment_release_requires_service_context';
  END IF;
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'sales_fulfillment_release_allows_update_only';
  END IF;
  IF OLD.state <> 'ACTIVE' OR NEW.state <> 'RELEASED' THEN
    RAISE EXCEPTION 'sales_fulfillment_release_state_invalid';
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
     OR NEW.picked_base_quantity IS DISTINCT FROM OLD.picked_base_quantity
     OR NEW.packed_base_quantity IS DISTINCT FROM OLD.packed_base_quantity
     OR NEW.operation_idempotency_key IS DISTINCT FROM OLD.operation_idempotency_key
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'sales_fulfillment_release_immutable_fields_changed';
  END IF;
  IF OLD.picked_base_quantity <> 0 OR OLD.packed_base_quantity <> 0 THEN
    RAISE EXCEPTION 'sales_fulfillment_release_locked_after_execution';
  END IF;

  SELECT demand.issued_base_quantity
    INTO demand_issued
    FROM sales.sales_order_fulfillment_demands demand
   WHERE demand.installation_id = OLD.installation_id
     AND demand.id = OLD.fulfillment_demand_id
     AND demand.state = 'ACTIVE'
   FOR UPDATE;
  IF NOT FOUND OR demand_issued <> 0 THEN
    RAISE EXCEPTION 'sales_fulfillment_release_locked_after_issue';
  END IF;

  SELECT reservation.state
    INTO reservation_state
    FROM inventory.inventory_reservations reservation
   WHERE reservation.installation_id = OLD.installation_id
     AND reservation.id = OLD.inventory_reservation_id;
  IF reservation_state IS DISTINCT FROM 'RELEASED' THEN
    RAISE EXCEPTION 'sales_fulfillment_release_requires_released_reservation';
  END IF;

  SELECT COALESCE(sum(line.delivery_base_quantity), 0)::numeric(30,12)
    INTO claimed_quantity
    FROM sales.delivery_order_lines line
    JOIN sales.delivery_orders delivery_order
      ON delivery_order.installation_id = line.installation_id
     AND delivery_order.id = line.delivery_order_id
   WHERE line.installation_id = OLD.installation_id
     AND line.fulfillment_allocation_id = OLD.id
     AND delivery_order.status IN ('draft', 'ready_to_dispatch', 'dispatched', 'handed_over');
  IF claimed_quantity <> 0 THEN
    RAISE EXCEPTION 'sales_fulfillment_release_blocked_by_delivery_order';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_order_fulfillment_allocations_release_guard
  ON sales.sales_order_fulfillment_allocations;
CREATE TRIGGER sales_order_fulfillment_allocations_release_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales.sales_order_fulfillment_allocations
FOR EACH ROW
WHEN (current_setting('npp.sales_fulfillment_allocation_write_context', true)
      = 'fulfillment_release_service')
EXECUTE FUNCTION sales.guard_sales_order_fulfillment_allocation_release_write();

DROP TRIGGER IF EXISTS sales_order_fulfillment_allocation_events_writer_guard
  ON sales.sales_order_fulfillment_allocation_events;
CREATE TRIGGER sales_order_fulfillment_allocation_events_writer_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales.sales_order_fulfillment_allocation_events
FOR EACH ROW
WHEN (
  current_setting('npp.sales_fulfillment_allocation_write_context', true)
    IS DISTINCT FROM 'fulfillment_reversal_service'
  AND current_setting('npp.sales_fulfillment_allocation_write_context', true)
    IS DISTINCT FROM 'fulfillment_release_service'
)
EXECUTE FUNCTION sales.guard_sales_order_fulfillment_allocation_event_write();

CREATE OR REPLACE FUNCTION sales.guard_sales_order_fulfillment_allocation_release_event_write()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('npp.sales_fulfillment_allocation_write_context', true)
       IS DISTINCT FROM 'fulfillment_release_service' THEN
    RAISE EXCEPTION 'sales_fulfillment_release_event_requires_service_context';
  END IF;
  IF TG_OP <> 'INSERT'
     OR NEW.event_type <> 'RELEASED'
     OR NEW.quantity_delta <= 0
     OR NEW.reason IS NULL
     OR btrim(NEW.reason) = '' THEN
    RAISE EXCEPTION 'sales_fulfillment_release_event_invalid';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_order_fulfillment_allocation_events_release_guard
  ON sales.sales_order_fulfillment_allocation_events;
CREATE TRIGGER sales_order_fulfillment_allocation_events_release_guard
BEFORE INSERT OR UPDATE OR DELETE ON sales.sales_order_fulfillment_allocation_events
FOR EACH ROW
WHEN (current_setting('npp.sales_fulfillment_allocation_write_context', true)
      = 'fulfillment_release_service')
EXECUTE FUNCTION sales.guard_sales_order_fulfillment_allocation_release_event_write();

-- Released allocations no longer contribute to the effective progress projection.
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
    CASE
      WHEN allocation_context = 'fulfillment_reversal_service' THEN 'fulfillment_reversal_service'
      WHEN allocation_context = 'fulfillment_release_service' THEN 'fulfillment_release_service'
      ELSE 'fulfillment_service'
    END,
    true
  );
  UPDATE sales.sales_order_fulfillment_demands demand
     SET allocated_base_quantity = totals.allocated_quantity,
         picked_base_quantity = totals.picked_quantity,
         packed_base_quantity = totals.packed_quantity,
         updated_at = now(),
         updated_by = target_actor_id
    FROM (
      SELECT COALESCE(sum(allocation.allocated_base_quantity) FILTER (WHERE allocation.state <> 'RELEASED'), 0)::numeric(30,12) AS allocated_quantity,
             COALESCE(sum(allocation.picked_base_quantity) FILTER (WHERE allocation.state <> 'RELEASED'), 0)::numeric(30,12) AS picked_quantity,
             COALESCE(sum(allocation.packed_base_quantity) FILTER (WHERE allocation.state <> 'RELEASED'), 0)::numeric(30,12) AS packed_quantity
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
