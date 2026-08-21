-- Issue #675: close-execution after partial fulfillment must release only the stock
-- that was never issued, without weakening the pre-execution edit/cancel guards.

-- The ordinary release path remains blocked once a demand has issued quantity.
-- close-execution opts into one transaction-local flag after delivery/reconciliation
-- facts have already passed the service-level close gate.
CREATE OR REPLACE FUNCTION sales.guard_sales_order_fulfillment_allocation_release_write()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  demand_issued numeric(30,12);
  reservation_state text;
  claimed_quantity numeric(30,12);
  execution_close_release boolean :=
    current_setting('npp.sales_execution_close_release', true) = 'true';
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
  IF NOT FOUND OR (demand_issued <> 0 AND NOT execution_close_release) THEN
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

-- Partial inventory issue already removes consumed quantity from reserved_quantity.
-- A later RELEASE event must therefore remove only the still-reserved remainder.
CREATE OR REPLACE FUNCTION inventory.sync_reservation_to_balance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  reservation_record inventory.inventory_reservations;
  previous_context text := current_setting('npp.inventory_balance_write_context', true);
  remaining_reserved numeric(30,12);
  affected_rows integer;
BEGIN
  SELECT * INTO reservation_record
    FROM inventory.inventory_reservations
   WHERE installation_id = NEW.installation_id
     AND id = NEW.reservation_id;

  IF reservation_record IS NULL THEN
    RAISE EXCEPTION 'inventory_reservation_missing_for_sync';
  END IF;

  PERFORM set_config('npp.inventory_balance_write_context', 'reservation', true);

  IF NEW.transition = 'CREATE_ACTIVE' THEN
    IF reservation_record.state <> 'ACTIVE' THEN
      RAISE EXCEPTION 'inventory_reservation_event_state_mismatch';
    END IF;

    INSERT INTO inventory.inventory_balances (
      installation_id,
      warehouse_id,
      location_id,
      base_variant_id,
      lot_id,
      on_hand_quantity,
      reserved_quantity,
      projected_through,
      updated_at
    ) VALUES (
      NEW.installation_id,
      reservation_record.warehouse_id,
      reservation_record.location_id,
      reservation_record.base_variant_id,
      reservation_record.lot_id,
      0,
      reservation_record.quantity,
      now(),
      now()
    )
    ON CONFLICT (
      installation_id,
      warehouse_id,
      location_id,
      base_variant_id,
      lot_id
    ) DO UPDATE
    SET reserved_quantity = inventory.inventory_balances.reserved_quantity
                            + EXCLUDED.reserved_quantity,
        updated_at = now();
  ELSE
    IF (NEW.transition = 'RELEASE_TO_RELEASED' AND reservation_record.state <> 'RELEASED')
       OR (NEW.transition = 'CONSUME_TO_CONSUMED' AND reservation_record.state <> 'CONSUMED')
       OR (NEW.transition = 'EXPIRE_TO_EXPIRED' AND reservation_record.state <> 'EXPIRED')
       OR (NEW.transition = 'CANCEL_TO_CANCELLED' AND reservation_record.state <> 'CANCELLED') THEN
      RAISE EXCEPTION 'inventory_reservation_event_state_mismatch';
    END IF;

    IF NEW.transition NOT IN (
      'RELEASE_TO_RELEASED',
      'CONSUME_TO_CONSUMED',
      'EXPIRE_TO_EXPIRED',
      'CANCEL_TO_CANCELLED'
    ) THEN
      RAISE EXCEPTION 'inventory_reservation_transition_not_supported';
    END IF;

    remaining_reserved := reservation_record.quantity
                          - COALESCE(reservation_record.consumed_quantity, 0);
    IF remaining_reserved < 0 THEN
      RAISE EXCEPTION 'inventory_reservation_consumed_quantity_invalid';
    END IF;

    UPDATE inventory.inventory_balances
       SET reserved_quantity = reserved_quantity - remaining_reserved,
           updated_at = now()
     WHERE installation_id = NEW.installation_id
       AND warehouse_id = reservation_record.warehouse_id
       AND location_id IS NOT DISTINCT FROM reservation_record.location_id
       AND base_variant_id = reservation_record.base_variant_id
       AND lot_id IS NOT DISTINCT FROM reservation_record.lot_id
       AND reserved_quantity >= remaining_reserved;

    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 1 THEN
      RAISE EXCEPTION 'inventory_reservation_balance_mismatch';
    END IF;
  END IF;

  PERFORM set_config(
    'npp.inventory_balance_write_context',
    COALESCE(previous_context, ''),
    true
  );
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config(
      'npp.inventory_balance_write_context',
      COALESCE(previous_context, ''),
      true
    );
    RAISE;
END;
$$;

-- A completed allocation is immutable packing history. During execution close its
-- exact reservation may be CONSUMED (all issued) or RELEASED (unissued remainder
-- explicitly returned to availability). Both are safe terminal evidence.
CREATE OR REPLACE FUNCTION sales.guard_allocated_fulfillment_demand_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.state = 'ACTIVE'
     AND NEW.state IS DISTINCT FROM OLD.state THEN
    IF NEW.state = 'CANCELLED' THEN
      IF EXISTS (
        SELECT 1
          FROM sales.sales_order_fulfillment_allocations allocation
          JOIN inventory.inventory_reservations reservation
            ON reservation.installation_id = allocation.installation_id
           AND reservation.id = allocation.inventory_reservation_id
         WHERE allocation.installation_id = OLD.installation_id
           AND allocation.fulfillment_demand_id = OLD.id
           AND (
             allocation.state = 'ACTIVE'
             OR (
               allocation.state = 'COMPLETED'
               AND reservation.state NOT IN ('CONSUMED', 'RELEASED')
             )
             OR allocation.state NOT IN ('ACTIVE', 'COMPLETED', 'RELEASED')
           )
      ) THEN
        RAISE EXCEPTION 'sales_fulfillment_transition_blocked_by_allocation';
      END IF;
    ELSIF EXISTS (
      SELECT 1
        FROM sales.sales_order_fulfillment_allocations allocation
       WHERE allocation.installation_id = OLD.installation_id
         AND allocation.fulfillment_demand_id = OLD.id
         AND allocation.state <> 'RELEASED'
    ) THEN
      RAISE EXCEPTION 'sales_fulfillment_transition_blocked_by_allocation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
