-- Align inventory-adjustment database guards with warehouse-owned location management.
-- UNMANAGED warehouses use common stock (location_id = NULL) for both increases and reductions.
-- MANAGED warehouses require an explicit active source location.

CREATE OR REPLACE FUNCTION inventory.guard_inventory_adjustment_line()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  header_kind text;
  header_direction text;
  header_status text;
  header_warehouse_id uuid;
  warehouse_location_mode text;
  source_purpose text;
  destination_purpose text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'inventory_adjustment_line_history_is_append_only';
  END IF;

  SELECT adjustment.document_kind,
         adjustment.adjustment_direction,
         adjustment.status,
         adjustment.warehouse_id,
         warehouse.location_management_mode
    INTO header_kind,
         header_direction,
         header_status,
         header_warehouse_id,
         warehouse_location_mode
    FROM inventory.inventory_adjustments adjustment
    JOIN shared.warehouses warehouse
      ON warehouse.installation_id = adjustment.installation_id
     AND warehouse.id = adjustment.warehouse_id
   WHERE adjustment.installation_id = NEW.installation_id
     AND adjustment.id = NEW.adjustment_id;

  IF header_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'inventory_adjustment_lines_locked';
  END IF;

  IF header_warehouse_id IS DISTINCT FROM NEW.warehouse_id THEN
    RAISE EXCEPTION 'inventory_adjustment_warehouse_mismatch';
  END IF;

  IF warehouse_location_mode IS NULL
     OR warehouse_location_mode NOT IN ('MANAGED', 'UNMANAGED') THEN
    RAISE EXCEPTION 'inventory_adjustment_warehouse_location_mode_required';
  END IF;

  IF warehouse_location_mode = 'UNMANAGED' THEN
    IF header_kind IN ('QUARANTINE_TRANSFER', 'DAMAGED_TRANSFER') THEN
      RAISE EXCEPTION 'inventory_adjustment_warehouse_location_management_required';
    END IF;

    IF NEW.source_location_id IS NOT NULL
       OR NEW.destination_location_id IS NOT NULL THEN
      RAISE EXCEPTION 'inventory_adjustment_location_not_allowed';
    END IF;
  ELSE
    IF NEW.source_location_id IS NULL THEN
      RAISE EXCEPTION 'inventory_adjustment_source_location_required';
    END IF;

    SELECT location_type INTO source_purpose
      FROM shared.warehouse_locations
     WHERE installation_id = NEW.installation_id
       AND warehouse_id = NEW.warehouse_id
       AND id = NEW.source_location_id
       AND is_active = true;
    IF source_purpose IS NULL THEN
      RAISE EXCEPTION 'inventory_adjustment_source_location_not_available';
    END IF;

    IF NEW.destination_location_id IS NOT NULL THEN
      SELECT location_type INTO destination_purpose
        FROM shared.warehouse_locations
       WHERE installation_id = NEW.installation_id
         AND warehouse_id = NEW.warehouse_id
         AND id = NEW.destination_location_id
         AND is_active = true;
    END IF;

    IF header_kind = 'QUARANTINE_TRANSFER' THEN
      IF destination_purpose IS DISTINCT FROM 'quarantine'
         OR NEW.source_location_id IS NOT DISTINCT FROM NEW.destination_location_id THEN
        RAISE EXCEPTION 'inventory_adjustment_quarantine_destination_invalid';
      END IF;
    ELSIF header_kind = 'DAMAGED_TRANSFER' THEN
      IF destination_purpose IS DISTINCT FROM 'damaged'
         OR NEW.source_location_id IS NOT DISTINCT FROM NEW.destination_location_id THEN
        RAISE EXCEPTION 'inventory_adjustment_damaged_destination_invalid';
      END IF;
    ELSIF NEW.destination_location_id IS NOT NULL THEN
      RAISE EXCEPTION 'inventory_adjustment_destination_not_allowed';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
