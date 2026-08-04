-- Phase 6E.2: locked trip handover and atomic dispatch.
-- This migration does not introduce delivery attempts, POD, COD, returns or production operations.

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES
  ('core.delivery-trip.dispatch', 'Điều phối giao hàng', 'Bàn giao và cho chuyến xuất phát',
   'Cho phép xác nhận bàn giao vật lý, ghi Inventory OUT cho toàn bộ Delivery Order và chuyển chuyến đã khóa sang dispatched.',
   true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

ALTER TABLE logistics.delivery_trips
  ADD COLUMN IF NOT EXISTS dispatch_id uuid NULL,
  ADD COLUMN IF NOT EXISTS dispatch_idempotency_key text NULL,
  ADD COLUMN IF NOT EXISTS dispatch_payload_hash text NULL,
  ADD COLUMN IF NOT EXISTS handover_receiver_name text NULL,
  ADD COLUMN IF NOT EXISTS handover_note text NULL,
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS dispatched_by text NULL;

ALTER TABLE logistics.delivery_trips
  DROP CONSTRAINT IF EXISTS delivery_trips_status_check,
  DROP CONSTRAINT IF EXISTS delivery_trips_dispatch_idempotency_key_check,
  DROP CONSTRAINT IF EXISTS delivery_trips_dispatch_payload_hash_check,
  DROP CONSTRAINT IF EXISTS delivery_trips_handover_receiver_name_check,
  DROP CONSTRAINT IF EXISTS delivery_trips_handover_note_check,
  DROP CONSTRAINT IF EXISTS delivery_trips_dispatched_by_check,
  DROP CONSTRAINT IF EXISTS delivery_trips_dispatched_shape;

ALTER TABLE logistics.delivery_trips
  ADD CONSTRAINT delivery_trips_status_check
    CHECK (status IN ('draft', 'planned', 'locked', 'dispatched')),
  ADD CONSTRAINT delivery_trips_dispatch_idempotency_key_check
    CHECK (dispatch_idempotency_key IS NULL OR char_length(dispatch_idempotency_key) BETWEEN 1 AND 128),
  ADD CONSTRAINT delivery_trips_dispatch_payload_hash_check
    CHECK (dispatch_payload_hash IS NULL OR dispatch_payload_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT delivery_trips_handover_receiver_name_check
    CHECK (handover_receiver_name IS NULL OR char_length(btrim(handover_receiver_name)) BETWEEN 1 AND 256),
  ADD CONSTRAINT delivery_trips_handover_note_check
    CHECK (handover_note IS NULL OR char_length(handover_note) <= 2000),
  ADD CONSTRAINT delivery_trips_dispatched_by_check
    CHECK (dispatched_by IS NULL OR char_length(dispatched_by) BETWEEN 1 AND 128),
  ADD CONSTRAINT delivery_trips_dispatched_shape CHECK (
    status <> 'dispatched'
    OR (
      dispatch_id IS NOT NULL
      AND dispatch_idempotency_key IS NOT NULL
      AND dispatch_payload_hash IS NOT NULL
      AND handover_receiver_name IS NOT NULL
      AND dispatched_at IS NOT NULL
      AND dispatched_by IS NOT NULL
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS delivery_trips_dispatch_id_unique
  ON logistics.delivery_trips (installation_id, dispatch_id)
  WHERE dispatch_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS delivery_trips_dispatch_idempotency_unique
  ON logistics.delivery_trips (installation_id, dispatch_idempotency_key)
  WHERE dispatch_idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS logistics.trip_dispatch_items (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  dispatch_id uuid NOT NULL,
  trip_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  trip_stop_id uuid NOT NULL,
  delivery_order_id uuid NOT NULL,
  inventory_issue_id uuid NOT NULL,
  inventory_movement_id uuid NOT NULL,
  posted_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT trip_dispatch_items_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT trip_dispatch_items_delivery_order_unique UNIQUE (installation_id, delivery_order_id),
  CONSTRAINT trip_dispatch_items_assignment_unique UNIQUE (installation_id, assignment_id),
  CONSTRAINT trip_dispatch_items_issue_unique UNIQUE (installation_id, inventory_issue_id),
  CONSTRAINT trip_dispatch_items_movement_unique UNIQUE (installation_id, inventory_movement_id),
  CONSTRAINT trip_dispatch_items_trip_fk
    FOREIGN KEY (installation_id, trip_id)
    REFERENCES logistics.delivery_trips (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT trip_dispatch_items_assignment_fk
    FOREIGN KEY (installation_id, assignment_id)
    REFERENCES logistics.trip_order_assignments (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT trip_dispatch_items_stop_fk
    FOREIGN KEY (installation_id, trip_stop_id)
    REFERENCES logistics.trip_stops (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT trip_dispatch_items_delivery_order_fk
    FOREIGN KEY (installation_id, delivery_order_id)
    REFERENCES sales.delivery_orders (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT trip_dispatch_items_inventory_issue_fk
    FOREIGN KEY (installation_id, inventory_issue_id)
    REFERENCES sales.delivery_order_inventory_issues (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT trip_dispatch_items_inventory_movement_fk
    FOREIGN KEY (installation_id, inventory_movement_id)
    REFERENCES inventory.inventory_movements (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS trip_dispatch_items_trip_idx
  ON logistics.trip_dispatch_items (installation_id, trip_id, posted_at, id);

ALTER TABLE logistics.trip_events
  DROP CONSTRAINT IF EXISTS trip_events_event_type_check;
ALTER TABLE logistics.trip_events
  ADD CONSTRAINT trip_events_event_type_check CHECK (event_type IN (
    'CREATED', 'UPDATED', 'ASSIGNED', 'UNASSIGNED', 'REORDERED',
    'PLANNED', 'REOPENED', 'LOCKED', 'DISPATCHED'
  ));

CREATE OR REPLACE FUNCTION logistics.guard_trip_header_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.logistics_write_context', true);
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'logistics_trip_delete_forbidden';
  END IF;
  IF write_context NOT IN ('trip_planning_service', 'trip_dispatch_service') THEN
    RAISE EXCEPTION 'logistics_trip_write_requires_service_context';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.installation_id IS DISTINCT FROM OLD.installation_id
       OR NEW.trip_number IS DISTINCT FROM OLD.trip_number
       OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
       OR NEW.create_idempotency_key IS DISTINCT FROM OLD.create_idempotency_key
       OR NEW.create_payload_hash IS DISTINCT FROM OLD.create_payload_hash
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'logistics_trip_immutable_fields_changed';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT (
        (OLD.status = 'draft' AND NEW.status = 'planned' AND write_context = 'trip_planning_service')
        OR (OLD.status = 'planned' AND NEW.status = 'draft' AND write_context = 'trip_planning_service')
        OR (OLD.status = 'planned' AND NEW.status = 'locked' AND write_context = 'trip_planning_service')
        OR (OLD.status = 'locked' AND NEW.status = 'dispatched' AND write_context = 'trip_dispatch_service')
      ) THEN
        RAISE EXCEPTION 'logistics_trip_invalid_transition';
      END IF;
    END IF;
    IF write_context = 'trip_planning_service' AND OLD.status = 'locked' THEN
      RAISE EXCEPTION 'logistics_trip_locked';
    END IF;
    IF OLD.status = 'dispatched' THEN
      RAISE EXCEPTION 'logistics_trip_dispatched';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION logistics.guard_trip_child_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.logistics_write_context', true);
  target_trip_id uuid;
  target_installation_id text;
  trip_record logistics.delivery_trips;
BEGIN
  IF write_context IS DISTINCT FROM 'trip_planning_service' THEN
    RAISE EXCEPTION 'logistics_trip_child_write_requires_service_context';
  END IF;
  target_trip_id := COALESCE(NEW.trip_id, OLD.trip_id);
  target_installation_id := COALESCE(NEW.installation_id, OLD.installation_id);
  SELECT * INTO trip_record
    FROM logistics.delivery_trips
   WHERE installation_id = target_installation_id AND id = target_trip_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'logistics_trip_not_found';
  END IF;
  IF trip_record.status IN ('locked', 'dispatched') THEN
    RAISE EXCEPTION 'logistics_trip_locked';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION logistics.guard_trip_dispatch_item_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.logistics_write_context', true);
  trip_record logistics.delivery_trips;
  assignment_record logistics.trip_order_assignments;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'logistics_trip_dispatch_item_immutable';
  END IF;
  IF write_context IS DISTINCT FROM 'trip_dispatch_service' THEN
    RAISE EXCEPTION 'logistics_trip_dispatch_item_requires_service_context';
  END IF;
  SELECT * INTO trip_record
    FROM logistics.delivery_trips
   WHERE installation_id = NEW.installation_id AND id = NEW.trip_id
   FOR UPDATE;
  SELECT * INTO assignment_record
    FROM logistics.trip_order_assignments
   WHERE installation_id = NEW.installation_id AND id = NEW.assignment_id;
  IF trip_record IS NULL OR assignment_record IS NULL THEN
    RAISE EXCEPTION 'logistics_trip_dispatch_lineage_not_found';
  END IF;
  IF trip_record.status NOT IN ('locked', 'dispatched')
     OR assignment_record.trip_id IS DISTINCT FROM NEW.trip_id
     OR assignment_record.trip_stop_id IS DISTINCT FROM NEW.trip_stop_id
     OR assignment_record.delivery_order_id IS DISTINCT FROM NEW.delivery_order_id
     OR assignment_record.unassigned_at IS NOT NULL THEN
    RAISE EXCEPTION 'logistics_trip_dispatch_lineage_mismatch';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trip_dispatch_items_write_guard ON logistics.trip_dispatch_items;
CREATE TRIGGER trip_dispatch_items_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON logistics.trip_dispatch_items
FOR EACH ROW EXECUTE FUNCTION logistics.guard_trip_dispatch_item_write();

CREATE OR REPLACE FUNCTION logistics.guard_trip_transition_shape()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  vehicle_record logistics.vehicles;
  driver_record logistics.driver_profiles;
  assignment_count bigint;
  invalid_assignment_count bigint;
  dispatch_item_count bigint;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IN ('planned', 'locked', 'dispatched') AND NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT * INTO vehicle_record
      FROM logistics.vehicles
     WHERE installation_id = NEW.installation_id AND id = NEW.vehicle_id;
    SELECT * INTO driver_record
      FROM logistics.driver_profiles
     WHERE installation_id = NEW.installation_id AND id = NEW.primary_driver_id;
    IF vehicle_record IS NULL OR NOT vehicle_record.is_active OR vehicle_record.operational_status <> 'AVAILABLE' THEN
      RAISE EXCEPTION 'logistics_vehicle_not_available';
    END IF;
    IF driver_record IS NULL OR NOT driver_record.is_active THEN
      RAISE EXCEPTION 'logistics_driver_not_available';
    END IF;
    SELECT count(*) INTO assignment_count
      FROM logistics.trip_order_assignments
     WHERE installation_id = NEW.installation_id
       AND trip_id = NEW.id
       AND unassigned_at IS NULL;
    IF assignment_count = 0 THEN
      RAISE EXCEPTION 'logistics_trip_assignment_required';
    END IF;
    SELECT count(*) INTO invalid_assignment_count
      FROM logistics.trip_order_assignments assignment
      JOIN sales.delivery_orders delivery_order
        ON delivery_order.installation_id = assignment.installation_id
       AND delivery_order.id = assignment.delivery_order_id
     WHERE assignment.installation_id = NEW.installation_id
       AND assignment.trip_id = NEW.id
       AND assignment.unassigned_at IS NULL
       AND (
         delivery_order.handover_mode <> 'DELIVERY'
         OR delivery_order.warehouse_id IS DISTINCT FROM NEW.warehouse_id
         OR (NEW.status <> 'dispatched' AND delivery_order.status <> 'ready_to_dispatch')
         OR (NEW.status = 'dispatched' AND delivery_order.status <> 'dispatched')
       );
    IF invalid_assignment_count > 0 THEN
      RAISE EXCEPTION 'logistics_trip_contains_ineligible_delivery_order';
    END IF;
    IF NEW.status = 'dispatched' THEN
      SELECT count(*) INTO dispatch_item_count
        FROM logistics.trip_dispatch_items
       WHERE installation_id = NEW.installation_id
         AND trip_id = NEW.id
         AND dispatch_id = NEW.dispatch_id;
      IF dispatch_item_count IS DISTINCT FROM assignment_count THEN
        RAISE EXCEPTION 'logistics_trip_dispatch_reconciliation_mismatch';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_trips_transition_shape_guard ON logistics.delivery_trips;
CREATE TRIGGER delivery_trips_transition_shape_guard
BEFORE UPDATE ON logistics.delivery_trips
FOR EACH ROW EXECUTE FUNCTION logistics.guard_trip_transition_shape();