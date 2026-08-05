-- Phase 6E.6: optional proof of delivery attached to immutable delivery attempts.
-- POD is never required to record a delivery result. No policy engine, OTP verification,
-- signature canvas, live GPS, COD/accounting or production operation.

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES
  ('core.pod.read', 'Giao hàng', 'Xem bằng chứng giao hàng',
   'Cho phép đọc POD gắn với delivery attempt trong phạm vi tài xế hoặc kho được cấp quyền.', true, now()),
  ('core.pod.attach', 'Giao hàng', 'Đính kèm bằng chứng giao hàng',
   'Cho phép tài xế đã xác thực đính kèm POD tùy chọn vào delivery attempt thuộc chuyến của mình.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS logistics.delivery_attempt_proofs (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  delivery_attempt_id uuid NOT NULL,
  trip_id uuid NOT NULL,
  trip_stop_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  delivery_order_id uuid NOT NULL,
  driver_profile_id uuid NOT NULL,
  pod_type text NOT NULL CHECK (pod_type IN ('photo', 'signature', 'otp', 'manual_confirm')),
  object_key text NULL CHECK (object_key IS NULL OR char_length(object_key) BETWEEN 1 AND 1024),
  original_filename text NULL CHECK (original_filename IS NULL OR char_length(original_filename) BETWEEN 1 AND 180),
  content_type text NULL CHECK (content_type IS NULL OR char_length(content_type) BETWEEN 1 AND 128),
  byte_size bigint NULL CHECK (byte_size IS NULL OR byte_size > 0),
  checksum_sha256 text NULL CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$'),
  receiver_name text NULL CHECK (receiver_name IS NULL OR char_length(receiver_name) BETWEEN 1 AND 200),
  confirmation_reference text NULL CHECK (
    confirmation_reference IS NULL OR char_length(confirmation_reference) BETWEEN 1 AND 200
  ),
  note text NULL CHECK (note IS NULL OR char_length(note) <= 2000),
  captured_at timestamptz NOT NULL,
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 1 AND 128
    AND idempotency_key ~ '^[A-Za-z0-9._-]+$'
  ),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT delivery_attempt_proofs_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT delivery_attempt_proofs_idempotency_unique UNIQUE (installation_id, idempotency_key),
  CONSTRAINT delivery_attempt_proofs_attempt_fk
    FOREIGN KEY (installation_id, delivery_attempt_id)
    REFERENCES logistics.delivery_attempts (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_attempt_proofs_trip_fk
    FOREIGN KEY (installation_id, trip_id)
    REFERENCES logistics.delivery_trips (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_attempt_proofs_stop_fk
    FOREIGN KEY (installation_id, trip_stop_id)
    REFERENCES logistics.trip_stops (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_attempt_proofs_assignment_fk
    FOREIGN KEY (installation_id, assignment_id)
    REFERENCES logistics.trip_order_assignments (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_attempt_proofs_delivery_order_fk
    FOREIGN KEY (installation_id, delivery_order_id)
    REFERENCES sales.delivery_orders (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_attempt_proofs_driver_fk
    FOREIGN KEY (installation_id, driver_profile_id)
    REFERENCES logistics.driver_profiles (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT delivery_attempt_proofs_shape CHECK (
    (
      pod_type = 'photo'
      AND object_key IS NOT NULL
      AND original_filename IS NOT NULL
      AND content_type IS NOT NULL
      AND byte_size IS NOT NULL
      AND checksum_sha256 IS NOT NULL
    )
    OR (
      pod_type <> 'photo'
      AND object_key IS NULL
      AND original_filename IS NULL
      AND content_type IS NULL
      AND byte_size IS NULL
      AND checksum_sha256 IS NULL
    )
  ),
  CONSTRAINT delivery_attempt_proofs_evidence_shape CHECK (
    (pod_type = 'photo')
    OR (pod_type = 'signature' AND (receiver_name IS NOT NULL OR confirmation_reference IS NOT NULL))
    OR (pod_type = 'otp' AND confirmation_reference IS NOT NULL)
    OR (pod_type = 'manual_confirm' AND (receiver_name IS NOT NULL OR note IS NOT NULL))
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS delivery_attempt_proofs_object_key_unique
  ON logistics.delivery_attempt_proofs (installation_id, object_key)
  WHERE object_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS delivery_attempt_proofs_attempt_idx
  ON logistics.delivery_attempt_proofs (
    installation_id, delivery_attempt_id, captured_at, id
  );

CREATE OR REPLACE FUNCTION logistics.guard_delivery_attempt_proof_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.logistics_write_context', true);
  attempt_record logistics.delivery_attempts;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'delivery_attempt_proofs_are_immutable';
  END IF;
  IF write_context IS DISTINCT FROM 'proof_of_delivery_service' THEN
    RAISE EXCEPTION 'delivery_attempt_proof_requires_service_context';
  END IF;

  SELECT * INTO attempt_record
    FROM logistics.delivery_attempts
   WHERE installation_id = NEW.installation_id
     AND id = NEW.delivery_attempt_id;

  IF NOT FOUND
     OR attempt_record.trip_id IS DISTINCT FROM NEW.trip_id
     OR attempt_record.trip_stop_id IS DISTINCT FROM NEW.trip_stop_id
     OR attempt_record.assignment_id IS DISTINCT FROM NEW.assignment_id
     OR attempt_record.delivery_order_id IS DISTINCT FROM NEW.delivery_order_id
     OR attempt_record.driver_profile_id IS DISTINCT FROM NEW.driver_profile_id THEN
    RAISE EXCEPTION 'delivery_attempt_proof_lineage_mismatch';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_attempt_proofs_write_guard ON logistics.delivery_attempt_proofs;
CREATE TRIGGER delivery_attempt_proofs_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON logistics.delivery_attempt_proofs
FOR EACH ROW EXECUTE FUNCTION logistics.guard_delivery_attempt_proof_write();

ALTER TABLE logistics.trip_events
  DROP CONSTRAINT IF EXISTS trip_events_event_type_check;
ALTER TABLE logistics.trip_events
  ADD CONSTRAINT trip_events_event_type_check CHECK (event_type IN (
    'CREATED', 'UPDATED', 'ASSIGNED', 'UNASSIGNED', 'REORDERED',
    'PLANNED', 'REOPENED', 'LOCKED', 'DISPATCHED',
    'DELIVERY_ATTEMPT_RECORDED', 'RETURN_RECEIPT_POSTED', 'CLOSED',
    'POD_ATTACHED'
  ));
