-- Phase 6E.4: driver-owned delivery attempts for dispatched trips.
-- No POD/GPS/R2, COD/accounting, Inventory IN, reversal or production operation.

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES
  ('core.delivery-attempt.read', 'Giao hàng', 'Xem kết quả lần giao',
   'Cho phép đọc kết quả lần giao trong phạm vi chuyến và kho được cấp quyền.', true, now()),
  ('core.delivery-attempt.record', 'Giao hàng', 'Ghi kết quả lần giao',
   'Cho phép tài xế được xác thực ghi đúng một kết quả terminal cho assignment thuộc chuyến của mình.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS logistics.delivery_attempts (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  trip_id uuid NOT NULL,
  trip_stop_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  delivery_order_id uuid NOT NULL,
  dispatch_item_id uuid NOT NULL,
  inventory_issue_id uuid NOT NULL,
  driver_profile_id uuid NOT NULL,
  result text NOT NULL CHECK (result IN (
    'delivered_full', 'delivered_partial', 'failed', 'rescheduled'
  )),
  attempted_at timestamptz NOT NULL,
  reason_code text NULL CHECK (
    reason_code IS NULL OR reason_code ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'
  ),
  note text NULL CHECK (note IS NULL OR char_length(note) <= 2000),
  rescheduled_for timestamptz NULL,
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 1 AND 128
    AND idempotency_key ~ '^[A-Za-z0-9._:-]+$'
  ),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT delivery_attempts_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT delivery_attempts_assignment_unique UNIQUE (installation_id, assignment_id),
  CONSTRAINT delivery_attempts_idempotency_unique UNIQUE (installation_id, idempotency_key),
  CONSTRAINT delivery_attempts_trip_fk
    FOREIGN KEY (installation_id, trip_id)
    REFERENCES logistics.delivery_trips (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_attempts_stop_fk
    FOREIGN KEY (installation_id, trip_stop_id)
    REFERENCES logistics.trip_stops (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_attempts_assignment_fk
    FOREIGN KEY (installation_id, assignment_id)
    REFERENCES logistics.trip_order_assignments (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_attempts_delivery_order_fk
    FOREIGN KEY (installation_id, delivery_order_id)
    REFERENCES sales.delivery_orders (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_attempts_dispatch_item_fk
    FOREIGN KEY (installation_id, dispatch_item_id)
    REFERENCES logistics.trip_dispatch_items (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_attempts_inventory_issue_fk
    FOREIGN KEY (installation_id, inventory_issue_id)
    REFERENCES sales.delivery_order_inventory_issues (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_attempts_driver_fk
    FOREIGN KEY (installation_id, driver_profile_id)
    REFERENCES logistics.driver_profiles (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_attempts_result_shape CHECK (
    (result IN ('delivered_full', 'delivered_partial')
      AND reason_code IS NULL
      AND rescheduled_for IS NULL)
    OR (result = 'failed'
      AND reason_code IS NOT NULL
      AND rescheduled_for IS NULL)
    OR (result = 'rescheduled'
      AND reason_code IS NOT NULL
      AND rescheduled_for IS NOT NULL
      AND rescheduled_for > attempted_at)
  )
);

CREATE INDEX IF NOT EXISTS delivery_attempts_trip_idx
  ON logistics.delivery_attempts (installation_id, trip_id, attempted_at, id);
CREATE INDEX IF NOT EXISTS delivery_attempts_delivery_order_idx
  ON logistics.delivery_attempts (installation_id, delivery_order_id, attempted_at, id);

CREATE TABLE IF NOT EXISTS logistics.delivery_attempt_lines (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  attempt_id uuid NOT NULL,
  delivery_order_line_id uuid NOT NULL,
  inventory_issue_line_id uuid NOT NULL,
  issued_base_quantity numeric(30,12) NOT NULL CHECK (issued_base_quantity > 0),
  delivered_base_quantity numeric(30,12) NOT NULL CHECK (
    delivered_base_quantity >= 0
    AND delivered_base_quantity <= issued_base_quantity
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT delivery_attempt_lines_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT delivery_attempt_lines_attempt_line_unique UNIQUE (
    installation_id, attempt_id, inventory_issue_line_id
  ),
  CONSTRAINT delivery_attempt_lines_attempt_fk
    FOREIGN KEY (installation_id, attempt_id)
    REFERENCES logistics.delivery_attempts (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_attempt_lines_delivery_line_fk
    FOREIGN KEY (installation_id, delivery_order_line_id)
    REFERENCES sales.delivery_order_lines (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_attempt_lines_issue_line_fk
    FOREIGN KEY (installation_id, inventory_issue_line_id)
    REFERENCES sales.delivery_order_inventory_issue_lines (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS delivery_attempt_lines_attempt_idx
  ON logistics.delivery_attempt_lines (installation_id, attempt_id, inventory_issue_line_id);

ALTER TABLE logistics.trip_events
  DROP CONSTRAINT IF EXISTS trip_events_event_type_check;
ALTER TABLE logistics.trip_events
  ADD CONSTRAINT trip_events_event_type_check CHECK (event_type IN (
    'CREATED', 'UPDATED', 'ASSIGNED', 'UNASSIGNED', 'REORDERED',
    'PLANNED', 'REOPENED', 'LOCKED', 'DISPATCHED', 'DELIVERY_ATTEMPT_RECORDED'
  ));

CREATE OR REPLACE FUNCTION logistics.guard_delivery_attempt_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.logistics_write_context', true);
  lineage record;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'delivery_attempts_are_immutable';
  END IF;
  IF write_context IS DISTINCT FROM 'delivery_attempt_service' THEN
    RAISE EXCEPTION 'delivery_attempt_requires_service_context';
  END IF;

  SELECT trip.status AS trip_status,
         trip.primary_driver_id,
         assignment.trip_id AS assignment_trip_id,
         assignment.trip_stop_id AS assignment_stop_id,
         assignment.delivery_order_id AS assignment_delivery_order_id,
         assignment.unassigned_at,
         item.id AS dispatch_item_id,
         item.inventory_issue_id,
         issue.status AS inventory_issue_status
    INTO lineage
    FROM logistics.delivery_trips trip
    JOIN logistics.trip_order_assignments assignment
      ON assignment.installation_id = trip.installation_id
     AND assignment.id = NEW.assignment_id
    JOIN logistics.trip_dispatch_items item
      ON item.installation_id = assignment.installation_id
     AND item.assignment_id = assignment.id
    JOIN sales.delivery_order_inventory_issues issue
      ON issue.installation_id = item.installation_id
     AND issue.id = item.inventory_issue_id
   WHERE trip.installation_id = NEW.installation_id
     AND trip.id = NEW.trip_id
   FOR UPDATE OF trip, assignment, issue;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'delivery_attempt_lineage_not_found';
  END IF;
  IF lineage.trip_status <> 'dispatched'
     OR lineage.primary_driver_id IS DISTINCT FROM NEW.driver_profile_id
     OR lineage.assignment_trip_id IS DISTINCT FROM NEW.trip_id
     OR lineage.assignment_stop_id IS DISTINCT FROM NEW.trip_stop_id
     OR lineage.assignment_delivery_order_id IS DISTINCT FROM NEW.delivery_order_id
     OR lineage.unassigned_at IS NOT NULL
     OR lineage.dispatch_item_id IS DISTINCT FROM NEW.dispatch_item_id
     OR lineage.inventory_issue_id IS DISTINCT FROM NEW.inventory_issue_id
     OR lineage.inventory_issue_status <> 'POSTED' THEN
    RAISE EXCEPTION 'delivery_attempt_lineage_mismatch';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_attempts_write_guard ON logistics.delivery_attempts;
CREATE TRIGGER delivery_attempts_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON logistics.delivery_attempts
FOR EACH ROW EXECUTE FUNCTION logistics.guard_delivery_attempt_write();

CREATE OR REPLACE FUNCTION logistics.guard_delivery_attempt_line_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.logistics_write_context', true);
  source record;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'delivery_attempt_lines_are_immutable';
  END IF;
  IF write_context IS DISTINCT FROM 'delivery_attempt_service' THEN
    RAISE EXCEPTION 'delivery_attempt_line_requires_service_context';
  END IF;

  SELECT attempt.result,
         attempt.delivery_order_id,
         attempt.inventory_issue_id,
         issue_line.delivery_order_line_id,
         issue_line.issued_base_quantity
    INTO source
    FROM logistics.delivery_attempts attempt
    JOIN sales.delivery_order_inventory_issue_lines issue_line
      ON issue_line.installation_id = attempt.installation_id
     AND issue_line.id = NEW.inventory_issue_line_id
   WHERE attempt.installation_id = NEW.installation_id
     AND attempt.id = NEW.attempt_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'delivery_attempt_line_source_not_found';
  END IF;
  IF source.result NOT IN ('delivered_full', 'delivered_partial')
     OR source.delivery_order_id IS DISTINCT FROM (
       SELECT line.delivery_order_id
         FROM sales.delivery_order_lines line
        WHERE line.installation_id = NEW.installation_id
          AND line.id = NEW.delivery_order_line_id
     )
     OR source.inventory_issue_id IS DISTINCT FROM (
       SELECT issue_line.issue_id
         FROM sales.delivery_order_inventory_issue_lines issue_line
        WHERE issue_line.installation_id = NEW.installation_id
          AND issue_line.id = NEW.inventory_issue_line_id
     )
     OR source.delivery_order_line_id IS DISTINCT FROM NEW.delivery_order_line_id
     OR source.issued_base_quantity IS DISTINCT FROM NEW.issued_base_quantity THEN
    RAISE EXCEPTION 'delivery_attempt_line_source_mismatch';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_attempt_lines_write_guard ON logistics.delivery_attempt_lines;
CREATE TRIGGER delivery_attempt_lines_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON logistics.delivery_attempt_lines
FOR EACH ROW EXECUTE FUNCTION logistics.guard_delivery_attempt_line_write();

CREATE OR REPLACE FUNCTION logistics.validate_delivery_attempt_shape()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_line_count bigint;
  attempt_line_count bigint;
  source_total numeric(30,12);
  delivered_total numeric(30,12);
  non_full_line_count bigint;
BEGIN
  SELECT count(*), COALESCE(sum(issue_line.issued_base_quantity), 0)
    INTO source_line_count, source_total
    FROM sales.delivery_order_inventory_issue_lines issue_line
   WHERE issue_line.installation_id = NEW.installation_id
     AND issue_line.issue_id = NEW.inventory_issue_id;

  SELECT count(*), COALESCE(sum(line.delivered_base_quantity), 0),
         count(*) FILTER (WHERE line.delivered_base_quantity <> line.issued_base_quantity)
    INTO attempt_line_count, delivered_total, non_full_line_count
    FROM logistics.delivery_attempt_lines line
   WHERE line.installation_id = NEW.installation_id
     AND line.attempt_id = NEW.id;

  IF source_line_count = 0 THEN
    RAISE EXCEPTION 'delivery_attempt_issue_lines_required';
  END IF;

  IF NEW.result = 'delivered_full' THEN
    IF attempt_line_count <> source_line_count OR non_full_line_count <> 0 THEN
      RAISE EXCEPTION 'delivery_attempt_full_quantity_mismatch';
    END IF;
  ELSIF NEW.result = 'delivered_partial' THEN
    IF attempt_line_count <> source_line_count
       OR delivered_total <= 0
       OR delivered_total >= source_total THEN
      RAISE EXCEPTION 'delivery_attempt_partial_quantity_mismatch';
    END IF;
  ELSIF attempt_line_count <> 0 THEN
    RAISE EXCEPTION 'delivery_attempt_non_delivery_has_lines';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS delivery_attempt_shape_guard ON logistics.delivery_attempts;
CREATE CONSTRAINT TRIGGER delivery_attempt_shape_guard
AFTER INSERT ON logistics.delivery_attempts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION logistics.validate_delivery_attempt_shape();
