-- Allow governed manual reductions against legacy inventory balances that have no warehouse location.
-- The ledger and inventory_scope_versions already support location_id = NULL; this migration aligns
-- inventory-adjustment documents with that existing scope without permitting new unassigned stock.

ALTER TABLE inventory.inventory_adjustment_lines
  ALTER COLUMN source_location_id DROP NOT NULL;

ALTER TABLE inventory.inventory_adjustment_posted_scopes
  ALTER COLUMN location_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION inventory.guard_inventory_adjustment_line()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  header_kind text;
  header_direction text;
  header_status text;
  source_purpose text;
  destination_purpose text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'inventory_adjustment_line_history_is_append_only';
  END IF;

  SELECT document_kind, adjustment_direction, status
    INTO header_kind, header_direction, header_status
    FROM inventory.inventory_adjustments
   WHERE installation_id = NEW.installation_id
     AND id = NEW.adjustment_id;
  IF header_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'inventory_adjustment_lines_locked';
  END IF;

  IF NEW.source_location_id IS NULL THEN
    IF header_kind <> 'MANUAL_ADJUSTMENT' OR header_direction <> 'OUT' THEN
      RAISE EXCEPTION 'inventory_adjustment_source_location_required';
    END IF;
  ELSE
    SELECT location_type INTO source_purpose
      FROM shared.warehouse_locations
     WHERE installation_id = NEW.installation_id
       AND warehouse_id = NEW.warehouse_id
       AND id = NEW.source_location_id
       AND is_active = true;
    IF source_purpose IS NULL THEN
      RAISE EXCEPTION 'inventory_adjustment_source_location_not_available';
    END IF;
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
    IF destination_purpose <> 'quarantine' OR NEW.source_location_id = NEW.destination_location_id THEN
      RAISE EXCEPTION 'inventory_adjustment_quarantine_destination_invalid';
    END IF;
  ELSIF header_kind = 'DAMAGED_TRANSFER' THEN
    IF destination_purpose <> 'damaged' OR NEW.source_location_id = NEW.destination_location_id THEN
      RAISE EXCEPTION 'inventory_adjustment_damaged_destination_invalid';
    END IF;
  ELSIF NEW.destination_location_id IS NOT NULL THEN
    RAISE EXCEPTION 'inventory_adjustment_destination_not_allowed';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION inventory.guard_inventory_adjustment_posted_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  line_row inventory.inventory_adjustment_lines%ROWTYPE;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'inventory_adjustment_posted_scope_is_append_only';
  END IF;

  SELECT * INTO line_row
    FROM inventory.inventory_adjustment_lines
   WHERE installation_id = NEW.installation_id
     AND adjustment_id = NEW.adjustment_id
     AND id = NEW.adjustment_line_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory_adjustment_posted_scope_lineage_invalid';
  END IF;

  IF NEW.warehouse_id <> line_row.warehouse_id
     OR NEW.base_variant_id <> line_row.base_variant_id
     OR NEW.lot_id IS DISTINCT FROM line_row.lot_id
     OR (NEW.scope_side = 'SOURCE' AND NEW.location_id IS DISTINCT FROM line_row.source_location_id)
     OR (NEW.scope_side = 'DESTINATION'
         AND (line_row.destination_location_id IS NULL
              OR NEW.location_id IS DISTINCT FROM line_row.destination_location_id)) THEN
    RAISE EXCEPTION 'inventory_adjustment_posted_scope_lineage_invalid';
  END IF;

  RETURN NEW;
END;
$$;
