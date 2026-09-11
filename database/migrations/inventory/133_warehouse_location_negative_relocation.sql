-- Issue #942 follow-up: a warehouse mode conversion relocates the exact signed balance.
-- Negative on-hand is legacy/current business state, not a reason to block the location-mode change.
-- This guard extension is deliberately narrow: it permits a negative destination delta only when
-- the same transaction already inserted the paired source IN line for the same warehouse/SKU/lot
-- and the canonical warehouse-location-mode service supplied matching transaction-local evidence.

CREATE OR REPLACE FUNCTION inventory.guard_inventory_negative_stock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_on_hand numeric(30,12);
  current_reserved numeric(30,12);
  trusted_context jsonb := NULL;
  relocation_context jsonb := NULL;
  line_evidence jsonb := NULL;
  warehouse_allows boolean := false;
  movement_source_domain text;
  movement_type text;
  movement_source_document_type text;
  movement_source_document_id text;
  negative_quantity_text text;
  relocation_signed_quantity_text text;
  relocation_source_exists boolean := false;
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

  SELECT movement.source_domain,
         movement.movement_type,
         movement.source_document_type,
         movement.source_document_id::text
    INTO movement_source_domain,
         movement_type,
         movement_source_document_type,
         movement_source_document_id
    FROM inventory.inventory_movements movement
   WHERE movement.installation_id = NEW.installation_id
     AND movement.id = NEW.movement_id;

  -- Relocating an already-negative balance must keep the sign. This is not generic permission
  -- to create negative stock: require exact service context plus the paired source leg.
  relocation_signed_quantity_text := NEW.metadata->>'signedBaseQuantity';
  IF movement_source_domain IS NOT DISTINCT FROM 'INVENTORY'
     AND movement_type IS NOT DISTINCT FROM 'TRANSFER_RECEIPT'
     AND movement_source_document_type IS NOT DISTINCT FROM 'WAREHOUSE_LOCATION_MODE_RUN'
     AND NEW.metadata->>'transferKind' IS NOT DISTINCT FROM 'WAREHOUSE_LOCATION_MODE'
     AND NEW.metadata->>'scopeSide' IS NOT DISTINCT FROM 'DESTINATION'
     AND NEW.metadata->>'negativeRelocation' IS NOT DISTINCT FROM 'true'
     AND NEW.metadata->>'warehouseLocationModeRunId' IS NOT DISTINCT FROM movement_source_document_id
     AND NULLIF(NEW.metadata->>'inventoryTransferLineId', '') IS NOT NULL
     AND relocation_signed_quantity_text IS NOT NULL
     AND relocation_signed_quantity_text ~ '^-[0-9]+(\.[0-9]{1,12})?$'
     AND relocation_signed_quantity_text::numeric IS NOT DISTINCT FROM NEW.base_quantity_delta THEN
    BEGIN
      relocation_context := NULLIF(
        current_setting('npp.warehouse_location_mode_negative_relocation', true),
        ''
      )::jsonb;
    EXCEPTION WHEN OTHERS THEN
      relocation_context := NULL;
    END;

    IF relocation_context IS NOT NULL
       AND relocation_context->>'source' IS NOT DISTINCT FROM 'WAREHOUSE_LOCATION_MODE_SERVICE'
       AND relocation_context->>'installationId' IS NOT DISTINCT FROM NEW.installation_id
       AND relocation_context->>'warehouseId' IS NOT DISTINCT FROM NEW.warehouse_id::text
       AND relocation_context->>'runId' IS NOT DISTINCT FROM movement_source_document_id
       AND relocation_context->>'receiptMovementId' IS NOT DISTINCT FROM NEW.movement_id::text
       AND relocation_context->>'transferLineId' IS NOT DISTINCT FROM NEW.metadata->>'inventoryTransferLineId'
       AND relocation_context->>'baseVariantId' IS NOT DISTINCT FROM NEW.base_variant_id::text
       AND relocation_context->>'lotId' IS NOT DISTINCT FROM NEW.lot_id::text
       AND relocation_context->>'destinationLocationId' IS NOT DISTINCT FROM NEW.location_id::text
       AND relocation_context->>'signedBaseQuantity' IS NOT DISTINCT FROM relocation_signed_quantity_text
       AND NULLIF(relocation_context->>'issueMovementId', '') IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1
          FROM inventory.inventory_movement_lines source_line
          JOIN inventory.inventory_movements source_movement
            ON source_movement.installation_id = source_line.installation_id
           AND source_movement.id = source_line.movement_id
         WHERE source_line.installation_id = NEW.installation_id
           AND source_movement.id::text = relocation_context->>'issueMovementId'
           AND source_movement.source_domain = 'INVENTORY'
           AND source_movement.movement_type = 'TRANSFER_ISSUE'
           AND source_movement.source_document_type = 'WAREHOUSE_LOCATION_MODE_RUN'
           AND source_movement.source_document_id::text = movement_source_document_id
           AND source_line.warehouse_id = NEW.warehouse_id
           AND source_line.location_id::text IS NOT DISTINCT FROM relocation_context->>'sourceLocationId'
           AND source_line.base_variant_id = NEW.base_variant_id
           AND source_line.lot_id IS NOT DISTINCT FROM NEW.lot_id
           AND source_line.direction = 'IN'
           AND source_line.base_quantity_delta = abs(NEW.base_quantity_delta)
           AND source_line.metadata->>'transferKind' = 'WAREHOUSE_LOCATION_MODE'
           AND source_line.metadata->>'scopeSide' = 'SOURCE'
           AND source_line.metadata->>'negativeRelocation' = 'true'
           AND source_line.metadata->>'warehouseLocationModeRunId' = movement_source_document_id
           AND source_line.metadata->>'inventoryTransferLineId' = NEW.metadata->>'inventoryTransferLineId'
           AND source_line.metadata->>'signedBaseQuantity' = relocation_signed_quantity_text
      ) INTO relocation_source_exists;

      IF relocation_source_exists THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  -- Existing controlled-negative-stock contract for Sales remains unchanged and deny-by-default.
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
