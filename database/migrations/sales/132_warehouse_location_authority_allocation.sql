-- Issue #942 Lô 2: Warehouse is the sole runtime authority for location management.
-- SKU tracking policy continues to own lot/expiry rules only.
-- Released allocations are immutable history and must not count against a replacement allocation.

COMMENT ON COLUMN inventory.product_tracking_policies.location_required IS
  'DEPRECATED for runtime location decisions. Warehouse location_management_mode is authoritative; keep temporarily for compatibility only.';

CREATE OR REPLACE FUNCTION sales.guard_sales_order_fulfillment_allocation_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.sales_fulfillment_allocation_write_context', true);
  demand_record sales.sales_order_fulfillment_demands;
  reservation_record inventory.inventory_reservations;
  policy_record inventory.product_tracking_policies;
  warehouse_record shared.warehouses;
  location_record shared.warehouse_locations;
  lot_record inventory.inventory_lots;
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
    IF warehouse_record.location_management_mode = 'MANAGED' AND NEW.location_id IS NULL THEN
      RAISE EXCEPTION 'sales_fulfillment_allocation_location_required';
    END IF;
    IF warehouse_record.location_management_mode = 'UNMANAGED' AND NEW.location_id IS NOT NULL THEN
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
         AND lot_record.expiry_date < CURRENT_DATE THEN
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
