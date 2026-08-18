-- Issue #622: one shared stock-hold contract for all Sales fulfillment modes.
-- A demand may intentionally target less than the ordered quantity so operators can
-- split limited stock fairly between orders. Un-targeted quantity stays free for other orders.

ALTER TABLE sales.sales_order_fulfillment_demands
  ADD COLUMN IF NOT EXISTS allocation_target_base_quantity numeric(30,12) NULL;

ALTER TABLE sales.sales_order_fulfillment_demands
  DROP CONSTRAINT IF EXISTS sales_order_fulfillment_demands_allocation_target_check,
  DROP CONSTRAINT IF EXISTS sales_order_fulfillment_demands_quantity_reconcile;

ALTER TABLE sales.sales_order_fulfillment_demands
  ADD CONSTRAINT sales_order_fulfillment_demands_allocation_target_check CHECK (
    allocation_target_base_quantity IS NULL
    OR (
      allocation_target_base_quantity > 0
      AND allocation_target_base_quantity <= ordered_base_quantity
      AND allocation_target_base_quantity >= allocated_base_quantity
    )
  ),
  ADD CONSTRAINT sales_order_fulfillment_demands_quantity_reconcile CHECK (
    COALESCE(allocation_target_base_quantity, ordered_base_quantity)
      = reserved_base_quantity + backordered_base_quantity
    AND allocated_base_quantity <= reserved_base_quantity
    AND picked_base_quantity <= allocated_base_quantity
    AND packed_base_quantity <= picked_base_quantity
    AND issued_base_quantity <= packed_base_quantity
    AND cancelled_base_quantity <= ordered_base_quantity - issued_base_quantity
  );

COMMENT ON COLUMN sales.sales_order_fulfillment_demands.allocation_target_base_quantity IS
  'Operator allocation target. NULL means the full ordered quantity. Quantity above the target is intentionally left unallocated and must not hold stock.';

-- Replace the ordinary demand guard with a narrow hold-reconciliation exception.
-- Identity, ordered quantity and execution facts remain immutable. Hold changes are
-- allowed only before pick/pack/issue and never below quantity already allocated.
CREATE OR REPLACE FUNCTION sales.guard_sales_order_fulfillment_demand_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.sales_fulfillment_write_context', true);
BEGIN
  IF write_context NOT IN ('fulfillment_service', 'delivery_issue_service', 'fulfillment_hold_service') THEN
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
