-- Phase 4.2: rebuildable inventory balance read model.
-- The immutable ledger remains the source of truth. Balance writes are restricted to
-- the synchronous database projector, controlled rebuilds and the later reservation service.

CREATE TABLE IF NOT EXISTS inventory.inventory_balances (
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  warehouse_id uuid NOT NULL,
  location_id uuid NULL,
  base_variant_id uuid NOT NULL,
  lot_id uuid NULL,
  on_hand_quantity numeric(30,12) NOT NULL DEFAULT 0,
  reserved_quantity numeric(30,12) NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  available_quantity numeric(30,12)
    GENERATED ALWAYS AS (on_hand_quantity - reserved_quantity) STORED,
  projected_through timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_balances_scope_unique
    UNIQUE NULLS NOT DISTINCT (
      installation_id,
      warehouse_id,
      location_id,
      base_variant_id,
      lot_id
    ),
  CONSTRAINT inventory_balances_warehouse_installation_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT inventory_balances_location_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id, location_id)
    REFERENCES shared.warehouse_locations (installation_id, warehouse_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT inventory_balances_variant_installation_fk
    FOREIGN KEY (installation_id, base_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

COMMENT ON COLUMN inventory.inventory_balances.lot_id IS
  'Reserved for the Phase 4.4 lot foundation. Null for non-lot-tracked ledger lines.';

CREATE INDEX IF NOT EXISTS inventory_balances_variant_scope_idx
  ON inventory.inventory_balances (
    installation_id,
    base_variant_id,
    warehouse_id,
    location_id,
    lot_id
  );
CREATE INDEX IF NOT EXISTS inventory_balances_available_idx
  ON inventory.inventory_balances (
    installation_id,
    warehouse_id,
    available_quantity,
    base_variant_id
  );

CREATE OR REPLACE FUNCTION inventory.guard_inventory_balance_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.inventory_balance_write_context', true);
BEGIN
  IF write_context IS NULL OR write_context NOT IN ('projector', 'rebuild', 'reservation') THEN
    RAISE EXCEPTION 'inventory_balance_write_requires_projector';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS inventory_balances_writer_guard ON inventory.inventory_balances;
CREATE TRIGGER inventory_balances_writer_guard
BEFORE INSERT OR UPDATE OR DELETE ON inventory.inventory_balances
FOR EACH ROW EXECUTE FUNCTION inventory.guard_inventory_balance_write();

CREATE OR REPLACE FUNCTION inventory.project_inventory_balance_from_line()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  movement_posted_at timestamptz;
  previous_context text := current_setting('npp.inventory_balance_write_context', true);
BEGIN
  SELECT movement.posted_at
    INTO movement_posted_at
    FROM inventory.inventory_movements movement
   WHERE movement.installation_id = NEW.installation_id
     AND movement.id = NEW.movement_id;

  IF movement_posted_at IS NULL THEN
    RAISE EXCEPTION 'inventory_movement_missing_for_projection';
  END IF;

  PERFORM set_config('npp.inventory_balance_write_context', 'projector', true);

  INSERT INTO inventory.inventory_balances (
    installation_id,
    warehouse_id,
    location_id,
    base_variant_id,
    lot_id,
    on_hand_quantity,
    reserved_quantity,
    projected_through,
    updated_at
  ) VALUES (
    NEW.installation_id,
    NEW.warehouse_id,
    NEW.location_id,
    NEW.base_variant_id,
    NULL,
    NEW.base_quantity_delta,
    0,
    movement_posted_at,
    now()
  )
  ON CONFLICT (
    installation_id,
    warehouse_id,
    location_id,
    base_variant_id,
    lot_id
  ) DO UPDATE
  SET on_hand_quantity = inventory.inventory_balances.on_hand_quantity + EXCLUDED.on_hand_quantity,
      projected_through = CASE
        WHEN inventory.inventory_balances.projected_through IS NULL THEN EXCLUDED.projected_through
        WHEN EXCLUDED.projected_through IS NULL THEN inventory.inventory_balances.projected_through
        ELSE greatest(inventory.inventory_balances.projected_through, EXCLUDED.projected_through)
      END,
      updated_at = now();

  PERFORM set_config(
    'npp.inventory_balance_write_context',
    COALESCE(previous_context, ''),
    true
  );
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config(
      'npp.inventory_balance_write_context',
      COALESCE(previous_context, ''),
      true
    );
    RAISE;
END;
$$;

DROP TRIGGER IF EXISTS inventory_movement_lines_balance_projector
  ON inventory.inventory_movement_lines;
CREATE TRIGGER inventory_movement_lines_balance_projector
AFTER INSERT ON inventory.inventory_movement_lines
FOR EACH ROW EXECUTE FUNCTION inventory.project_inventory_balance_from_line();

-- Forward-only backfill for installations that already have Phase 4.1 ledger rows.
DO $$
DECLARE
  previous_context text := current_setting('npp.inventory_balance_write_context', true);
BEGIN
  PERFORM set_config('npp.inventory_balance_write_context', 'rebuild', true);

  INSERT INTO inventory.inventory_balances (
    installation_id,
    warehouse_id,
    location_id,
    base_variant_id,
    lot_id,
    on_hand_quantity,
    reserved_quantity,
    projected_through,
    updated_at
  )
  SELECT line.installation_id,
         line.warehouse_id,
         line.location_id,
         line.base_variant_id,
         NULL::uuid,
         sum(line.base_quantity_delta)::numeric(30,12),
         0::numeric(30,12),
         max(movement.posted_at),
         now()
    FROM inventory.inventory_movement_lines line
    JOIN inventory.inventory_movements movement
      ON movement.installation_id = line.installation_id
     AND movement.id = line.movement_id
   GROUP BY line.installation_id,
            line.warehouse_id,
            line.location_id,
            line.base_variant_id
  ON CONFLICT (
    installation_id,
    warehouse_id,
    location_id,
    base_variant_id,
    lot_id
  ) DO UPDATE
  SET on_hand_quantity = EXCLUDED.on_hand_quantity,
      projected_through = EXCLUDED.projected_through,
      updated_at = now();

  PERFORM set_config(
    'npp.inventory_balance_write_context',
    COALESCE(previous_context, ''),
    true
  );
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config(
      'npp.inventory_balance_write_context',
      COALESCE(previous_context, ''),
      true
    );
    RAISE;
END;
$$;
