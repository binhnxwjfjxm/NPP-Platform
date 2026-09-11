-- Issue #942 Lô 2: Warehouse is the sole runtime authority for location management.
-- SKU tracking policy continues to own lot/expiry rules only.
-- Released allocations are immutable history and must not count against a replacement allocation.
-- A warehouse-mode conversion may temporarily release an allocation before its replacement is
-- inserted. The remap context keeps the demand projection stable inside that one transaction only.

COMMENT ON COLUMN inventory.product_tracking_policies.location_required IS
  'DEPRECATED for runtime location decisions. Warehouse location_management_mode is authoritative; keep temporarily for compatibility only.';

CREATE OR REPLACE FUNCTION sales.guard_sales_order_fulfillment_allocation_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.sales_fulfillment_allocation_write_context', true);
  remap_run_id text := current_setting('npp.warehouse_location_mode_remap', true);
  demand_record sales.sales_order_fulfillment_demands;
  reservation_record inventory.inventory_reservations;
  policy_record inventory.product_tracking_policies;
  warehouse_record shared.warehouses;
  location_record shared.warehouse_locations;
  lot_record inventory.inventory_lots;
  allocated_total numeric(30,12);
  remap_allowed boolean := false;
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

    SELECT * INTO reservation_record
      FROM inventory.inventory_reservations
     WHERE installation_id = NEW.installation_id
       AND id = NEW.inventory_reservation_id;

    remap_allowed := COALESCE(remap_run_id, '') <> ''
      AND reservation_record IS NOT NULL
      AND reservation_record.source_domain = 'SALES'
      AND reservation_record.source_document_type = 'SALES_FULFILLMENT_ALLOCATION'
      AND reservation_record.source_document_id IS NOT DISTINCT FROM NEW.id::text
      AND reservation_record.metadata->>'warehouseLocationModeRunId' = remap_run_id
      AND COALESCE(reservation_record.metadata->>'relocatedFromReservationId', '') <> ''
      AND COALESCE(reservation_record.metadata->>'relocatedFromAllocationId', '') <> '';

    SELECT * INTO warehouse_record
      FROM shared.warehouses
     WHERE installation_id = NEW.installation_id
       AND id = NEW.warehouse_id
       AND is_active = true;

    IF warehouse_record IS NULL THEN
      RAISE EXCEPTION 'sales_fulfillment_allocation_warehouse_not_available';
    END IF;
    IF warehouse_record.location_management_mode IS NULL THEN
      RAISE EXCEPTION 'sales_fulfillment_warehouse_location_mode_required';
    END IF;
    IF warehouse_record.location_management_mode = 'MANAGED'
       AND NEW.location_id IS NULL
       AND NOT remap_allowed THEN
      RAISE EXCEPTION 'sales_fulfillment_allocation_location_required';
    END IF;
    IF warehouse_record.location_management_mode = 'UNMANAGED'
       AND NEW.location_id IS NOT NULL
       AND NOT remap_allowed THEN
      RAISE EXCEPTION 'sales_fulfillment_allocation_location_not_allowed';
    END IF;

    IF NEW.location_id IS NOT NULL THEN
      SELECT * INTO location_record
        FROM shared.warehouse_locations
       WHERE installation_id = NEW.installation_id
         AND warehouse_id = NEW.warehouse_id
         AND id = NEW.location_id;

      IF NOT FOUND
         OR location_record.is_active IS DISTINCT FROM true
         OR location_record.location_type <> 'storage' THEN
        RAISE EXCEPTION 'sales_fulfillment_allocation_requires_active_storage_location';
      END IF;
    END IF;

    SELECT * INTO policy_record
      FROM inventory.product_tracking_policies
     WHERE installation_id = NEW.installation_id
       AND base_variant_id = NEW.base_variant_id;

    IF COALESCE(policy_record.lot_tracking_mode, 'NONE') = 'REQUIRED'
       AND NEW.lot_id IS NULL THEN
      RAISE EXCEPTION 'sales_fulfillment_allocation_lot_required';
    END IF;

    IF NEW.lot_id IS NOT NULL THEN
      SELECT * INTO lot_record
        FROM inventory.inventory_lots
       WHERE installation_id = NEW.installation_id
         AND id = NEW.lot_id;

      IF NOT FOUND
         OR lot_record.base_variant_id IS DISTINCT FROM NEW.base_variant_id THEN
        RAISE EXCEPTION 'sales_fulfillment_allocation_lot_variant_mismatch';
      END IF;

      IF lot_record.expiry_date IS NOT NULL
         AND lot_record.expiry_date < CURRENT_DATE
         AND NOT remap_allowed THEN
        RAISE EXCEPTION 'sales_fulfillment_allocation_expired_lot_forbidden';
      END IF;

      IF COALESCE(policy_record.expiry_tracking_mode, 'NONE') = 'REQUIRED'
         AND lot_record.expiry_date IS NULL THEN
        RAISE EXCEPTION 'sales_fulfillment_allocation_expiry_required';
      END IF;
    END IF;

    SELECT COALESCE(sum(allocation.allocated_base_quantity), 0)
      INTO allocated_total
      FROM sales.sales_order_fulfillment_allocations allocation
     WHERE allocation.installation_id = NEW.installation_id
       AND allocation.fulfillment_demand_id = NEW.fulfillment_demand_id
       AND allocation.state <> 'RELEASED';

    IF allocated_total + NEW.allocated_base_quantity > demand_record.reserved_base_quantity THEN
      RAISE EXCEPTION 'sales_fulfillment_allocation_exceeds_reserved_demand';
    END IF;

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
     OR NEW.operation_idempotency_key IS DISTINCT FROM OLD.operation_idempotency_key
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

-- During warehouse-mode remap, the old exact reservation/allocation is released before the
-- replacement reservation is created at the new scope. Keep the demand projection stable for
-- that release only; the following replacement allocation insert recomputes it normally.
CREATE OR REPLACE FUNCTION sales.project_sales_order_fulfillment_allocation_progress()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous_context text := current_setting('npp.sales_fulfillment_write_context', true);
  allocation_context text := current_setting('npp.sales_fulfillment_allocation_write_context', true);
  remap_run_id text := current_setting('npp.warehouse_location_mode_remap', true);
  target_demand_id uuid;
  target_order_id uuid;
  target_installation_id text;
  target_actor_id text;
  progress_status text;
BEGIN
  IF allocation_context = 'fulfillment_release_service'
     AND COALESCE(remap_run_id, '') <> '' THEN
    RETURN NEW;
  END IF;

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
