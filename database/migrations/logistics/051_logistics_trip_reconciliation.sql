-- Phase 6E.5: explicit warehouse receipt of undelivered trip stock and trip close.
-- No POD, GPS, COD, accounting, automatic redelivery or production operation.

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES
  ('core.delivery-trip.reconciliation-read', 'Đối soát giao hàng', 'Xem đối soát cuối chuyến',
   'Cho phép đọc số đã xuất, đã giao, đã nhận lại và còn trên xe trong phạm vi kho.', true, now()),
  ('core.delivery-trip.return-receive', 'Đối soát giao hàng', 'Nhận hàng chưa giao về kho',
   'Cho phép kho xác nhận thực nhận hàng chưa giao và ghi Inventory IN theo exact issue-line lineage.', true, now()),
  ('core.delivery-trip.close', 'Đối soát giao hàng', 'Đóng chuyến đã đối soát',
   'Cho phép đóng chuyến khi mọi phiếu có kết quả và toàn bộ hàng đã giao hoặc đã nhận lại kho.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

ALTER TABLE logistics.delivery_trips
  ADD COLUMN IF NOT EXISTS closed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS closed_by text NULL,
  ADD COLUMN IF NOT EXISTS close_note text NULL,
  ADD COLUMN IF NOT EXISTS close_idempotency_key text NULL,
  ADD COLUMN IF NOT EXISTS close_payload_hash text NULL;

ALTER TABLE logistics.delivery_trips
  DROP CONSTRAINT IF EXISTS delivery_trips_status_check,
  DROP CONSTRAINT IF EXISTS delivery_trips_closed_by_check,
  DROP CONSTRAINT IF EXISTS delivery_trips_close_note_check,
  DROP CONSTRAINT IF EXISTS delivery_trips_close_idempotency_key_check,
  DROP CONSTRAINT IF EXISTS delivery_trips_close_payload_hash_check,
  DROP CONSTRAINT IF EXISTS delivery_trips_closed_shape;

ALTER TABLE logistics.delivery_trips
  ADD CONSTRAINT delivery_trips_status_check
    CHECK (status IN ('draft', 'planned', 'locked', 'dispatched', 'closed')),
  ADD CONSTRAINT delivery_trips_closed_by_check
    CHECK (closed_by IS NULL OR char_length(closed_by) BETWEEN 1 AND 128),
  ADD CONSTRAINT delivery_trips_close_note_check
    CHECK (close_note IS NULL OR char_length(close_note) <= 2000),
  ADD CONSTRAINT delivery_trips_close_idempotency_key_check
    CHECK (close_idempotency_key IS NULL OR char_length(close_idempotency_key) BETWEEN 1 AND 128),
  ADD CONSTRAINT delivery_trips_close_payload_hash_check
    CHECK (close_payload_hash IS NULL OR close_payload_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT delivery_trips_closed_shape CHECK (
    status <> 'closed'
    OR (
      closed_at IS NOT NULL
      AND closed_by IS NOT NULL
      AND close_idempotency_key IS NOT NULL
      AND close_payload_hash IS NOT NULL
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS delivery_trips_close_idempotency_unique
  ON logistics.delivery_trips (installation_id, close_idempotency_key)
  WHERE close_idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS logistics.trip_return_receipts (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  trip_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'POSTING' CHECK (status IN ('POSTING', 'POSTED')),
  inventory_movement_id uuid NULL,
  received_at timestamptz NOT NULL,
  note text NULL CHECK (note IS NULL OR char_length(note) <= 2000),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT trip_return_receipts_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT trip_return_receipts_idempotency_unique UNIQUE (installation_id, idempotency_key),
  CONSTRAINT trip_return_receipts_trip_fk
    FOREIGN KEY (installation_id, trip_id)
    REFERENCES logistics.delivery_trips (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT trip_return_receipts_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT trip_return_receipts_movement_fk
    FOREIGN KEY (installation_id, inventory_movement_id)
    REFERENCES inventory.inventory_movements (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT trip_return_receipts_posted_shape CHECK (
    status <> 'POSTED' OR inventory_movement_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS trip_return_receipts_trip_idx
  ON logistics.trip_return_receipts (installation_id, trip_id, received_at, id);

CREATE TABLE IF NOT EXISTS logistics.trip_return_receipt_lines (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  receipt_id uuid NOT NULL,
  trip_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  inventory_issue_line_id uuid NOT NULL,
  inventory_movement_line_id uuid NULL,
  returned_base_quantity numeric(30,12) NOT NULL CHECK (returned_base_quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT trip_return_receipt_lines_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT trip_return_receipt_lines_source_unique UNIQUE (installation_id, receipt_id, inventory_issue_line_id),
  CONSTRAINT trip_return_receipt_lines_receipt_fk
    FOREIGN KEY (installation_id, receipt_id)
    REFERENCES logistics.trip_return_receipts (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT trip_return_receipt_lines_trip_fk
    FOREIGN KEY (installation_id, trip_id)
    REFERENCES logistics.delivery_trips (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT trip_return_receipt_lines_assignment_fk
    FOREIGN KEY (installation_id, assignment_id)
    REFERENCES logistics.trip_order_assignments (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT trip_return_receipt_lines_attempt_fk
    FOREIGN KEY (installation_id, attempt_id)
    REFERENCES logistics.delivery_attempts (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT trip_return_receipt_lines_issue_line_fk
    FOREIGN KEY (installation_id, inventory_issue_line_id)
    REFERENCES sales.delivery_order_inventory_issue_lines (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT trip_return_receipt_lines_movement_line_fk
    FOREIGN KEY (installation_id, inventory_movement_line_id)
    REFERENCES inventory.inventory_movement_lines (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS trip_return_receipt_lines_trip_idx
  ON logistics.trip_return_receipt_lines (installation_id, trip_id, assignment_id, inventory_issue_line_id);

CREATE OR REPLACE FUNCTION logistics.guard_trip_return_receipt_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.logistics_write_context', true);
BEGIN
  IF write_context IS DISTINCT FROM 'trip_reconciliation_service' THEN
    RAISE EXCEPTION 'logistics_trip_return_receipt_requires_service_context';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'logistics_trip_return_receipt_immutable';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'POSTING'
       OR NEW.status <> 'POSTED'
       OR NEW.inventory_movement_id IS NULL
       OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.installation_id IS DISTINCT FROM OLD.installation_id
       OR NEW.trip_id IS DISTINCT FROM OLD.trip_id
       OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
       OR NEW.received_at IS DISTINCT FROM OLD.received_at
       OR NEW.note IS DISTINCT FROM OLD.note
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
       OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
       OR NEW.request_id IS DISTINCT FROM OLD.request_id
       OR NEW.source_app IS DISTINCT FROM OLD.source_app
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'logistics_trip_return_receipt_immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trip_return_receipts_write_guard ON logistics.trip_return_receipts;
CREATE TRIGGER trip_return_receipts_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON logistics.trip_return_receipts
FOR EACH ROW EXECUTE FUNCTION logistics.guard_trip_return_receipt_write();

CREATE OR REPLACE FUNCTION logistics.guard_trip_return_receipt_line_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.logistics_write_context', true);
  receipt_record logistics.trip_return_receipts;
  attempt_record logistics.delivery_attempts;
  assignment_record logistics.trip_order_assignments;
  dispatch_record logistics.trip_dispatch_items;
  issue_line_record sales.delivery_order_inventory_issue_lines;
  delivered_quantity numeric(30,12);
  already_returned numeric(30,12);
BEGIN
  IF write_context IS DISTINCT FROM 'trip_reconciliation_service' THEN
    RAISE EXCEPTION 'logistics_trip_return_receipt_line_requires_service_context';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'logistics_trip_return_receipt_line_immutable';
  END IF;

  SELECT * INTO receipt_record
    FROM logistics.trip_return_receipts
   WHERE installation_id = COALESCE(NEW.installation_id, OLD.installation_id)
     AND id = COALESCE(NEW.receipt_id, OLD.receipt_id)
   FOR UPDATE;
  IF NOT FOUND OR receipt_record.status <> 'POSTING' THEN
    RAISE EXCEPTION 'logistics_trip_return_receipt_not_posting';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.installation_id IS DISTINCT FROM OLD.installation_id
       OR NEW.receipt_id IS DISTINCT FROM OLD.receipt_id
       OR NEW.trip_id IS DISTINCT FROM OLD.trip_id
       OR NEW.assignment_id IS DISTINCT FROM OLD.assignment_id
       OR NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
       OR NEW.inventory_issue_line_id IS DISTINCT FROM OLD.inventory_issue_line_id
       OR NEW.returned_base_quantity IS DISTINCT FROM OLD.returned_base_quantity
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR OLD.inventory_movement_line_id IS NOT NULL
       OR NEW.inventory_movement_line_id IS NULL THEN
      RAISE EXCEPTION 'logistics_trip_return_receipt_line_immutable';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO assignment_record
    FROM logistics.trip_order_assignments
   WHERE installation_id = NEW.installation_id
     AND id = NEW.assignment_id
     AND trip_id = NEW.trip_id
     AND unassigned_at IS NULL;
  SELECT * INTO attempt_record
    FROM logistics.delivery_attempts
   WHERE installation_id = NEW.installation_id
     AND id = NEW.attempt_id
     AND assignment_id = NEW.assignment_id
     AND trip_id = NEW.trip_id;
  SELECT * INTO dispatch_record
    FROM logistics.trip_dispatch_items
   WHERE installation_id = NEW.installation_id
     AND assignment_id = NEW.assignment_id
     AND trip_id = NEW.trip_id;
  SELECT * INTO issue_line_record
    FROM sales.delivery_order_inventory_issue_lines
   WHERE installation_id = NEW.installation_id
     AND id = NEW.inventory_issue_line_id
   FOR UPDATE;

  IF assignment_record IS NULL
     OR attempt_record IS NULL
     OR dispatch_record IS NULL
     OR issue_line_record IS NULL
     OR receipt_record.trip_id IS DISTINCT FROM NEW.trip_id
     OR issue_line_record.issue_id IS DISTINCT FROM dispatch_record.inventory_issue_id THEN
    RAISE EXCEPTION 'logistics_trip_return_receipt_lineage_mismatch';
  END IF;

  SELECT COALESCE(sum(line.delivered_base_quantity), 0)::numeric(30,12)
    INTO delivered_quantity
    FROM logistics.delivery_attempt_lines line
   WHERE line.installation_id = NEW.installation_id
     AND line.attempt_id = NEW.attempt_id
     AND line.inventory_issue_line_id = NEW.inventory_issue_line_id;

  SELECT COALESCE(sum(line.returned_base_quantity), 0)::numeric(30,12)
    INTO already_returned
    FROM logistics.trip_return_receipt_lines line
    JOIN logistics.trip_return_receipts receipt
      ON receipt.installation_id = line.installation_id
     AND receipt.id = line.receipt_id
   WHERE line.installation_id = NEW.installation_id
     AND line.inventory_issue_line_id = NEW.inventory_issue_line_id
     AND receipt.status = 'POSTED';

  IF delivered_quantity + already_returned + NEW.returned_base_quantity > issue_line_record.issued_base_quantity THEN
    RAISE EXCEPTION 'logistics_trip_return_quantity_exceeds_outstanding';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trip_return_receipt_lines_write_guard ON logistics.trip_return_receipt_lines;
CREATE TRIGGER trip_return_receipt_lines_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON logistics.trip_return_receipt_lines
FOR EACH ROW EXECUTE FUNCTION logistics.guard_trip_return_receipt_line_write();

ALTER TABLE logistics.trip_events
  DROP CONSTRAINT IF EXISTS trip_events_event_type_check;
ALTER TABLE logistics.trip_events
  ADD CONSTRAINT trip_events_event_type_check CHECK (event_type IN (
    'CREATED', 'UPDATED', 'ASSIGNED', 'UNASSIGNED', 'REORDERED',
    'PLANNED', 'REOPENED', 'LOCKED', 'DISPATCHED',
    'DELIVERY_ATTEMPT_RECORDED', 'RETURN_RECEIPT_POSTED', 'CLOSED'
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
  IF write_context NOT IN ('trip_planning_service', 'trip_dispatch_service', 'trip_reconciliation_service') THEN
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
        OR (OLD.status = 'dispatched' AND NEW.status = 'closed' AND write_context = 'trip_reconciliation_service')
      ) THEN
        RAISE EXCEPTION 'logistics_trip_invalid_transition';
      END IF;
    END IF;
    IF write_context = 'trip_planning_service' AND OLD.status IN ('locked', 'dispatched', 'closed') THEN
      RAISE EXCEPTION 'logistics_trip_locked';
    END IF;
    IF OLD.status = 'dispatched'
       AND NOT (write_context = 'trip_reconciliation_service' AND NEW.status = 'closed') THEN
      RAISE EXCEPTION 'logistics_trip_dispatched';
    END IF;
    IF OLD.status = 'closed' THEN
      RAISE EXCEPTION 'logistics_trip_closed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION logistics.guard_trip_close_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  missing_attempts bigint;
  posting_receipts bigint;
  unreconciled_lines bigint;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'dispatched' AND NEW.status = 'closed' THEN
    SELECT count(*) INTO missing_attempts
      FROM logistics.trip_order_assignments assignment
      LEFT JOIN logistics.delivery_attempts attempt
        ON attempt.installation_id = assignment.installation_id
       AND attempt.assignment_id = assignment.id
     WHERE assignment.installation_id = NEW.installation_id
       AND assignment.trip_id = NEW.id
       AND assignment.unassigned_at IS NULL
       AND attempt.id IS NULL;
    IF missing_attempts > 0 THEN
      RAISE EXCEPTION 'logistics_trip_close_missing_attempts';
    END IF;

    SELECT count(*) INTO posting_receipts
      FROM logistics.trip_return_receipts receipt
     WHERE receipt.installation_id = NEW.installation_id
       AND receipt.trip_id = NEW.id
       AND receipt.status = 'POSTING';
    IF posting_receipts > 0 THEN
      RAISE EXCEPTION 'logistics_trip_close_receipt_posting';
    END IF;

    SELECT count(*) INTO unreconciled_lines
      FROM logistics.trip_dispatch_items dispatch_item
      JOIN sales.delivery_order_inventory_issue_lines issue_line
        ON issue_line.installation_id = dispatch_item.installation_id
       AND issue_line.issue_id = dispatch_item.inventory_issue_id
      JOIN logistics.delivery_attempts attempt
        ON attempt.installation_id = dispatch_item.installation_id
       AND attempt.assignment_id = dispatch_item.assignment_id
     WHERE dispatch_item.installation_id = NEW.installation_id
       AND dispatch_item.trip_id = NEW.id
       AND issue_line.issued_base_quantity IS DISTINCT FROM (
         COALESCE((
           SELECT sum(attempt_line.delivered_base_quantity)
             FROM logistics.delivery_attempt_lines attempt_line
            WHERE attempt_line.installation_id = issue_line.installation_id
              AND attempt_line.attempt_id = attempt.id
              AND attempt_line.inventory_issue_line_id = issue_line.id
         ), 0)
         + COALESCE((
           SELECT sum(receipt_line.returned_base_quantity)
             FROM logistics.trip_return_receipt_lines receipt_line
             JOIN logistics.trip_return_receipts receipt
               ON receipt.installation_id = receipt_line.installation_id
              AND receipt.id = receipt_line.receipt_id
            WHERE receipt_line.installation_id = issue_line.installation_id
              AND receipt_line.inventory_issue_line_id = issue_line.id
              AND receipt.status = 'POSTED'
         ), 0)
       );
    IF unreconciled_lines > 0 THEN
      RAISE EXCEPTION 'logistics_trip_close_unreconciled_stock';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_trips_close_reconciliation_guard ON logistics.delivery_trips;
CREATE TRIGGER delivery_trips_close_reconciliation_guard
BEFORE UPDATE OF status ON logistics.delivery_trips
FOR EACH ROW EXECUTE FUNCTION logistics.guard_trip_close_reconciliation();
