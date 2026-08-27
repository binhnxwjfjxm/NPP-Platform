-- Issue #791 Lô 7: controlled negative stock.
-- Default deny is preserved. A warehouse policy AND an actor capability are required.
-- Quantity remains append-only through Inventory Ledger; this migration only extends policy,
-- fulfillment projection, and the database backstops used by canonical movement posting/reversal.

ALTER TABLE shared.warehouses
  ADD COLUMN IF NOT EXISTS allow_negative_stock boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN shared.warehouses.allow_negative_stock IS
  'Cho phép xuất vượt tồn khả dụng tại kho này. Mặc định tắt; người thao tác vẫn phải có quyền riêng.';

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES (
  'core.inventory.negative-stock.issue',
  'Kho',
  'Xuất vượt tồn khả dụng',
  'Cho phép xuất hàng vượt tồn khả dụng tại kho đã bật chính sách tương ứng. Hệ thống vẫn kiểm tra phạm vi kho và điều kiện nghiệp vụ.',
  true,
  now()
)
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

ALTER TABLE sales.sales_order_fulfillment_demands
  ADD COLUMN IF NOT EXISTS negative_issued_base_quantity numeric(30,12) NOT NULL DEFAULT 0
    CHECK (negative_issued_base_quantity >= 0);

ALTER TABLE sales.sales_order_fulfillment_demands
  DROP CONSTRAINT IF EXISTS sales_order_fulfillment_demands_quantity_reconcile;

ALTER TABLE sales.sales_order_fulfillment_demands
  ADD CONSTRAINT sales_order_fulfillment_demands_quantity_reconcile CHECK (
    COALESCE(allocation_target_base_quantity, ordered_base_quantity)
      = reserved_base_quantity + backordered_base_quantity
    AND allocated_base_quantity <= reserved_base_quantity
    AND picked_base_quantity <= allocated_base_quantity
    AND packed_base_quantity <= picked_base_quantity
    AND issued_base_quantity <= packed_base_quantity
    AND negative_issued_base_quantity <= backordered_base_quantity
    AND issued_base_quantity + negative_issued_base_quantity <= ordered_base_quantity
    AND cancelled_base_quantity <= ordered_base_quantity - issued_base_quantity - negative_issued_base_quantity
  );

COMMENT ON COLUMN sales.sales_order_fulfillment_demands.negative_issued_base_quantity IS
  'Số lượng đã xuất có kiểm soát vượt phần giữ hàng thực tế. Không làm thay đổi reserved/backordered history.';

-- Preserve the latest fulfillment guard contract and extend it narrowly for the explicit
-- negative-issued projection. Only the canonical reversal projector may decrease that field.
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
       'fulfillment_release_service',
       'negative_stock_issue_service',
       'negative_stock_reversal_projector'
     ) THEN
    RAISE EXCEPTION 'sales_fulfillment_demand_write_requires_service_context';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'sales_fulfillment_demands_cannot_be_deleted';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'ACTIVE' OR NEW.negative_issued_base_quantity <> 0 THEN
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
       OR NEW.negative_issued_base_quantity IS DISTINCT FROM OLD.negative_issued_base_quantity
       OR NEW.cancelled_base_quantity IS DISTINCT FROM OLD.cancelled_base_quantity
       OR NEW.state IS DISTINCT FROM OLD.state
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'sales_fulfillment_hold_service_may_change_hold_only';
    END IF;
    IF OLD.picked_base_quantity <> 0
       OR OLD.packed_base_quantity <> 0
       OR OLD.issued_base_quantity <> 0
       OR OLD.negative_issued_base_quantity <> 0 THEN
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
       OR OLD.negative_issued_base_quantity <> 0
       OR NEW.picked_base_quantity <> 0
       OR NEW.packed_base_quantity <> 0
       OR NEW.issued_base_quantity <> 0
       OR NEW.negative_issued_base_quantity <> 0 THEN
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
       OR NEW.negative_issued_base_quantity IS DISTINCT FROM OLD.negative_issued_base_quantity
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

  IF write_context = 'negative_stock_issue_service' THEN
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
       OR NEW.allocated_base_quantity IS DISTINCT FROM OLD.allocated_base_quantity
       OR NEW.cancelled_base_quantity IS DISTINCT FROM OLD.cancelled_base_quantity
       OR NEW.state IS DISTINCT FROM OLD.state
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.picked_base_quantity IS DISTINCT FROM NEW.reserved_base_quantity
       OR NEW.packed_base_quantity IS DISTINCT FROM NEW.reserved_base_quantity
       OR NEW.issued_base_quantity IS DISTINCT FROM NEW.reserved_base_quantity
       OR NEW.negative_issued_base_quantity IS DISTINCT FROM NEW.backordered_base_quantity
       OR NEW.picked_base_quantity < OLD.picked_base_quantity
       OR NEW.packed_base_quantity < OLD.packed_base_quantity
       OR NEW.issued_base_quantity < OLD.issued_base_quantity
       OR NEW.negative_issued_base_quantity < OLD.negative_issued_base_quantity THEN
      RAISE EXCEPTION 'sales_negative_stock_issue_projection_invalid';
    END IF;
    RETURN NEW;
  END IF;

  IF write_context = 'negative_stock_reversal_projector' THEN
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
       OR NEW.allocated_base_quantity IS DISTINCT FROM OLD.allocated_base_quantity
       OR NEW.picked_base_quantity IS DISTINCT FROM OLD.picked_base_quantity
       OR NEW.packed_base_quantity IS DISTINCT FROM OLD.packed_base_quantity
       OR NEW.issued_base_quantity IS DISTINCT FROM OLD.issued_base_quantity
       OR NEW.cancelled_base_quantity IS DISTINCT FROM OLD.cancelled_base_quantity
       OR NEW.state IS DISTINCT FROM OLD.state
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.negative_issued_base_quantity < 0
       OR NEW.negative_issued_base_quantity > OLD.negative_issued_base_quantity THEN
      RAISE EXCEPTION 'sales_negative_stock_reversal_projection_invalid';
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
     OR NEW.negative_issued_base_quantity IS DISTINCT FROM OLD.negative_issued_base_quantity
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'sales_fulfillment_demand_immutable_fields_cannot_change';
  END IF;

  IF write_context = 'delivery_issue_service' THEN
    IF NEW.allocated_base_quantity IS DISTINCT FROM OLD.allocated_base_quantity
       OR NEW.picked_base_quantity IS DISTINCT FROM OLD.picked_base_quantity
       OR NEW.packed_base_quantity IS DISTINCT FROM OLD.packed_base_quantity
       OR NEW.negative_issued_base_quantity IS DISTINCT FROM OLD.negative_issued_base_quantity
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
     OR NEW.negative_issued_base_quantity < OLD.negative_issued_base_quantity
     OR NEW.cancelled_base_quantity < OLD.cancelled_base_quantity THEN
    RAISE EXCEPTION 'sales_fulfillment_progress_cannot_decrease';
  END IF;

  IF NEW.state NOT IN ('ACTIVE', 'SUPERSEDED', 'CANCELLED', 'COMPLETED') THEN
    RAISE EXCEPTION 'sales_fulfillment_demand_invalid_state_transition';
  END IF;

  RETURN NEW;
