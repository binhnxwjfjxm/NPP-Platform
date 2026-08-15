-- Issue #549 Lane D: dispatched-trip recovery without erasing dispatch history.
-- Recovery is allowed only before any delivery attempt. Recovered trips never become planning drafts again.

ALTER TABLE logistics.delivery_trips
  ADD COLUMN IF NOT EXISTS recovery_reason text NULL,
  ADD COLUMN IF NOT EXISTS recovery_idempotency_key text NULL,
  ADD COLUMN IF NOT EXISTS recovery_payload_hash text NULL,
  ADD COLUMN IF NOT EXISTS recovered_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS recovered_by text NULL;

ALTER TABLE logistics.delivery_trips
  DROP CONSTRAINT IF EXISTS delivery_trips_status_check,
  DROP CONSTRAINT IF EXISTS delivery_trips_recovery_reason_check,
  DROP CONSTRAINT IF EXISTS delivery_trips_recovery_idempotency_key_check,
  DROP CONSTRAINT IF EXISTS delivery_trips_recovery_payload_hash_check,
  DROP CONSTRAINT IF EXISTS delivery_trips_recovered_by_check,
  DROP CONSTRAINT IF EXISTS delivery_trips_recovered_shape;

ALTER TABLE logistics.delivery_trips
  ADD CONSTRAINT delivery_trips_status_check
    CHECK (status IN ('draft', 'planned', 'locked', 'dispatched', 'recovered', 'closed')),
  ADD CONSTRAINT delivery_trips_recovery_reason_check
    CHECK (recovery_reason IS NULL OR char_length(btrim(recovery_reason)) BETWEEN 1 AND 1000),
  ADD CONSTRAINT delivery_trips_recovery_idempotency_key_check
    CHECK (recovery_idempotency_key IS NULL OR (
      char_length(recovery_idempotency_key) BETWEEN 1 AND 128
      AND recovery_idempotency_key ~ '^[A-Za-z0-9._-]+$'
    )),
  ADD CONSTRAINT delivery_trips_recovery_payload_hash_check
    CHECK (recovery_payload_hash IS NULL OR recovery_payload_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT delivery_trips_recovered_by_check
    CHECK (recovered_by IS NULL OR char_length(recovered_by) BETWEEN 1 AND 128),
  ADD CONSTRAINT delivery_trips_recovered_shape CHECK (
    status <> 'recovered'
    OR (
      recovery_reason IS NOT NULL
      AND recovery_idempotency_key IS NOT NULL
      AND recovery_payload_hash IS NOT NULL
      AND recovered_at IS NOT NULL
      AND recovered_by IS NOT NULL
      AND dispatch_id IS NOT NULL
      AND dispatched_at IS NOT NULL
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS delivery_trips_recovery_idempotency_unique
  ON logistics.delivery_trips (installation_id, recovery_idempotency_key)
  WHERE recovery_idempotency_key IS NOT NULL;

ALTER TABLE logistics.trip_events
  DROP CONSTRAINT IF EXISTS trip_events_event_type_check;
ALTER TABLE logistics.trip_events
  ADD CONSTRAINT trip_events_event_type_check CHECK (event_type IN (
    'CREATED', 'UPDATED', 'ASSIGNED', 'UNASSIGNED', 'REORDERED',
    'PLANNED', 'REOPENED', 'LOCKED', 'DISPATCHED',
    'DELIVERY_ATTEMPT_RECORDED', 'RETURN_RECEIPT_POSTED', 'CLOSED',
    'POD_ATTACHED', 'DISPATCH_RECOVERED', 'RECOVERY_UNASSIGNED'
  ));

-- Preserve the current planning/dispatch/reconciliation guard outside recovery context.
DROP TRIGGER IF EXISTS delivery_trips_write_guard ON logistics.delivery_trips;
CREATE TRIGGER delivery_trips_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON logistics.delivery_trips
FOR EACH ROW
WHEN (current_setting('npp.logistics_write_context', true) IS DISTINCT FROM 'trip_recovery_service')
EXECUTE FUNCTION logistics.guard_trip_header_write();

CREATE OR REPLACE FUNCTION logistics.guard_trip_recovery_header_write()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('npp.logistics_write_context', true) IS DISTINCT FROM 'trip_recovery_service' THEN
    RAISE EXCEPTION 'logistics_trip_recovery_requires_service_context';
  END IF;
  IF TG_OP <> 'UPDATE' OR OLD.status <> 'dispatched' OR NEW.status <> 'recovered' THEN
    RAISE EXCEPTION 'logistics_trip_recovery_invalid_transition';
  END IF;
  IF EXISTS (
    SELECT 1 FROM logistics.delivery_attempts attempt
     WHERE attempt.installation_id = OLD.installation_id
       AND attempt.trip_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'logistics_trip_recovery_blocked_by_delivery_attempt';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.installation_id IS DISTINCT FROM OLD.installation_id
     OR NEW.trip_number IS DISTINCT FROM OLD.trip_number
     OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
     OR NEW.delivery_route_id IS DISTINCT FROM OLD.delivery_route_id
     OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id
     OR NEW.primary_driver_id IS DISTINCT FROM OLD.primary_driver_id
     OR NEW.planned_start_at IS DISTINCT FROM OLD.planned_start_at
     OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.create_idempotency_key IS DISTINCT FROM OLD.create_idempotency_key
     OR NEW.create_payload_hash IS DISTINCT FROM OLD.create_payload_hash
     OR NEW.planned_at IS DISTINCT FROM OLD.planned_at
     OR NEW.planned_by IS DISTINCT FROM OLD.planned_by
     OR NEW.reopened_at IS DISTINCT FROM OLD.reopened_at
     OR NEW.reopened_by IS DISTINCT FROM OLD.reopened_by
     OR NEW.reopen_reason IS DISTINCT FROM OLD.reopen_reason
     OR NEW.locked_at IS DISTINCT FROM OLD.locked_at
     OR NEW.locked_by IS DISTINCT FROM OLD.locked_by
     OR NEW.dispatch_id IS DISTINCT FROM OLD.dispatch_id
     OR NEW.dispatch_idempotency_key IS DISTINCT FROM OLD.dispatch_idempotency_key
     OR NEW.dispatch_payload_hash IS DISTINCT FROM OLD.dispatch_payload_hash
     OR NEW.handover_receiver_name IS DISTINCT FROM OLD.handover_receiver_name
     OR NEW.handover_note IS DISTINCT FROM OLD.handover_note
     OR NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at
     OR NEW.dispatched_by IS DISTINCT FROM OLD.dispatched_by
     OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
     OR NEW.closed_by IS DISTINCT FROM OLD.closed_by
     OR NEW.close_note IS DISTINCT FROM OLD.close_note
     OR NEW.close_idempotency_key IS DISTINCT FROM OLD.close_idempotency_key
     OR NEW.close_payload_hash IS DISTINCT FROM OLD.close_payload_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'logistics_trip_recovery_cannot_rewrite_history';
  END IF;
  IF NEW.recovery_reason IS NULL OR btrim(NEW.recovery_reason) = ''
     OR NEW.recovery_idempotency_key IS NULL
     OR NEW.recovery_payload_hash IS NULL
     OR NEW.recovered_at IS NULL
     OR NEW.recovered_by IS NULL THEN
    RAISE EXCEPTION 'logistics_trip_recovery_fact_required';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_trips_recovery_guard ON logistics.delivery_trips;
CREATE TRIGGER delivery_trips_recovery_guard
BEFORE INSERT OR UPDATE OR DELETE ON logistics.delivery_trips
FOR EACH ROW
WHEN (current_setting('npp.logistics_write_context', true) = 'trip_recovery_service')
EXECUTE FUNCTION logistics.guard_trip_recovery_header_write();

-- Planning continues to own normal assignment writes. Recovery may only close one historical assignment.
DROP TRIGGER IF EXISTS trip_order_assignments_write_guard ON logistics.trip_order_assignments;
CREATE TRIGGER trip_order_assignments_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON logistics.trip_order_assignments
FOR EACH ROW
WHEN (current_setting('npp.logistics_write_context', true) IS DISTINCT FROM 'trip_recovery_service')
EXECUTE FUNCTION logistics.guard_trip_child_write();

CREATE OR REPLACE FUNCTION logistics.guard_trip_recovery_assignment_write()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  trip_record logistics.delivery_trips;
  issue_status text;
BEGIN
  IF current_setting('npp.logistics_write_context', true) IS DISTINCT FROM 'trip_recovery_service' THEN
    RAISE EXCEPTION 'logistics_recovery_unassign_requires_service_context';
  END IF;
  IF TG_OP <> 'UPDATE'
     OR OLD.unassigned_at IS NOT NULL
     OR NEW.unassigned_at IS NULL
     OR NEW.unassigned_by IS NULL
     OR NEW.unassignment_reason IS NULL
     OR btrim(NEW.unassignment_reason) = '' THEN
    RAISE EXCEPTION 'logistics_recovery_unassign_invalid';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.installation_id IS DISTINCT FROM OLD.installation_id
     OR NEW.trip_id IS DISTINCT FROM OLD.trip_id
     OR NEW.trip_stop_id IS DISTINCT FROM OLD.trip_stop_id
     OR NEW.delivery_order_id IS DISTINCT FROM OLD.delivery_order_id
     OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at
     OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by THEN
    RAISE EXCEPTION 'logistics_recovery_unassign_lineage_immutable';
  END IF;
  SELECT * INTO trip_record
    FROM logistics.delivery_trips
   WHERE installation_id = NEW.installation_id
     AND id = NEW.trip_id
   FOR UPDATE;
  IF NOT FOUND OR trip_record.status <> 'recovered' THEN
    RAISE EXCEPTION 'logistics_recovery_unassign_requires_recovered_trip';
  END IF;
  SELECT issue.status INTO issue_status
    FROM logistics.trip_dispatch_items dispatch_item
    JOIN sales.delivery_order_inventory_issues issue
      ON issue.installation_id = dispatch_item.installation_id
     AND issue.id = dispatch_item.inventory_issue_id
   WHERE dispatch_item.installation_id = NEW.installation_id
     AND dispatch_item.assignment_id = NEW.id;
  IF issue_status IS DISTINCT FROM 'REVERSED' THEN
    RAISE EXCEPTION 'logistics_recovery_unassign_requires_reversed_inventory_issue';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trip_order_assignments_recovery_guard ON logistics.trip_order_assignments;
CREATE TRIGGER trip_order_assignments_recovery_guard
BEFORE INSERT OR UPDATE OR DELETE ON logistics.trip_order_assignments
FOR EACH ROW
WHEN (current_setting('npp.logistics_write_context', true) = 'trip_recovery_service')
EXECUTE FUNCTION logistics.guard_trip_recovery_assignment_write();
