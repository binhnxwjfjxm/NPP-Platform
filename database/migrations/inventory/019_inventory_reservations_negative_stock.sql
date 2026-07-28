-- Phase 4.3: inventory reservations lifecycle and negative-stock enforcement.
-- Reservations are installation-scoped aggregates with immutable event history.
-- State machine: ACTIVE -> RELEASED | CONSUMED | EXPIRED | CANCELLED.
-- Negative stock is denied by default; P4.3 exposes no override path.

INSERT INTO shared.permission_catalog (
  permission_key,
  module,
  label,
  description,
  is_system,
  created_at
) VALUES
  ('core.inventory.reserve', 'Kho', 'Cấp phát kho', 'Cho phép tạo và chuyển trạng thái cấp phát kho trong phạm vi kho được cấp.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS inventory.inventory_reservations (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  warehouse_id uuid NOT NULL,
  location_id uuid NULL,
  base_variant_id uuid NOT NULL,
  lot_id uuid NULL,
  quantity numeric(30,12) NOT NULL CHECK (quantity > 0),
  state text NOT NULL CHECK (
    state IN ('ACTIVE', 'RELEASED', 'CONSUMED', 'EXPIRED', 'CANCELLED')
  ),
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
  source_document_id text NULL CHECK (
    source_document_id IS NULL
    OR char_length(btrim(source_document_id)) BETWEEN 1 AND 160
  ),
  activated_at timestamptz NOT NULL DEFAULT now(),
  transitioned_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT inventory_reservations_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT inventory_reservations_idempotency_unique UNIQUE (installation_id, idempotency_key),
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
  CONSTRAINT inventory_reservations_variant_installation_fk
    FOREIGN KEY (installation_id, base_variant_id)
    REFERENCES shared.product_variants (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

-- Multiple source documents may reserve the same inventory scope concurrently.
DROP INDEX IF EXISTS inventory.inventory_reservations_scope_active_idx;
CREATE INDEX inventory_reservations_scope_active_idx
  ON inventory.inventory_reservations (
    installation_id,
    warehouse_id,
    location_id,
    base_variant_id,
    lot_id
  )
  WHERE state = 'ACTIVE';

CREATE INDEX IF NOT EXISTS inventory_reservations_warehouse_idx
  ON inventory.inventory_reservations (installation_id, warehouse_id, state);
CREATE INDEX IF NOT EXISTS inventory_reservations_activation_idx
  ON inventory.inventory_reservations (installation_id, activated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS inventory.inventory_reservation_events (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  reservation_id uuid NOT NULL,
  transition text NOT NULL CHECK (
    transition IN (
      'CREATE_ACTIVE',
      'RELEASE_TO_RELEASED',
      'CONSUME_TO_CONSUMED',
      'EXPIRE_TO_EXPIRED',
      'CANCEL_TO_CANCELLED'
    )
  ),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT inventory_reservation_events_id_installation_unique UNIQUE (installation_id, id),
  CONSTRAINT inventory_reservation_events_reservation_installation_fk
    FOREIGN KEY (installation_id, reservation_id)
    REFERENCES inventory.inventory_reservations (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS inventory_reservation_events_reservation_idx
  ON inventory.inventory_reservation_events (
    installation_id,
    reservation_id,
    occurred_at ASC,
    id ASC
  );
CREATE INDEX IF NOT EXISTS inventory_reservation_events_request_idx
  ON inventory.inventory_reservation_events (installation_id, request_id);

CREATE OR REPLACE FUNCTION inventory.prevent_reservation_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'inventory_reservation_events_are_append_only';
END;
$$;

DROP TRIGGER IF EXISTS inventory_reservation_events_append_only
  ON inventory.inventory_reservation_events;
CREATE TRIGGER inventory_reservation_events_append_only
BEFORE UPDATE OR DELETE ON inventory.inventory_reservation_events
FOR EACH ROW EXECUTE FUNCTION inventory.prevent_reservation_event_mutation();

CREATE OR REPLACE FUNCTION inventory.guard_inventory_reservation_event_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.inventory_reservation_write_context', true);
BEGIN
  IF write_context IS DISTINCT FROM 'reservation_service' THEN
    RAISE EXCEPTION 'inventory_reservation_event_insert_requires_service_context';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_reservation_events_insert_guard
  ON inventory.inventory_reservation_events;
CREATE TRIGGER inventory_reservation_events_insert_guard
BEFORE INSERT ON inventory.inventory_reservation_events
FOR EACH ROW EXECUTE FUNCTION inventory.guard_inventory_reservation_event_insert();

CREATE OR REPLACE FUNCTION inventory.guard_inventory_reservation_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.inventory_reservation_write_context', true);
BEGIN
  IF write_context IS DISTINCT FROM 'reservation_service' THEN
    RAISE EXCEPTION 'inventory_reservation_write_requires_service_context';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'inventory_reservations_cannot_be_deleted';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'ACTIVE' THEN
      RAISE EXCEPTION 'inventory_reservation_must_start_active';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.installation_id IS DISTINCT FROM OLD.installation_id
     OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
     OR NEW.location_id IS DISTINCT FROM OLD.location_id
     OR NEW.base_variant_id IS DISTINCT FROM OLD.base_variant_id
     OR NEW.lot_id IS DISTINCT FROM OLD.lot_id
     OR NEW.quantity IS DISTINCT FROM OLD.quantity
     OR NEW.source_domain IS DISTINCT FROM OLD.source_domain
     OR NEW.source_document_type IS DISTINCT FROM OLD.source_document_type
     OR NEW.source_document_id IS DISTINCT FROM OLD.source_document_id
     OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
     OR NEW.metadata IS DISTINCT FROM OLD.metadata THEN
    RAISE EXCEPTION 'inventory_reservation_immutable_fields_cannot_change';
  END IF;

  IF OLD.state <> 'ACTIVE'
     OR NEW.state NOT IN ('RELEASED', 'CONSUMED', 'EXPIRED', 'CANCELLED') THEN
    RAISE EXCEPTION 'inventory_reservation_invalid_state_transition';
  END IF;

  IF NEW.transitioned_at < OLD.transitioned_at THEN
    RAISE EXCEPTION 'inventory_reservation_transition_time_cannot_move_backwards';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_reservations_writer_guard
  ON inventory.inventory_reservations;
CREATE TRIGGER inventory_reservations_writer_guard
BEFORE INSERT OR UPDATE OR DELETE ON inventory.inventory_reservations
FOR EACH ROW EXECUTE FUNCTION inventory.guard_inventory_reservation_write();

-- Database backstop for current and future negative inventory movement lines.
-- A negative line may not leave on-hand below the quantity already reserved.
CREATE OR REPLACE FUNCTION inventory.guard_inventory_negative_stock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_on_hand numeric(30,12);
  current_reserved numeric(30,12);
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
     AND balance.lot_id IS NULL
   FOR UPDATE;

  IF NOT FOUND OR current_on_hand + NEW.base_quantity_delta < current_reserved THEN
    RAISE EXCEPTION 'inventory_negative_stock_denied';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_movement_lines_negative_stock_guard
  ON inventory.inventory_movement_lines;
CREATE TRIGGER inventory_movement_lines_negative_stock_guard
BEFORE INSERT ON inventory.inventory_movement_lines
FOR EACH ROW EXECUTE FUNCTION inventory.guard_inventory_negative_stock();

CREATE OR REPLACE FUNCTION inventory.sync_reservation_to_balance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  reservation_record inventory.inventory_reservations;
  previous_context text := current_setting('npp.inventory_balance_write_context', true);
  delta numeric(30,12);
BEGIN
  SELECT * INTO reservation_record
    FROM inventory.inventory_reservations
   WHERE installation_id = NEW.installation_id
     AND id = NEW.reservation_id;

  IF reservation_record IS NULL THEN
    RAISE EXCEPTION 'inventory_reservation_missing_for_sync';
  END IF;

  CASE NEW.transition
    WHEN 'CREATE_ACTIVE' THEN
      IF reservation_record.state <> 'ACTIVE' THEN
        RAISE EXCEPTION 'inventory_reservation_event_state_mismatch';
      END IF;
      delta := reservation_record.quantity;
    WHEN 'RELEASE_TO_RELEASED' THEN
      IF reservation_record.state <> 'RELEASED' THEN
        RAISE EXCEPTION 'inventory_reservation_event_state_mismatch';
      END IF;
      delta := -reservation_record.quantity;
    WHEN 'CONSUME_TO_CONSUMED' THEN
      IF reservation_record.state <> 'CONSUMED' THEN
        RAISE EXCEPTION 'inventory_reservation_event_state_mismatch';
      END IF;
      delta := -reservation_record.quantity;
    WHEN 'EXPIRE_TO_EXPIRED' THEN
      IF reservation_record.state <> 'EXPIRED' THEN
        RAISE EXCEPTION 'inventory_reservation_event_state_mismatch';
      END IF;
      delta := -reservation_record.quantity;
    WHEN 'CANCEL_TO_CANCELLED' THEN
      IF reservation_record.state <> 'CANCELLED' THEN
        RAISE EXCEPTION 'inventory_reservation_event_state_mismatch';
      END IF;
      delta := -reservation_record.quantity;
    ELSE
      RAISE EXCEPTION 'inventory_reservation_transition_not_supported';
  END CASE;

  PERFORM set_config('npp.inventory_balance_write_context', 'reservation', true);

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
    reservation_record.warehouse_id,
    reservation_record.location_id,
    reservation_record.base_variant_id,
    reservation_record.lot_id,
    0,
    delta,
    now(),
    now()
  )
  ON CONFLICT (
    installation_id,
    warehouse_id,
    location_id,
    base_variant_id,
    lot_id
  ) DO UPDATE
  SET reserved_quantity = inventory.inventory_balances.reserved_quantity
                          + EXCLUDED.reserved_quantity,
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

DROP TRIGGER IF EXISTS inventory_reservation_events_sync_balance
  ON inventory.inventory_reservation_events;
CREATE TRIGGER inventory_reservation_events_sync_balance
AFTER INSERT ON inventory.inventory_reservation_events
FOR EACH ROW EXECUTE FUNCTION inventory.sync_reservation_to_balance();
