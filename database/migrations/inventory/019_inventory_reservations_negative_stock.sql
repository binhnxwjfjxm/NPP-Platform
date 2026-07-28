-- Phase 4.3: inventory reservations lifecycle and negative-stock enforcement.
-- Reservations are installation-scoped aggregates with immutable event history.
-- State machine: ACTIVE -> RELEASED | CONSUMED | EXPIRED | CANCELLED
-- Negative stock is denied by default (fail-closed); no override API in P4.3.

-- Add core.inventory.reserve permission
INSERT INTO shared.permission_catalog (
  permission_key,
  module,
  label,
  description,
  is_system,
  created_at
) VALUES
  ('core.inventory.reserve', 'Kho', 'Cấp phát kho', 'Cho phép tạo, phát hành, tiêu thụ và hủy cấp phát kho theo đơn vị khối trong phạm vi kho được cấp.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

-- Reservation aggregate: immutable state machine
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
  source_document_id text NULL CHECK (source_document_id IS NULL OR char_length(btrim(source_document_id)) BETWEEN 1 AND 160),
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

CREATE UNIQUE INDEX IF NOT EXISTS inventory_reservations_scope_active_idx
  ON inventory.inventory_reservations (installation_id, warehouse_id, location_id, base_variant_id, lot_id, state)
  WHERE state = 'ACTIVE';
CREATE INDEX IF NOT EXISTS inventory_reservations_warehouse_idx
  ON inventory.inventory_reservations (installation_id, warehouse_id, state);
CREATE INDEX IF NOT EXISTS inventory_reservations_activation_idx
  ON inventory.inventory_reservations (installation_id, activated_at DESC, id DESC);

-- Immutable reservation event history (append-only)
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
  ON inventory.inventory_reservation_events (installation_id, reservation_id, occurred_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS inventory_reservation_events_request_idx
  ON inventory.inventory_reservation_events (installation_id, request_id);

-- Append-only guard for reservation events
CREATE OR REPLACE FUNCTION inventory.prevent_reservation_event_mutation()
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
FOR EACH ROW EXECUTE FUNCTION inventory.prevent_reservation_event_mutation();

-- Prevent direct writes to reservation aggregate except via service transitions
CREATE OR REPLACE FUNCTION inventory.guard_inventory_reservation_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.inventory_reservation_write_context', true);
BEGIN
  IF write_context IS NULL OR write_context NOT IN ('reservation_service') THEN
    RAISE EXCEPTION 'inventory_reservation_write_requires_service_context';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS inventory_reservations_writer_guard ON inventory.inventory_reservations;
CREATE TRIGGER inventory_reservations_writer_guard
BEFORE INSERT OR UPDATE OR DELETE ON inventory.inventory_reservations
FOR EACH ROW EXECUTE FUNCTION inventory.guard_inventory_reservation_write();

-- Update inventory.inventory_balances reserved_quantity via trigger when reservation events occur
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

  -- Determine delta based on transition
  CASE NEW.transition
    WHEN 'CREATE_ACTIVE' THEN
      delta := reservation_record.quantity;
    WHEN 'RELEASE_TO_RELEASED', 'CONSUME_TO_CONSUMED', 'EXPIRE_TO_EXPIRED', 'CANCEL_TO_CANCELLED' THEN
      delta := -reservation_record.quantity;
    ELSE
      delta := 0;
  END CASE;

  IF delta <> 0 THEN
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
    SET reserved_quantity = inventory.inventory_balances.reserved_quantity + EXCLUDED.reserved_quantity,
        updated_at = now();

    PERFORM set_config(
      'npp.inventory_balance_write_context',
      COALESCE(previous_context, ''),
      true
    );
  END IF;

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

DROP TRIGGER IF EXISTS inventory_reservation_events_sync_balance ON inventory.inventory_reservation_events;
CREATE TRIGGER inventory_reservation_events_sync_balance
AFTER INSERT ON inventory.inventory_reservation_events
FOR EACH ROW EXECUTE FUNCTION inventory.sync_reservation_to_balance();