END;
$$;

-- Keep the exact lot/location balance guard deny-by-default. The bypass is accepted only
-- for a canonical SALES_DELIVERY_ISSUE line that carries BOTH immutable line evidence and
-- a transaction-local server context matching the movement, installation and warehouse.
CREATE OR REPLACE FUNCTION inventory.guard_inventory_negative_stock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_on_hand numeric(30,12);
  current_reserved numeric(30,12);
  trusted_context jsonb := NULL;
  line_evidence jsonb := NULL;
  warehouse_allows boolean := false;
  movement_source_domain text;
  movement_type text;
  negative_quantity_text text;
BEGIN
  IF NEW.base_quantity_delta >= 0 THEN
    RETURN NEW;
  END IF;

  SELECT balance.on_hand_quantity, balance.reserved_quantity
    INTO current_on_hand, current_reserved
    FROM inventory.inventory_balances balance
   WHERE balance.installation_id = NEW.installation_id
     AND balance.warehouse_id = NEW.warehouse_id
     AND balance.location_id IS NOT DISTINCT FROM NEW.location_id
     AND balance.base_variant_id = NEW.base_variant_id
     AND balance.lot_id IS NOT DISTINCT FROM NEW.lot_id
   FOR UPDATE;

  IF FOUND AND current_on_hand + NEW.base_quantity_delta >= current_reserved THEN
    RETURN NEW;
  END IF;

  BEGIN
    trusted_context := NULLIF(current_setting('npp.inventory_negative_stock_context', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    trusted_context := NULL;
  END;

  line_evidence := NEW.metadata->'negativeStockAuthorization';
  negative_quantity_text := NEW.metadata->>'negativeStockQuantity';

  SELECT warehouse.allow_negative_stock
    INTO warehouse_allows
    FROM shared.warehouses warehouse
   WHERE warehouse.installation_id = NEW.installation_id
     AND warehouse.id = NEW.warehouse_id
     AND warehouse.is_active = true;

  SELECT movement.source_domain, movement.movement_type
    INTO movement_source_domain, movement_type
    FROM inventory.inventory_movements movement
   WHERE movement.installation_id = NEW.installation_id
     AND movement.id = NEW.movement_id;

  IF trusted_context IS NULL
     OR line_evidence IS NULL
     OR COALESCE(warehouse_allows, false) IS DISTINCT FROM true
     OR NEW.metadata->>'negativeStock' IS DISTINCT FROM 'true'
     OR negative_quantity_text IS NULL
     OR negative_quantity_text !~ '^(0|[1-9][0-9]{0,17})(\.[0-9]{1,12})?$'
     OR negative_quantity_text::numeric IS DISTINCT FROM abs(NEW.base_quantity_delta)
     OR line_evidence->>'source' IS DISTINCT FROM 'SERVER_POLICY'
     OR line_evidence->>'decision' IS DISTINCT FROM 'ALLOW'
     OR line_evidence->>'permissionKey' IS DISTINCT FROM 'core.inventory.negative-stock.issue'
     OR line_evidence->>'warehouseId' IS DISTINCT FROM NEW.warehouse_id::text
     OR trusted_context->>'source' IS DISTINCT FROM line_evidence->>'source'
     OR trusted_context->>'decision' IS DISTINCT FROM line_evidence->>'decision'
     OR trusted_context->>'permissionKey' IS DISTINCT FROM line_evidence->>'permissionKey'
     OR trusted_context->>'installationId' IS DISTINCT FROM NEW.installation_id
     OR trusted_context->>'warehouseId' IS DISTINCT FROM NEW.warehouse_id::text
     OR trusted_context->>'movementId' IS DISTINCT FROM NEW.movement_id::text
     OR movement_source_domain IS DISTINCT FROM 'SALES'
     OR movement_type IS DISTINCT FROM 'SALES_DELIVERY_ISSUE' THEN
    RAISE EXCEPTION 'inventory_negative_stock_denied';
  END IF;

  RETURN NEW;
END;
$$;

-- Canonical Inventory reversal copies original line metadata and points to the original
-- movement. Project the negative-issued quantity back from that immutable lineage instead
-- of mutating it from a browser or a special-case sales cancellation path.
CREATE OR REPLACE FUNCTION sales.project_negative_stock_reversal_from_inventory_line()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  reversal_movement inventory.inventory_movements;
  original_line inventory.inventory_movement_lines;
  evidence jsonb;
  demand_id uuid;
  original_line_id uuid;
  negative_quantity numeric(30,12);
  negative_quantity_text text;
  previous_context text;
  updated_count integer;
BEGIN
  IF NEW.direction <> 'IN' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO reversal_movement
    FROM inventory.inventory_movements movement
   WHERE movement.installation_id = NEW.installation_id
     AND movement.id = NEW.movement_id;

  IF NOT FOUND OR reversal_movement.reversal_of_movement_id IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    original_line_id := NULLIF(NEW.metadata->>'reversedFromLineId', '')::uuid;
    demand_id := NULLIF(NEW.metadata->>'fulfillmentDemandId', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
  END;

  IF original_line_id IS NULL OR demand_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO original_line
    FROM inventory.inventory_movement_lines line
   WHERE line.installation_id = NEW.installation_id
     AND line.movement_id = reversal_movement.reversal_of_movement_id
     AND line.id = original_line_id;

  IF NOT FOUND OR original_line.direction <> 'OUT' THEN
    RETURN NEW;
  END IF;

  evidence := original_line.metadata->'negativeStockAuthorization';
  negative_quantity_text := original_line.metadata->>'negativeStockQuantity';
  IF evidence IS NULL
     OR original_line.metadata->>'negativeStock' IS DISTINCT FROM 'true'
     OR evidence->>'source' IS DISTINCT FROM 'SERVER_POLICY'
     OR evidence->>'decision' IS DISTINCT FROM 'ALLOW'
     OR evidence->>'permissionKey' IS DISTINCT FROM 'core.inventory.negative-stock.issue'
     OR evidence->>'warehouseId' IS DISTINCT FROM original_line.warehouse_id::text
     OR negative_quantity_text IS NULL
     OR negative_quantity_text !~ '^(0|[1-9][0-9]{0,17})(\.[0-9]{1,12})?$' THEN
    RETURN NEW;
  END IF;

  negative_quantity := negative_quantity_text::numeric;
  IF negative_quantity <= 0 OR negative_quantity > abs(original_line.base_quantity_delta) THEN
    RAISE EXCEPTION 'sales_negative_stock_reversal_lineage_invalid';
  END IF;

  previous_context := COALESCE(current_setting('npp.sales_fulfillment_write_context', true), '');
  PERFORM set_config('npp.sales_fulfillment_write_context', 'negative_stock_reversal_projector', true);
  BEGIN
    UPDATE sales.sales_order_fulfillment_demands demand
       SET negative_issued_base_quantity = greatest(demand.negative_issued_base_quantity - negative_quantity, 0),
           updated_at = reversal_movement.posted_at,
           updated_by = reversal_movement.posted_by
     WHERE demand.installation_id = NEW.installation_id
       AND demand.id = demand_id
       AND demand.warehouse_id = original_line.warehouse_id
       AND demand.base_variant_id = original_line.base_variant_id
       AND demand.negative_issued_base_quantity >= negative_quantity;
    GET DIAGNOSTICS updated_count = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('npp.sales_fulfillment_write_context', previous_context, true);
    RAISE;
  END;
  PERFORM set_config('npp.sales_fulfillment_write_context', previous_context, true);

  IF updated_count <> 1 THEN
    RAISE EXCEPTION 'sales_negative_stock_reversal_projection_missing';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_movement_lines_negative_stock_reversal_projection
  ON inventory.inventory_movement_lines;
CREATE TRIGGER inventory_movement_lines_negative_stock_reversal_projection
AFTER INSERT ON inventory.inventory_movement_lines
FOR EACH ROW EXECUTE FUNCTION sales.project_negative_stock_reversal_from_inventory_line();
