-- Phase 4.3: concurrency-safe reservations and fail-closed negative-stock enforcement.
-- Reservations are single-scope and whole-quantity in this foundation slice.
-- Partial allocation, negative-stock override and lot allocation remain disabled.

INSERT INTO shared.permission_catalog (
  permission_key,
  module,
  label,
  description,
  is_system,
  created_at
) VALUES
  ('core.inventory.reserve', 'Kho', 'Quản lý giữ tồn', 'Cho phép giữ, giải phóng, tiêu thụ và hết hạn lượng tồn trong phạm vi kho được cấp.', true, now()),
  ('core.inventory.override-negative', 'Kho', 'Ghi âm kho có kiểm soát', 'Quyền dự phòng cho policy âm kho được owner phê duyệt; Phase 4.3 chưa kích hoạt đường override.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

-- Negative stock is enforced transactionally by the balance projector and
-- reservation service. A row-level reserved <= on-hand CHECK is deliberately
-- not used: PostgreSQL validates the proposed EXCLUDED row before an UPSERT
-- conflict update, and a valid OUT delta is negative at that intermediate
-- point. The projection must also remain capable of rebuilding historical
-- ledger facts for reconciliation.
ALTER TABLE inventory.inventory_balances
  DROP CONSTRAINT IF EXISTS inventory_balances_reserved_not_above_on_hand;

CREATE TABLE IF NOT EXISTS inventory.inventory_reservations (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  source_key text NOT NULL CHECK (char_length(btrim(source_key)) BETWEEN 1 AND 160),
  source_domain text NOT NULL CHECK (
    char_length(source_domain) BETWEEN 1 AND 64
    AND source_domain = upper(btrim(source_domain))
    AND source_domain ~ '^[A-Z0-9_.-]{1,64}$'
  ),
  source_document_type text NULL CHECK (
    source_document_type IS NULL OR (
      char_length(source_document_type) BETWEEN 1 AND 64
      AND source_document_type = upper(btrim(source_document_type))
      AND source_document_type ~ '^[A-Z0-9_.-]{1,64}$'
    )
  ),
  source_document_id text NULL CHECK (source_document_id IS NULL OR char_length(btrim(source_document_id)) BETWEEN 1 AND 160),
  source_line_reference text NULL CHECK (source_line_reference IS NULL OR char_length(btrim(source_line_reference)) BETWEEN 1 AND 160),
  warehouse_id uuid NOT NULL,
  location_id uuid NULL,
  source_variant_id uuid NOT NULL,
  source_sku text NOT NULL CHECK (char_length(source_sku) BETWEEN 1 AND 96),
  source_unit_id uuid NOT NULL,
  source_unit_code text NOT NULL CHECK (char_length(source_unit_code) BETWEEN 1 AND 32),
  source_quantity numeric(20,6) NOT NULL CHECK (source_quantity > 0),
  conversion_to_base numeric(20,6) NOT NULL CHECK (conversion_to_base > 0),
  base_variant_id uuid NOT NULL,
  base_sku text NOT NULL CHECK (char_length(base_sku) BETWEEN 1 AND 96),
  lot_id uuid NULL,
  base_quantity numeric(30,12) NOT NULL CHECK (base_quantity > 0),
  held_quantity numeric(30,12) NOT NULL CHECK (held_quantity >= 0),
  state text NOT NULL CHECK (state IN ('ACTIVE', 'RELEASED', 'CONSUMED', 'EXPIRED')),
  expires_at timestamptz NULL,
  create_payload_hash text NOT NULL CHECK (create_payload_hash ~ '^[0-9a-f]{64}$'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL,
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  updated_at timestamptz NOT NULL,
  updated_by text NOT NULL CHECK (char_length(updated_by) BETWEEN 1 AND 128),
  terminal_at timestamptz NULL,
  terminal_by text NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT inventory_reservations_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT inventory_reservations_source_key_unique UNIQUE (installation_id, source_key),
  CONSTRAINT inventory_reservations_state_quantity_check CHECK (
    (state = 'ACTIVE' AND held_quantity = base_quantity AND terminal_at IS NULL AND terminal_by IS NULL)
    OR
    (state IN ('RELEASED', 'CONSUMED', 'EXPIRED') AND held_quantity = 0 AND terminal_at IS NOT NULL AND terminal_by IS NOT NULL)
  ),
  CONSTRAINT inventory_reservations_warehouse_installation_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT inventory_reservations_location_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id, location_id)
    REFERENCES shared.warehouse_locations (installation_id, warehouse_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT inventory_reservations_source_variant_installation_fk
    FOREIGN KEY (installation_id, source_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT inventory_reservations_base_variant_installation_fk
    FOREIGN KEY (installation_id, base_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT inventory_reservations_source_unit_installation_fk
    FOREIGN KEY (installation_id, source_unit_id)
    REFERENCES shared.units_of_measure (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS inventory_reservations_active_scope_idx
  ON inventory.inventory_reservations (
    installation_id,
    warehouse_id,
    location_id,
    base_variant_id,
    lot_id,
    expires_at
  )
  WHERE state = 'ACTIVE';
CREATE INDEX IF NOT EXISTS inventory_reservations_source_document_idx
  ON inventory.inventory_reservations (
    installation_id,
    source_domain,
    source_document_type,
    source_document_id
  );

CREATE TABLE IF NOT EXISTS inventory.inventory_reservation_events (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  reservation_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('RESERVED', 'RELEASED', 'CONSUMED', 'EXPIRED')),
  from_state text NULL CHECK (from_state IS NULL OR from_state IN ('ACTIVE', 'RELEASED', 'CONSUMED', 'EXPIRED')),
  to_state text NOT NULL CHECK (to_state IN ('ACTIVE', 'RELEASED', 'CONSUMED', 'EXPIRED')),
  base_quantity numeric(30,12) NOT NULL CHECK (base_quantity > 0),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  reason_code text NULL CHECK (reason_code IS NULL OR char_length(btrim(reason_code)) BETWEEN 1 AND 64),
  reason_note text NULL CHECK (reason_note IS NULL OR char_length(btrim(reason_note)) BETWEEN 1 AND 2000),
  result_snapshot jsonb NOT NULL CHECK (jsonb_typeof(result_snapshot) = 'object'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz NOT NULL,
  occurred_by text NOT NULL CHECK (char_length(occurred_by) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  CONSTRAINT inventory_reservation_events_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT inventory_reservation_events_idempotency_unique UNIQUE (installation_id, idempotency_key),
  CONSTRAINT inventory_reservation_events_reservation_installation_fk
    FOREIGN KEY (installation_id, reservation_id)
    REFERENCES inventory.inventory_reservations (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS inventory_reservation_events_reservation_idx
  ON inventory.inventory_reservation_events (installation_id, reservation_id, occurred_at, id);

CREATE OR REPLACE FUNCTION inventory.guard_inventory_reservation_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('npp.inventory_reservation_write_context', true) <> 'reservation' THEN
    RAISE EXCEPTION 'inventory_reservation_write_requires_service';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS inventory_reservations_writer_guard ON inventory.inventory_reservations;
CREATE TRIGGER inventory_reservations_writer_guard
BEFORE INSERT OR UPDATE OR DELETE ON inventory.inventory_reservations
FOR EACH ROW EXECUTE FUNCTION inventory.guard_inventory_reservation_write();

CREATE OR REPLACE FUNCTION inventory.prevent_inventory_reservation_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'inventory_reservation_events_are_append_only';
END;
$$;

DROP TRIGGER IF EXISTS inventory_reservation_events_append_only ON inventory.inventory_reservation_events;
CREATE TRIGGER inventory_reservation_events_append_only
BEFORE UPDATE OR DELETE ON inventory.inventory_reservation_events
FOR EACH ROW EXECUTE FUNCTION inventory.prevent_inventory_reservation_event_mutation();

-- Replace the Phase 4.2 projector with a fail-closed variant. Any OUT delta must
-- fit inside current available stock. A reservation consume releases its own hold
-- before inserting the internal OUT movement, in the same transaction and while
-- holding the exact balance row lock.
CREATE OR REPLACE FUNCTION inventory.project_inventory_balance_from_line()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  movement_posted_at timestamptz;
  current_available numeric(30,12);
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

  IF NEW.base_quantity_delta < 0 THEN
    SELECT balance.available_quantity
      INTO current_available
      FROM inventory.inventory_balances balance
     WHERE balance.installation_id = NEW.installation_id
       AND balance.warehouse_id = NEW.warehouse_id
       AND balance.location_id IS NOT DISTINCT FROM NEW.location_id
       AND balance.base_variant_id = NEW.base_variant_id
       AND balance.lot_id IS NULL
     FOR UPDATE;

    IF current_available IS NULL OR current_available + NEW.base_quantity_delta < 0 THEN
      RAISE EXCEPTION 'inventory_negative_stock_denied';
    END IF;
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

  PERFORM set_config('npp.inventory_balance_write_context', COALESCE(previous_context, ''), true);
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config('npp.inventory_balance_write_context', COALESCE(previous_context, ''), true);
    RAISE;
END;
$$;
