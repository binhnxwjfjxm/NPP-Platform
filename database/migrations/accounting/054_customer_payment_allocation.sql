-- Phase 6F.2: customer payments and receivable allocations.
-- A payment is an immutable CREDIT document in the customer receivable ledger.
-- Allocation is a separate append-only fact that explains which receivable debit
-- consumed the payment; it never changes the total customer balance by itself.

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES
  ('core.customer-payment.read', 'Thu tiền khách hàng', 'Xem phiếu thu khách hàng', 'Cho phép đọc phiếu thu và lịch sử phân bổ trong phạm vi kho được cấp.', true, now()),
  ('core.customer-payment.create', 'Thu tiền khách hàng', 'Ghi nhận tiền khách trả', 'Cho phép ghi nhận tiền mặt hoặc chuyển khoản đã thực nhận từ khách hàng.', true, now()),
  ('core.customer-payment.reverse', 'Thu tiền khách hàng', 'Đảo phiếu thu khách hàng', 'Cho phép đảo phiếu thu chưa còn phân bổ đang hiệu lực, với lý do bắt buộc.', true, now()),
  ('core.receivable-allocation.create', 'Công nợ khách hàng', 'Phân bổ tiền vào công nợ', 'Cho phép phân bổ một phiếu thu vào một hoặc nhiều chứng từ phải thu trong phạm vi được cấp.', true, now()),
  ('core.receivable-allocation.reverse', 'Công nợ khách hàng', 'Đảo phân bổ công nợ', 'Cho phép đảo một phân bổ bằng chứng từ đảo bất biến.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

INSERT INTO shared.document_number_series (
  id, installation_id, code, document_type, name, prefix, number_template,
  reset_policy, sequence_width, start_counter, timezone_name, description,
  is_active, created_at, updated_at, created_by, updated_by
)
SELECT accounting.stable_uuid(customer_installation.installation_id || ':document-series:CUSTOMER_PAYMENT'),
       customer_installation.installation_id,
       'CUSTOMER_PAYMENT',
       'CUSTOMER_PAYMENT',
       'Phiếu thu khách hàng',
       'CP-',
       '{PREFIX}{YYYY}{MM}-{SEQ}',
       'MONTHLY',
       6,
       1,
       'Asia/Ho_Chi_Minh',
       'Series mặc định cho phiếu thu khách hàng.',
       true,
       now(),
       now(),
       'migration:054_customer_payment_allocation',
       'migration:054_customer_payment_allocation'
  FROM (SELECT DISTINCT installation_id FROM shared.customers) customer_installation
ON CONFLICT (installation_id, code) DO NOTHING;

ALTER TABLE accounting.receivable_documents
  ALTER COLUMN sales_order_id DROP NOT NULL,
  ALTER COLUMN sales_order_version_id DROP NOT NULL,
  ALTER COLUMN delivery_order_id DROP NOT NULL,
  ALTER COLUMN collection_policy DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS document_number_allocation_id uuid,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS external_reference text,
  ADD COLUMN IF NOT EXISTS note text;

ALTER TABLE accounting.receivable_documents
  DROP CONSTRAINT IF EXISTS receivable_documents_document_type_check,
  DROP CONSTRAINT IF EXISTS receivable_documents_source_document_type_check,
  DROP CONSTRAINT IF EXISTS receivable_documents_document_number_allocation_fk,
  DROP CONSTRAINT IF EXISTS receivable_documents_payment_method_check,
  DROP CONSTRAINT IF EXISTS receivable_documents_external_reference_check,
  DROP CONSTRAINT IF EXISTS receivable_documents_note_check,
  DROP CONSTRAINT IF EXISTS receivable_documents_business_shape_check;

ALTER TABLE accounting.receivable_documents
  ADD CONSTRAINT receivable_documents_document_type_check
    CHECK (document_type IN ('SALE_DELIVERY', 'SALE_PICKUP', 'CUSTOMER_PAYMENT')),
  ADD CONSTRAINT receivable_documents_source_document_type_check
    CHECK (source_document_type IN ('DELIVERY_ATTEMPT', 'PICKUP_HANDOVER', 'CUSTOMER_PAYMENT')),
  ADD CONSTRAINT receivable_documents_document_number_allocation_fk
    FOREIGN KEY (installation_id, document_number_allocation_id)
    REFERENCES shared.document_number_allocations (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT receivable_documents_payment_method_check
    CHECK (payment_method IS NULL OR char_length(btrim(payment_method)) BETWEEN 1 AND 64),
  ADD CONSTRAINT receivable_documents_external_reference_check
    CHECK (external_reference IS NULL OR char_length(btrim(external_reference)) BETWEEN 1 AND 256),
  ADD CONSTRAINT receivable_documents_note_check
    CHECK (note IS NULL OR char_length(note) <= 4000),
  ADD CONSTRAINT receivable_documents_business_shape_check CHECK (
    (
      document_type IN ('SALE_DELIVERY', 'SALE_PICKUP')
      AND direction = 'DEBIT'
      AND sales_order_id IS NOT NULL
      AND sales_order_version_id IS NOT NULL
      AND delivery_order_id IS NOT NULL
      AND collection_policy IS NOT NULL
      AND document_number_allocation_id IS NULL
      AND payment_method IS NULL
      AND external_reference IS NULL
      AND note IS NULL
    )
    OR
    (
      document_type = 'CUSTOMER_PAYMENT'
      AND direction = 'CREDIT'
      AND source_document_type = 'CUSTOMER_PAYMENT'
      AND source_document_id = id
      AND sales_order_id IS NULL
      AND sales_order_version_id IS NULL
      AND delivery_order_id IS NULL
      AND collection_policy IS NULL
      AND document_number_allocation_id IS NOT NULL
      AND payment_method IS NOT NULL
      AND original_amount > 0
    )
  );

ALTER TABLE accounting.receivable_ledger_entries
  DROP CONSTRAINT IF EXISTS receivable_ledger_entries_entry_type_check;
ALTER TABLE accounting.receivable_ledger_entries
  ADD CONSTRAINT receivable_ledger_entries_entry_type_check CHECK (
    entry_type IN (
      'SALE_POST',
      'SALE_REVERSE',
      'CUSTOMER_PAYMENT_POST',
      'CUSTOMER_PAYMENT_REVERSE'
    )
  );

CREATE TABLE IF NOT EXISTS accounting.receivable_allocations (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  source_receivable_document_id uuid NOT NULL,
  target_receivable_document_id uuid NOT NULL,
  amount numeric(20,6) NOT NULL CHECK (amount > 0),
  allocation_date date NOT NULL,
  source_revision_before bigint NOT NULL CHECK (source_revision_before >= 1),
  target_revision_before bigint NOT NULL CHECK (target_revision_before >= 1),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT receivable_allocations_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT receivable_allocations_source_fk
    FOREIGN KEY (installation_id, source_receivable_document_id)
    REFERENCES accounting.receivable_documents (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT receivable_allocations_target_fk
    FOREIGN KEY (installation_id, target_receivable_document_id)
    REFERENCES accounting.receivable_documents (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT receivable_allocations_distinct_documents
    CHECK (source_receivable_document_id <> target_receivable_document_id)
);

CREATE INDEX IF NOT EXISTS receivable_allocations_source_idx
  ON accounting.receivable_allocations (
    installation_id, source_receivable_document_id, allocation_date, created_at, id
  );
CREATE INDEX IF NOT EXISTS receivable_allocations_target_idx
  ON accounting.receivable_allocations (
    installation_id, target_receivable_document_id, allocation_date, created_at, id
  );

CREATE TABLE IF NOT EXISTS accounting.receivable_allocation_reversals (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  allocation_id uuid NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  reversed_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT receivable_allocation_reversals_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT receivable_allocation_reversals_allocation_unique UNIQUE (installation_id, allocation_id),
  CONSTRAINT receivable_allocation_reversals_allocation_fk
    FOREIGN KEY (installation_id, allocation_id)
    REFERENCES accounting.receivable_allocations (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION accounting.guard_receivable_allocation_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.receivable_write_context', true);
BEGIN
  IF write_context IS DISTINCT FROM 'receivable_service' THEN
    RAISE EXCEPTION 'receivable_history_write_requires_service_context';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'receivable_allocation_history_is_append_only';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS receivable_allocations_write_guard ON accounting.receivable_allocations;
CREATE TRIGGER receivable_allocations_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON accounting.receivable_allocations
FOR EACH ROW EXECUTE FUNCTION accounting.guard_receivable_allocation_history();

DROP TRIGGER IF EXISTS receivable_allocation_reversals_write_guard ON accounting.receivable_allocation_reversals;
CREATE TRIGGER receivable_allocation_reversals_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON accounting.receivable_allocation_reversals
FOR EACH ROW EXECUTE FUNCTION accounting.guard_receivable_allocation_history();

CREATE OR REPLACE FUNCTION accounting.receivable_status_for_amounts(
  original_amount numeric,
  allocated_amount numeric
)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT CASE
    WHEN allocated_amount = 0 THEN 'open'
    WHEN allocated_amount = original_amount THEN 'settled'
    ELSE 'partially_allocated'
  END;
$$;

CREATE OR REPLACE FUNCTION accounting.guard_receivable_document_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.receivable_write_context', true);
BEGIN
  IF write_context IS DISTINCT FROM 'receivable_service' THEN
    RAISE EXCEPTION 'receivable_document_write_requires_service_context';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'receivable_documents_cannot_be_deleted';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.installation_id IS DISTINCT FROM OLD.installation_id
       OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.customer_address_id IS DISTINCT FROM OLD.customer_address_id
       OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
       OR NEW.sales_order_id IS DISTINCT FROM OLD.sales_order_id
       OR NEW.sales_order_version_id IS DISTINCT FROM OLD.sales_order_version_id
       OR NEW.delivery_order_id IS DISTINCT FROM OLD.delivery_order_id
       OR NEW.direction IS DISTINCT FROM OLD.direction
       OR NEW.document_type IS DISTINCT FROM OLD.document_type
       OR NEW.source_document_type IS DISTINCT FROM OLD.source_document_type
       OR NEW.source_document_id IS DISTINCT FROM OLD.source_document_id
       OR NEW.source_document_number IS DISTINCT FROM OLD.source_document_number
       OR NEW.source_document_date IS DISTINCT FROM OLD.source_document_date
       OR NEW.customer_code_snapshot IS DISTINCT FROM OLD.customer_code_snapshot
       OR NEW.customer_name_snapshot IS DISTINCT FROM OLD.customer_name_snapshot
       OR NEW.warehouse_code_snapshot IS DISTINCT FROM OLD.warehouse_code_snapshot
       OR NEW.warehouse_name_snapshot IS DISTINCT FROM OLD.warehouse_name_snapshot
       OR NEW.collection_policy IS DISTINCT FROM OLD.collection_policy
       OR NEW.currency_code IS DISTINCT FROM OLD.currency_code
       OR NEW.original_amount IS DISTINCT FROM OLD.original_amount
       OR NEW.source_revision IS DISTINCT FROM OLD.source_revision
       OR NEW.posting_origin IS DISTINCT FROM OLD.posting_origin
       OR NEW.posted_at IS DISTINCT FROM OLD.posted_at
       OR NEW.posted_by IS DISTINCT FROM OLD.posted_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.document_number_allocation_id IS DISTINCT FROM OLD.document_number_allocation_id
       OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
       OR NEW.external_reference IS DISTINCT FROM OLD.external_reference
       OR NEW.note IS DISTINCT FROM OLD.note THEN
      RAISE EXCEPTION 'receivable_document_immutable_fields_changed';
    END IF;

    IF OLD.status = 'reversed' THEN
      RAISE EXCEPTION 'invalid_receivable_status_transition';
    END IF;
    IF NEW.revision <> OLD.revision + 1 THEN
      RAISE EXCEPTION 'receivable_document_revision_mismatch';
    END IF;
    IF NEW.allocated_amount < 0 OR NEW.allocated_amount > NEW.original_amount THEN
      RAISE EXCEPTION 'invalid_receivable_allocation_projection';
    END IF;

    IF NEW.status = 'reversed' THEN
      IF OLD.allocated_amount <> 0
         OR NEW.allocated_amount <> 0
         OR NEW.remaining_amount <> 0
         OR NEW.reversed_at IS NULL
         OR NEW.reversed_by IS NULL
         OR NEW.reversal_reason IS NULL THEN
        RAISE EXCEPTION 'receivable_reversal_requires_unallocated_document';
      END IF;
    ELSE
      IF NEW.remaining_amount <> NEW.original_amount - NEW.allocated_amount
         OR NEW.status <> accounting.receivable_status_for_amounts(
           NEW.original_amount,
           NEW.allocated_amount
         ) THEN
        RAISE EXCEPTION 'invalid_receivable_allocation_projection';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION accounting.create_receivable_allocation(
  p_id uuid,
  p_installation_id text,
  p_source_id uuid,
  p_target_id uuid,
  p_amount numeric(20,6),
  p_allocation_date date,
  p_actor_id text,
  p_request_id text,
  p_source_app text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS accounting.receivable_allocations
LANGUAGE plpgsql
AS $$
DECLARE
  source_document accounting.receivable_documents%ROWTYPE;
  target_document accounting.receivable_documents%ROWTYPE;
  created accounting.receivable_allocations%ROWTYPE;
  previous_write_context text := current_setting('npp.receivable_write_context', true);
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_allocation_amount';
  END IF;

  SELECT * INTO source_document
    FROM accounting.receivable_documents
   WHERE installation_id = p_installation_id
     AND id = p_source_id
   FOR UPDATE;
  SELECT * INTO target_document
    FROM accounting.receivable_documents
   WHERE installation_id = p_installation_id
     AND id = p_target_id
   FOR UPDATE;

  IF source_document.id IS NULL OR target_document.id IS NULL THEN
    RAISE EXCEPTION 'receivable_document_not_found';
  END IF;
  IF source_document.direction <> 'CREDIT'
     OR source_document.document_type <> 'CUSTOMER_PAYMENT'
     OR source_document.status = 'reversed' THEN
    RAISE EXCEPTION 'invalid_allocation_source';
  END IF;
  IF target_document.direction <> 'DEBIT'
     OR target_document.document_type NOT IN ('SALE_DELIVERY', 'SALE_PICKUP')
     OR target_document.status NOT IN ('open', 'partially_allocated') THEN
    RAISE EXCEPTION 'invalid_allocation_target';
  END IF;
  IF source_document.customer_id <> target_document.customer_id THEN
    RAISE EXCEPTION 'allocation_customer_mismatch';
  END IF;
  IF source_document.currency_code <> target_document.currency_code THEN
    RAISE EXCEPTION 'allocation_currency_mismatch';
  END IF;
  IF p_amount > source_document.remaining_amount THEN
    RAISE EXCEPTION 'allocation_exceeds_source_remaining';
  END IF;
  IF p_amount > target_document.remaining_amount THEN
    RAISE EXCEPTION 'allocation_exceeds_target_remaining';
  END IF;

  PERFORM set_config('npp.receivable_write_context', 'receivable_service', true);

  INSERT INTO accounting.receivable_allocations (
    id, installation_id, source_receivable_document_id,
    target_receivable_document_id, amount, allocation_date,
    source_revision_before, target_revision_before, actor_id,
    request_id, source_app, created_at, metadata
  ) VALUES (
    p_id, p_installation_id, p_source_id, p_target_id, p_amount,
    p_allocation_date, source_document.revision, target_document.revision,
    p_actor_id, p_request_id, p_source_app, now(), COALESCE(p_metadata, '{}'::jsonb)
  ) RETURNING * INTO created;

  UPDATE accounting.receivable_documents
     SET allocated_amount = allocated_amount + p_amount,
         remaining_amount = remaining_amount - p_amount,
         status = accounting.receivable_status_for_amounts(
           original_amount,
           allocated_amount + p_amount
         ),
         revision = revision + 1,
         updated_at = now(),
         updated_by = p_actor_id
   WHERE installation_id = p_installation_id
     AND id = p_source_id;

  UPDATE accounting.receivable_documents
     SET allocated_amount = allocated_amount + p_amount,
         remaining_amount = remaining_amount - p_amount,
         status = accounting.receivable_status_for_amounts(
           original_amount,
           allocated_amount + p_amount
         ),
         revision = revision + 1,
         updated_at = now(),
         updated_by = p_actor_id
   WHERE installation_id = p_installation_id
     AND id = p_target_id;

  PERFORM set_config(
    'npp.receivable_write_context',
    COALESCE(previous_write_context, ''),
    true
  );
  RETURN created;
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config(
      'npp.receivable_write_context',
      COALESCE(previous_write_context, ''),
      true
    );
    RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION accounting.reverse_receivable_allocation(
  p_reversal_id uuid,
  p_installation_id text,
  p_allocation_id uuid,
  p_reason text,
  p_actor_id text,
  p_request_id text,
  p_source_app text,
  p_reversed_at timestamptz,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS accounting.receivable_allocation_reversals
LANGUAGE plpgsql
AS $$
DECLARE
  allocation accounting.receivable_allocations%ROWTYPE;
  source_document accounting.receivable_documents%ROWTYPE;
  target_document accounting.receivable_documents%ROWTYPE;
  reversed accounting.receivable_allocation_reversals%ROWTYPE;
  previous_write_context text := current_setting('npp.receivable_write_context', true);
BEGIN
  SELECT * INTO allocation
    FROM accounting.receivable_allocations
   WHERE installation_id = p_installation_id
     AND id = p_allocation_id
   FOR UPDATE;
  IF allocation.id IS NULL THEN
    RAISE EXCEPTION 'receivable_allocation_not_found';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM accounting.receivable_allocation_reversals
     WHERE installation_id = p_installation_id
       AND allocation_id = p_allocation_id
  ) THEN
    RAISE EXCEPTION 'receivable_allocation_already_reversed';
  END IF;

  SELECT * INTO source_document
    FROM accounting.receivable_documents
   WHERE installation_id = p_installation_id
     AND id = allocation.source_receivable_document_id
   FOR UPDATE;
  SELECT * INTO target_document
    FROM accounting.receivable_documents
   WHERE installation_id = p_installation_id
     AND id = allocation.target_receivable_document_id
   FOR UPDATE;

  IF source_document.status = 'reversed' OR target_document.status = 'reversed' THEN
    RAISE EXCEPTION 'allocated_document_reversed';
  END IF;
  IF source_document.allocated_amount < allocation.amount
     OR target_document.allocated_amount < allocation.amount THEN
    RAISE EXCEPTION 'invalid_allocation_reversal_projection';
  END IF;

  PERFORM set_config('npp.receivable_write_context', 'receivable_service', true);

  INSERT INTO accounting.receivable_allocation_reversals (
    id, installation_id, allocation_id, reason, actor_id, request_id,
    source_app, reversed_at, metadata
  ) VALUES (
    p_reversal_id, p_installation_id, p_allocation_id, p_reason, p_actor_id,
    p_request_id, p_source_app, p_reversed_at, COALESCE(p_metadata, '{}'::jsonb)
  ) RETURNING * INTO reversed;

  UPDATE accounting.receivable_documents
     SET allocated_amount = allocated_amount - allocation.amount,
         remaining_amount = remaining_amount + allocation.amount,
         status = accounting.receivable_status_for_amounts(
           original_amount,
           allocated_amount - allocation.amount
         ),
         revision = revision + 1,
         updated_at = p_reversed_at,
         updated_by = p_actor_id
   WHERE installation_id = p_installation_id
     AND id = allocation.source_receivable_document_id;

  UPDATE accounting.receivable_documents
     SET allocated_amount = allocated_amount - allocation.amount,
         remaining_amount = remaining_amount + allocation.amount,
         status = accounting.receivable_status_for_amounts(
           original_amount,
           allocated_amount - allocation.amount
         ),
         revision = revision + 1,
         updated_at = p_reversed_at,
         updated_by = p_actor_id
   WHERE installation_id = p_installation_id
     AND id = allocation.target_receivable_document_id;

  PERFORM set_config(
    'npp.receivable_write_context',
    COALESCE(previous_write_context, ''),
    true
  );
  RETURN reversed;
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config(
      'npp.receivable_write_context',
      COALESCE(previous_write_context, ''),
      true
    );
    RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION accounting.reverse_customer_payment(
  p_installation_id text,
  p_payment_id uuid,
  p_actor_id text,
  p_reversed_at timestamptz,
  p_reason text
)
RETURNS accounting.receivable_documents
LANGUAGE plpgsql
AS $$
DECLARE
  payment accounting.receivable_documents%ROWTYPE;
  reversed accounting.receivable_documents%ROWTYPE;
  previous_write_context text := current_setting('npp.receivable_write_context', true);
BEGIN
  SELECT * INTO payment
    FROM accounting.receivable_documents
   WHERE installation_id = p_installation_id
     AND id = p_payment_id
     AND document_type = 'CUSTOMER_PAYMENT'
   FOR UPDATE;

  IF payment.id IS NULL THEN
    RAISE EXCEPTION 'customer_payment_not_found';
  END IF;
  IF payment.status = 'reversed' THEN
    RETURN payment;
  END IF;
  IF payment.allocated_amount <> 0 OR EXISTS (
    SELECT 1
      FROM accounting.receivable_allocations allocation
      LEFT JOIN accounting.receivable_allocation_reversals reversal
        ON reversal.installation_id = allocation.installation_id
       AND reversal.allocation_id = allocation.id
     WHERE allocation.installation_id = p_installation_id
       AND allocation.source_receivable_document_id = p_payment_id
       AND reversal.id IS NULL
  ) THEN
    RAISE EXCEPTION 'payment_allocation_exists';
  END IF;

  PERFORM set_config('npp.receivable_write_context', 'receivable_service', true);
  UPDATE accounting.receivable_documents
     SET status = 'reversed',
         remaining_amount = 0,
         reversed_at = p_reversed_at,
         reversed_by = p_actor_id,
         reversal_reason = p_reason,
         revision = revision + 1,
         updated_at = p_reversed_at,
         updated_by = p_actor_id
   WHERE installation_id = p_installation_id
     AND id = p_payment_id
  RETURNING * INTO reversed;

  PERFORM set_config(
    'npp.receivable_write_context',
    COALESCE(previous_write_context, ''),
    true
  );
  RETURN reversed;
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config(
      'npp.receivable_write_context',
      COALESCE(previous_write_context, ''),
      true
    );
    RAISE;
END;
$$;
