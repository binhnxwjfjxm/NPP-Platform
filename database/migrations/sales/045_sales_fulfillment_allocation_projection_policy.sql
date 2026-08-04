-- Phase 6D.2 projection and exact-scope policy.
-- Multiple immutable allocations may target the same exact scope over time. The
-- reservation ID and event lineage distinguish them; a unique scope index would
-- incorrectly block later stock receipts or an intentionally partial manual plan.

DROP INDEX IF EXISTS sales.sales_order_fulfillment_allocations_scope_unique;
CREATE INDEX IF NOT EXISTS sales_order_fulfillment_allocations_scope_idx
  ON sales.sales_order_fulfillment_allocations (
    installation_id,
    fulfillment_demand_id,
    location_id,
    lot_id,
    allocation_sequence
  );

CREATE OR REPLACE FUNCTION sales.project_sales_order_fulfillment_allocation_progress()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  previous_context text := current_setting('npp.sales_fulfillment_write_context', true);
  target_demand_id uuid;
  target_order_id uuid;
  target_installation_id text;
  target_actor_id text;
  progress_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    target_demand_id := NEW.fulfillment_demand_id;
    target_order_id := NEW.sales_order_id;
    target_installation_id := NEW.installation_id;
    target_actor_id := NEW.updated_by;
  ELSE
    target_demand_id := COALESCE(NEW.fulfillment_demand_id, OLD.fulfillment_demand_id);
    target_order_id := COALESCE(NEW.sales_order_id, OLD.sales_order_id);
    target_installation_id := COALESCE(NEW.installation_id, OLD.installation_id);
    target_actor_id := COALESCE(NEW.updated_by, OLD.updated_by);
  END IF;

  PERFORM set_config('npp.sales_fulfillment_write_context', 'fulfillment_service', true);

  UPDATE sales.sales_order_fulfillment_demands demand
     SET allocated_base_quantity = totals.allocated_quantity,
         picked_base_quantity = totals.picked_quantity,
         packed_base_quantity = totals.packed_quantity,
         updated_at = now(),
         updated_by = target_actor_id
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
  END
    INTO progress_status
    FROM sales.sales_order_fulfillment_demands demand
   WHERE demand.installation_id = target_installation_id
     AND demand.sales_order_id = target_order_id
     AND demand.state = 'ACTIVE';

  UPDATE sales.sales_orders
     SET fulfillment_status = COALESCE(progress_status, fulfillment_status),
         updated_at = now(),
         updated_by = target_actor_id
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
