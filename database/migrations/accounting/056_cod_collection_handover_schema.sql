-- Phase 6F.4: COD collection, driver cash custody, handover and company reconciliation.
-- Customer settlement and internal cash custody are separate axes. Cash collected by
-- a driver may settle the customer immediately while remaining pending handover.

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES
  ('core.cod-collection.read', 'COD giao hàng', 'Xem tiền COD theo chuyến', 'Cho phép đọc tiền COD và số tiền tài xế đang giữ trong đúng phạm vi chuyến/kho.', true, now()),
  ('core.cod-collection.record', 'COD giao hàng', 'Ghi nhận tiền COD đã thu', 'Cho phép tài xế ghi tiền thực thu hoặc lời hẹn của đúng phiếu giao được giao.', true, now()),
  ('core.cod-handover.read', 'COD giao hàng', 'Xem bàn giao tiền COD', 'Cho phép đọc các lần bàn giao tiền COD trong phạm vi được cấp.', true, now()),
  ('core.cod-handover.create', 'COD giao hàng', 'Lập bàn giao tiền COD', 'Cho phép tài xế lập bàn giao tiền mặt COD theo exact collection lineage.', true, now()),
  ('core.cod-reconciliation.read', 'Đối soát COD', 'Xem đối soát tiền COD', 'Cho phép kế toán/thu ngân đọc collection, bàn giao, tiền thực nhận và chênh lệch COD.', true, now()),
  ('core.cod-reconciliation.accept', 'Đối soát COD', 'Xác nhận tiền COD công ty nhận', 'Cho phép kế toán/thu ngân xác nhận số tiền thực nhận và trạng thái đối soát COD.', true, now()),
  ('core.cod-adjustment.create', 'Đối soát COD', 'Đảo hoặc điều chỉnh COD', 'Cho phép tạo reversal/adjustment append-only cho collection, bàn giao hoặc xác nhận COD.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS accounting.cod_collections (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  warehouse_id uuid NOT NULL,
  trip_id uuid NOT NULL,
  trip_stop_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  delivery_attempt_id uuid NOT NULL,
  delivery_order_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  source_receivable_document_id uuid NOT NULL,
  payment_document_id uuid NULL,
  collection_method text NOT NULL CHECK (collection_method IN ('CASH', 'BANK_TRANSFER', 'NONE')),
  collection_status text NOT NULL CHECK (collection_status IN (
    'collected_full', 'collected_partial', 'collected_excess', 'not_collected'
  )),
  currency_code text NOT NULL CHECK (char_length(currency_code) = 3 AND currency_code = upper(currency_code)),
  expected_amount numeric(20,6) NOT NULL CHECK (expected_amount >= 0),
  received_amount numeric(20,6) NOT NULL CHECK (received_amount >= 0),
  external_reference text NULL CHECK (
    external_reference IS NULL OR char_length(btrim(external_reference)) BETWEEN 1 AND 256
  ),
  reason_code text NULL CHECK (
    reason_code IS NULL OR reason_code ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'
  ),
  promised_by text NULL CHECK (
    promised_by IS NULL OR char_length(btrim(promised_by)) BETWEEN 1 AND 256
  ),
  due_at timestamptz NULL,
  note text NULL CHECK (note IS NULL OR char_length(note) <= 2000),
  collected_at timestamptz NOT NULL,
  driver_profile_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT cod_collections_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT cod_collections_assignment_unique UNIQUE (installation_id, assignment_id),
  CONSTRAINT cod_collections_attempt_unique UNIQUE (installation_id, delivery_attempt_id),
  CONSTRAINT cod_collections_idempotency_unique UNIQUE (installation_id, idempotency_key),
  CONSTRAINT cod_collections_warehouse_fk FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT cod_collections_trip_fk FOREIGN KEY (installation_id, trip_id)
    REFERENCES logistics.delivery_trips (installation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT cod_collections_stop_fk FOREIGN KEY (installation_id, trip_stop_id)
    REFERENCES logistics.trip_stops (installation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT cod_collections_assignment_fk FOREIGN KEY (installation_id, assignment_id)
    REFERENCES logistics.trip_order_assignments (installation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT cod_collections_attempt_fk FOREIGN KEY (installation_id, delivery_attempt_id)
    REFERENCES logistics.delivery_attempts (installation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT cod_collections_delivery_order_fk FOREIGN KEY (installation_id, delivery_order_id)
    REFERENCES sales.delivery_orders (installation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT cod_collections_customer_fk FOREIGN KEY (installation_id, customer_id)
    REFERENCES shared.customers (installation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT cod_collections_receivable_fk FOREIGN KEY (installation_id, source_receivable_document_id)
    REFERENCES accounting.receivable_documents (installation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT cod_collections_payment_fk FOREIGN KEY (installation_id, payment_document_id)
    REFERENCES accounting.receivable_documents (installation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT cod_collections_driver_fk FOREIGN KEY (installation_id, driver_profile_id)
    REFERENCES logistics.driver_profiles (installation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT cod_collections_business_shape_check CHECK (
    (
      collection_method = 'NONE'
      AND collection_status = 'not_collected'
      AND received_amount = 0
      AND payment_document_id IS NULL
      AND reason_code IS NOT NULL
      AND promised_by IS NOT NULL
      AND due_at IS NOT NULL
    ) OR (
      collection_method IN ('CASH', 'BANK_TRANSFER')
      AND collection_status IN ('collected_full', 'collected_partial', 'collected_excess')
      AND received_amount > 0
      AND payment_document_id IS NOT NULL
      AND promised_by IS NULL
      AND due_at IS NULL
      AND (collection_method <> 'BANK_TRANSFER' OR external_reference IS NOT NULL)
    )
  ),
  CONSTRAINT cod_collections_status_amount_check CHECK (
    (collection_status = 'not_collected' AND received_amount = 0)
    OR (collection_status = 'collected_full' AND received_amount = expected_amount AND received_amount > 0)
    OR (collection_status = 'collected_partial' AND received_amount > 0 AND received_amount < expected_amount)
    OR (collection_status = 'collected_excess' AND received_amount > expected_amount)
  ),
  CONSTRAINT cod_collections_difference_reason_check CHECK (
    received_amount = expected_amount OR reason_code IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS cod_collections_trip_idx
  ON accounting.cod_collections (installation_id, trip_id, collected_at, id);
CREATE INDEX IF NOT EXISTS cod_collections_customer_idx
  ON accounting.cod_collections (installation_id, customer_id, collected_at DESC, id);
CREATE INDEX IF NOT EXISTS cod_collections_payment_idx
  ON accounting.cod_collections (installation_id, payment_document_id)
  WHERE payment_document_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS accounting.cod_collection_reversals (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  collection_id uuid NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  reversed_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT cod_collection_reversals_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT cod_collection_reversals_collection_unique UNIQUE (installation_id, collection_id),
  CONSTRAINT cod_collection_reversals_collection_fk FOREIGN KEY (installation_id, collection_id)
    REFERENCES accounting.cod_collections (installation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS accounting.cod_cash_handovers (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  warehouse_id uuid NOT NULL,
  trip_id uuid NOT NULL,
  driver_profile_id uuid NOT NULL,
  expected_total numeric(20,6) NOT NULL CHECK (expected_total >= 0),
  handed_over_total numeric(20,6) NOT NULL CHECK (handed_over_total >= 0),
  unattributed_excess_amount numeric(20,6) NOT NULL DEFAULT 0 CHECK (unattributed_excess_amount >= 0),
  difference_amount numeric(20,6) NOT NULL,
  reason text NULL CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 2000),
  note text NULL CHECK (note IS NULL OR char_length(note) <= 2000),
  handed_over_at timestamptz NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT cod_cash_handovers_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT cod_cash_handovers_idempotency_unique UNIQUE (installation_id, idempotency_key),
  CONSTRAINT cod_cash_handovers_warehouse_fk FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT cod_cash_handovers_trip_fk FOREIGN KEY (installation_id, trip_id)
    REFERENCES logistics.delivery_trips (installation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT cod_cash_handovers_driver_fk FOREIGN KEY (installation_id, driver_profile_id)
    REFERENCES logistics.driver_profiles (installation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT cod_cash_handovers_amount_check CHECK (
    difference_amount = handed_over_total + unattributed_excess_amount - expected_total
  ),
  CONSTRAINT cod_cash_handovers_difference_reason_check CHECK (
    difference_amount = 0 OR reason IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS cod_cash_handovers_trip_idx
  ON accounting.cod_cash_handovers (installation_id, trip_id, handed_over_at DESC, id);
CREATE INDEX IF NOT EXISTS cod_cash_handovers_warehouse_idx
  ON accounting.cod_cash_handovers (installation_id, warehouse_id, handed_over_at DESC, id);

CREATE TABLE IF NOT EXISTS accounting.cod_cash_handover_lines (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  handover_id uuid NOT NULL,
  collection_id uuid NOT NULL,
  expected_amount numeric(20,6) NOT NULL CHECK (expected_amount > 0),
  handed_over_amount numeric(20,6) NOT NULL CHECK (handed_over_amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT cod_cash_handover_lines_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT cod_cash_handover_lines_collection_unique UNIQUE (installation_id, handover_id, collection_id),
  CONSTRAINT cod_cash_handover_lines_handover_fk FOREIGN KEY (installation_id, handover_id)
    REFERENCES accounting.cod_cash_handovers (installation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT cod_cash_handover_lines_collection_fk FOREIGN KEY (installation_id, collection_id)
    REFERENCES accounting.cod_collections (installation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT cod_cash_handover_lines_amount_check CHECK (handed_over_amount <= expected_amount)
);

CREATE INDEX IF NOT EXISTS cod_cash_handover_lines_collection_idx
  ON accounting.cod_cash_handover_lines (installation_id, collection_id, created_at, id);

CREATE TABLE IF NOT EXISTS accounting.cod_cash_handover_reversals (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  handover_id uuid NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  reversed_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT cod_cash_handover_reversals_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT cod_cash_handover_reversals_handover_unique UNIQUE (installation_id, handover_id),
  CONSTRAINT cod_cash_handover_reversals_handover_fk FOREIGN KEY (installation_id, handover_id)
    REFERENCES accounting.cod_cash_handovers (installation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS accounting.cod_cash_acceptances (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  handover_id uuid NOT NULL,
  accepted_amount numeric(20,6) NOT NULL CHECK (accepted_amount >= 0),
  difference_amount numeric(20,6) NOT NULL,
  reconciliation_status text NOT NULL CHECK (reconciliation_status IN ('reconciled', 'discrepancy')),
  reason text NULL CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 2000),
  note text NULL CHECK (note IS NULL OR char_length(note) <= 2000),
  accepted_at timestamptz NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 128),
  CONSTRAINT cod_cash_acceptances_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT cod_cash_acceptances_handover_unique UNIQUE (installation_id, handover_id),
  CONSTRAINT cod_cash_acceptances_idempotency_unique UNIQUE (installation_id, idempotency_key),
  CONSTRAINT cod_cash_acceptances_handover_fk FOREIGN KEY (installation_id, handover_id)
    REFERENCES accounting.cod_cash_handovers (installation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT cod_cash_acceptances_status_check CHECK (
    (reconciliation_status = 'reconciled' AND difference_amount = 0)
    OR (reconciliation_status = 'discrepancy' AND difference_amount <> 0 AND reason IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS accounting.cod_cash_acceptance_reversals (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  acceptance_id uuid NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  reversed_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT cod_cash_acceptance_reversals_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT cod_cash_acceptance_reversals_acceptance_unique UNIQUE (installation_id, acceptance_id),
  CONSTRAINT cod_cash_acceptance_reversals_acceptance_fk FOREIGN KEY (installation_id, acceptance_id)
    REFERENCES accounting.cod_cash_acceptances (installation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
);
