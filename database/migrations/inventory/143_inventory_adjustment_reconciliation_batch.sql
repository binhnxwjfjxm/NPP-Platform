-- Bulk inventory reconciliation: one business batch may create one IN and one OUT adjustment.
-- Keep printable snapshots so old adjustment documents can be opened and exported later.

ALTER TABLE inventory.inventory_adjustments
  ADD COLUMN IF NOT EXISTS reconciliation_batch_code text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'inventory.inventory_adjustments'::regclass
       AND conname = 'inventory_adjustments_reconciliation_batch_code_ck'
  ) THEN
    ALTER TABLE inventory.inventory_adjustments
      ADD CONSTRAINT inventory_adjustments_reconciliation_batch_code_ck
      CHECK (
        reconciliation_batch_code IS NULL
        OR (
          char_length(reconciliation_batch_code) BETWEEN 1 AND 64
          AND reconciliation_batch_code ~ '^[A-Z0-9._-]+$'
        )
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS inventory_adjustments_reconciliation_batch_idx
  ON inventory.inventory_adjustments (installation_id, reconciliation_batch_code, created_at DESC)
  WHERE reconciliation_batch_code IS NOT NULL;

ALTER TABLE inventory.inventory_adjustment_lines
  ADD COLUMN IF NOT EXISTS product_name_snapshot text NULL,
  ADD COLUMN IF NOT EXISTS source_location_code_snapshot text NULL,
  ADD COLUMN IF NOT EXISTS source_location_name_snapshot text NULL,
  ADD COLUMN IF NOT EXISTS system_base_quantity_snapshot numeric(30,12) NULL,
  ADD COLUMN IF NOT EXISTS counted_base_quantity_snapshot numeric(30,12) NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'inventory.inventory_adjustment_lines'::regclass
       AND conname = 'inventory_adjustment_lines_system_quantity_snapshot_ck'
  ) THEN
    ALTER TABLE inventory.inventory_adjustment_lines
      ADD CONSTRAINT inventory_adjustment_lines_system_quantity_snapshot_ck
      CHECK (system_base_quantity_snapshot IS NULL OR system_base_quantity_snapshot >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'inventory.inventory_adjustment_lines'::regclass
       AND conname = 'inventory_adjustment_lines_counted_quantity_snapshot_ck'
  ) THEN
    ALTER TABLE inventory.inventory_adjustment_lines
      ADD CONSTRAINT inventory_adjustment_lines_counted_quantity_snapshot_ck
      CHECK (counted_base_quantity_snapshot IS NULL OR counted_base_quantity_snapshot >= 0);
  END IF;
END
$$;
