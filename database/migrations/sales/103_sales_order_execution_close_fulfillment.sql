-- Fix close-execution after an order has real fulfillment history.
-- A completed allocation is immutable evidence and may remain linked to the demand.
-- Closing the unexecuted remainder may terminalize that demand only after every
-- remaining allocation is either released or fully consumed by Inventory OUT.

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
               AND reservation.state IS DISTINCT FROM 'CONSUMED'
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
