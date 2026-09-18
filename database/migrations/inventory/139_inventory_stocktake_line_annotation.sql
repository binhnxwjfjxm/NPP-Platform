-- Issue #1099 Lô 3: allow controlled reason/note annotation after blind count is complete.

CREATE OR REPLACE FUNCTION inventory.guard_stocktake_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  header_status text;
  current_round_number integer;
  write_context text := current_setting('npp.stocktake_write_context', true);
BEGIN
  SELECT status, current_round
    INTO header_status, current_round_number
    FROM inventory.stocktakes
   WHERE installation_id = OLD.installation_id
     AND id = OLD.stocktake_id;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stocktake_history_is_append_only';
  END IF;

  IF OLD.installation_id <> NEW.installation_id
     OR OLD.stocktake_id <> NEW.stocktake_id
     OR OLD.round_id <> NEW.round_id
     OR OLD.round_number <> NEW.round_number
     OR OLD.line_number <> NEW.line_number
     OR OLD.expected_base_quantity <> NEW.expected_base_quantity
     OR OLD.snapshot_scope_version <> NEW.snapshot_scope_version
     OR OLD.warehouse_id <> NEW.warehouse_id
     OR OLD.location_id IS DISTINCT FROM NEW.location_id
     OR OLD.source_variant_id <> NEW.source_variant_id
     OR OLD.source_sku <> NEW.source_sku
     OR OLD.source_unit_id <> NEW.source_unit_id
     OR OLD.source_unit_code <> NEW.source_unit_code
     OR OLD.conversion_to_base <> NEW.conversion_to_base
     OR OLD.base_variant_id <> NEW.base_variant_id
     OR OLD.base_sku <> NEW.base_sku
     OR OLD.lot_id IS DISTINCT FROM NEW.lot_id
     OR OLD.lot_code IS DISTINCT FROM NEW.lot_code
     OR OLD.expiry_date IS DISTINCT FROM NEW.expiry_date THEN
    RAISE EXCEPTION 'stocktake_snapshot_is_immutable';
  END IF;

  IF header_status = 'approved'
     AND write_context = 'posting'
     AND OLD.round_number = current_round_number THEN
    IF OLD.counted_base_quantity IS DISTINCT FROM NEW.counted_base_quantity
       OR OLD.counted_at IS DISTINCT FROM NEW.counted_at
       OR OLD.counted_by IS DISTINCT FROM NEW.counted_by
       OR OLD.count_reason IS DISTINCT FROM NEW.count_reason
       OR OLD.count_note IS DISTINCT FROM NEW.count_note
       OR OLD.final_delta IS NOT NULL
       OR OLD.posted_scope_version IS NOT NULL
       OR NEW.final_delta IS NULL
       OR NEW.posted_scope_version IS NULL THEN
      RAISE EXCEPTION 'stocktake_posting_update_invalid';
    END IF;
    RETURN NEW;
  END IF;

  IF header_status IN ('submitted', 'approved')
     AND write_context = 'annotation'
     AND OLD.round_number = current_round_number THEN
    IF OLD.counted_base_quantity IS DISTINCT FROM NEW.counted_base_quantity
       OR OLD.counted_at IS DISTINCT FROM NEW.counted_at
       OR OLD.counted_by IS DISTINCT FROM NEW.counted_by
       OR OLD.final_delta IS DISTINCT FROM NEW.final_delta
       OR OLD.posted_scope_version IS DISTINCT FROM NEW.posted_scope_version THEN
      RAISE EXCEPTION 'stocktake_annotation_update_invalid';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.round_number <> current_round_number
     OR header_status NOT IN ('draft', 'recount_required') THEN
    RAISE EXCEPTION 'stocktake_round_is_locked';
  END IF;

  IF OLD.final_delta IS DISTINCT FROM NEW.final_delta
     OR OLD.posted_scope_version IS DISTINCT FROM NEW.posted_scope_version THEN
    RAISE EXCEPTION 'stocktake_posting_fields_are_server_owned';
  END IF;

  RETURN NEW;
END;
$$;
