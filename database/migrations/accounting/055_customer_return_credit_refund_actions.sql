CREATE OR REPLACE FUNCTION accounting.create_customer_refund(
  p_refund_id uuid,
  p_installation_id text,
  p_source_credit_id uuid,
  p_document_number text,
  p_document_number_allocation_id uuid,
  p_amount numeric(20,6),
  p_refund_method text,
  p_destination_reference text,
  p_external_reference text,
  p_reason text,
  p_idempotency_key text,
  p_payload_hash text,
  p_actor_id text,
  p_request_id text,
  p_source_app text,
  p_posted_at timestamptz,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS accounting.customer_refunds
LANGUAGE plpgsql
AS $$
DECLARE
  source_credit accounting.receivable_documents%ROWTYPE;
  customer_record record;
  warehouse_record record;
  refund_document_id uuid := p_refund_id;
  allocation_id uuid;
  created accounting.customer_refunds%ROWTYPE;
  previous_write_context text := current_setting('npp.receivable_write_context', true);
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'invalid_refund_amount'; END IF;
  IF p_document_number IS NULL OR btrim(p_document_number) = ''
     OR p_document_number_allocation_id IS NULL THEN
    RAISE EXCEPTION 'customer_refund_number_required';
  END IF;

  SELECT * INTO created
    FROM accounting.customer_refunds
   WHERE installation_id = p_installation_id AND idempotency_key = p_idempotency_key;
  IF created.id IS NOT NULL THEN
    IF created.payload_hash <> p_payload_hash THEN
      RAISE EXCEPTION 'customer_refund_idempotency_payload_mismatch';
    END IF;
    RETURN created;
  END IF;

  SELECT * INTO source_credit
    FROM accounting.receivable_documents
   WHERE installation_id = p_installation_id AND id = p_source_credit_id
   FOR UPDATE;
  IF source_credit.id IS NULL THEN RAISE EXCEPTION 'customer_credit_not_found'; END IF;
  IF source_credit.direction <> 'CREDIT'
     OR source_credit.document_type NOT IN ('CUSTOMER_PAYMENT', 'CUSTOMER_RETURN_CREDIT')
     OR source_credit.status NOT IN ('open', 'partially_allocated') THEN
    RAISE EXCEPTION 'invalid_refund_source_credit';
  END IF;
  IF p_amount > source_credit.remaining_amount THEN
    RAISE EXCEPTION 'refund_exceeds_available_credit';
  END IF;

  SELECT code, name INTO customer_record
    FROM shared.customers
   WHERE installation_id = p_installation_id AND id = source_credit.customer_id;
  SELECT code, name INTO warehouse_record
    FROM shared.warehouses
   WHERE installation_id = p_installation_id AND id = source_credit.warehouse_id;
  IF customer_record.code IS NULL OR warehouse_record.code IS NULL THEN
    RAISE EXCEPTION 'customer_refund_snapshot_missing';
  END IF;

  PERFORM set_config('npp.receivable_write_context', 'receivable_service', true);
  INSERT INTO accounting.receivable_documents (
    id, installation_id, customer_id, customer_address_id, warehouse_id,
    sales_order_id, sales_order_version_id, delivery_order_id,
    direction, document_type, source_document_type, source_document_id,
    source_document_number, source_document_date,
    customer_code_snapshot, customer_name_snapshot,
    warehouse_code_snapshot, warehouse_name_snapshot,
    collection_policy, currency_code,
    original_amount, allocated_amount, remaining_amount, status,
    source_revision, posting_origin, posted_at, posted_by,
    revision, created_at, updated_at, created_by, updated_by,
    document_number_allocation_id, payment_method, external_reference, note
  ) VALUES (
    refund_document_id, p_installation_id, source_credit.customer_id, NULL, source_credit.warehouse_id,
    NULL, NULL, NULL,
    'DEBIT', 'CUSTOMER_REFUND', 'CUSTOMER_REFUND', refund_document_id,
    p_document_number, p_posted_at::date,
    customer_record.code, customer_record.name,
    warehouse_record.code, warehouse_record.name,
    NULL, source_credit.currency_code,
    p_amount, 0, p_amount, 'open',
    1, 'runtime', p_posted_at, p_actor_id,
    1, p_posted_at, p_posted_at, p_actor_id, p_actor_id,
    p_document_number_allocation_id, upper(btrim(p_refund_method)),
    COALESCE(NULLIF(btrim(p_external_reference), ''), p_document_number),
    p_reason
  );

  INSERT INTO accounting.receivable_ledger_entries (
    id, installation_id, receivable_document_id, customer_id, currency_code,
    entry_type, amount, source_document_type, source_document_id,
    source_document_number, source_revision, document_status_after,
    actor_id, request_id, source_app, occurred_at, metadata
  ) VALUES (
    accounting.stable_uuid(p_installation_id || ':customer-refund-ledger:' || p_refund_id::text),
    p_installation_id, refund_document_id, source_credit.customer_id, source_credit.currency_code,
    'CUSTOMER_REFUND_POST', p_amount, 'CUSTOMER_REFUND', p_refund_id,
    p_document_number, 1, 'open', p_actor_id, p_request_id, p_source_app,
    p_posted_at, jsonb_build_object('sourceCreditDocumentId', p_source_credit_id)
  );

  INSERT INTO accounting.customer_refunds (
    id, installation_id, receivable_document_id, source_credit_document_id,
    customer_id, warehouse_id, currency_code, amount, refund_method,
    destination_reference, external_reference, reason, idempotency_key,
    payload_hash, actor_id, request_id, source_app, posted_at, metadata
  ) VALUES (
    p_refund_id, p_installation_id, refund_document_id, p_source_credit_id,
    source_credit.customer_id, source_credit.warehouse_id, source_credit.currency_code,
    p_amount, upper(btrim(p_refund_method)), btrim(p_destination_reference),
    NULLIF(btrim(p_external_reference), ''), btrim(p_reason), p_idempotency_key,
    p_payload_hash, p_actor_id, p_request_id, p_source_app, p_posted_at,
    COALESCE(p_metadata, '{}'::jsonb)
  ) RETURNING * INTO created;

  allocation_id := accounting.stable_uuid(
    p_installation_id || ':customer-refund-allocation:' || p_refund_id::text
  );
  PERFORM accounting.create_credit_allocation(
    allocation_id, p_installation_id, p_source_credit_id, refund_document_id,
    p_amount, p_posted_at::date, p_actor_id, p_request_id, p_source_app,
    jsonb_build_object('customerRefundId', p_refund_id)
  );

  PERFORM set_config('npp.receivable_write_context', COALESCE(previous_write_context, ''), true);
  RETURN created;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('npp.receivable_write_context', COALESCE(previous_write_context, ''), true);
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION accounting.reverse_customer_refund(
  p_reversal_id uuid,
  p_installation_id text,
  p_refund_id uuid,
  p_reason text,
  p_actor_id text,
  p_request_id text,
  p_source_app text,
  p_reversed_at timestamptz,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS accounting.customer_refund_reversals
LANGUAGE plpgsql
AS $$
DECLARE
  refund accounting.customer_refunds%ROWTYPE;
  refund_document accounting.receivable_documents%ROWTYPE;
  allocation accounting.receivable_allocations%ROWTYPE;
  created accounting.customer_refund_reversals%ROWTYPE;
  previous_write_context text := current_setting('npp.receivable_write_context', true);
BEGIN
  SELECT * INTO refund
    FROM accounting.customer_refunds
   WHERE installation_id = p_installation_id AND id = p_refund_id
   FOR UPDATE;
  IF refund.id IS NULL THEN RAISE EXCEPTION 'customer_refund_not_found'; END IF;

  SELECT * INTO created
    FROM accounting.customer_refund_reversals
   WHERE installation_id = p_installation_id AND refund_id = p_refund_id;
  IF created.id IS NOT NULL THEN RETURN created; END IF;

  SELECT a.* INTO allocation
    FROM accounting.receivable_allocations a
   WHERE a.installation_id = p_installation_id
     AND a.target_receivable_document_id = refund.receivable_document_id
     AND NOT EXISTS (
       SELECT 1 FROM accounting.receivable_allocation_reversals r
        WHERE r.installation_id = a.installation_id AND r.allocation_id = a.id
     )
   FOR UPDATE;
  IF allocation.id IS NULL THEN RAISE EXCEPTION 'customer_refund_allocation_not_found'; END IF;

  PERFORM accounting.reverse_receivable_allocation(
    accounting.stable_uuid(
      p_installation_id || ':customer-refund-allocation-reversal:' || p_refund_id::text
    ),
    p_installation_id, allocation.id, p_reason, p_actor_id, p_request_id,
    p_source_app, p_reversed_at, jsonb_build_object('customerRefundId', p_refund_id)
  );

  SELECT * INTO refund_document
    FROM accounting.receivable_documents
   WHERE installation_id = p_installation_id AND id = refund.receivable_document_id
   FOR UPDATE;
  IF refund_document.allocated_amount <> 0 THEN
    RAISE EXCEPTION 'customer_refund_reversal_projection_invalid';
  END IF;

  PERFORM set_config('npp.receivable_write_context', 'receivable_service', true);
  UPDATE accounting.receivable_documents
     SET status = 'reversed', remaining_amount = 0,
         reversed_at = p_reversed_at, reversed_by = p_actor_id,
         reversal_reason = p_reason, revision = revision + 1,
         updated_at = p_reversed_at, updated_by = p_actor_id
   WHERE installation_id = p_installation_id AND id = refund.receivable_document_id;

  INSERT INTO accounting.receivable_ledger_entries (
    id, installation_id, receivable_document_id, customer_id, currency_code,
    entry_type, amount, source_document_type, source_document_id,
    source_document_number, source_revision, document_status_after,
    actor_id, request_id, source_app, occurred_at, metadata
  ) VALUES (
    accounting.stable_uuid(
      p_installation_id || ':customer-refund-reversal-ledger:' || p_refund_id::text
    ),
    p_installation_id, refund.receivable_document_id, refund.customer_id, refund.currency_code,
    'CUSTOMER_REFUND_REVERSE', -refund.amount, 'CUSTOMER_REFUND', refund.id,
    refund_document.source_document_number, refund_document.revision + 1, 'reversed',
    p_actor_id, p_request_id, p_source_app, p_reversed_at,
    jsonb_build_object('customerRefundId', p_refund_id)
  );

  INSERT INTO accounting.customer_refund_reversals (
    id, installation_id, refund_id, reason, actor_id, request_id,
    source_app, reversed_at, metadata
  ) VALUES (
    p_reversal_id, p_installation_id, p_refund_id, btrim(p_reason),
    p_actor_id, p_request_id, p_source_app, p_reversed_at,
    COALESCE(p_metadata, '{}'::jsonb)
  ) RETURNING * INTO created;

  PERFORM set_config('npp.receivable_write_context', COALESCE(previous_write_context, ''), true);
  RETURN created;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('npp.receivable_write_context', COALESCE(previous_write_context, ''), true);
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION accounting.reverse_customer_return_credit(
  p_reversal_id uuid,
  p_installation_id text,
  p_adjustment_document_id uuid,
  p_reason text,
  p_actor_id text,
  p_request_id text,
  p_source_app text,
  p_reversed_at timestamptz,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS accounting.customer_return_adjustment_reversals
LANGUAGE plpgsql
AS $$
DECLARE
  adjustment accounting.receivable_documents%ROWTYPE;
  allocation record;
  created accounting.customer_return_adjustment_reversals%ROWTYPE;
  previous_write_context text := current_setting('npp.receivable_write_context', true);
BEGIN
  SELECT * INTO adjustment
    FROM accounting.receivable_documents
   WHERE installation_id = p_installation_id
     AND id = p_adjustment_document_id
     AND document_type = 'CUSTOMER_RETURN_CREDIT'
   FOR UPDATE;
  IF adjustment.id IS NULL THEN RAISE EXCEPTION 'customer_return_credit_not_found'; END IF;

  SELECT * INTO created
    FROM accounting.customer_return_adjustment_reversals
   WHERE installation_id = p_installation_id
     AND adjustment_receivable_document_id = p_adjustment_document_id;
  IF created.id IS NOT NULL THEN RETURN created; END IF;

  IF EXISTS (
    SELECT 1
      FROM accounting.customer_refunds refund
     WHERE refund.installation_id = p_installation_id
       AND refund.source_credit_document_id = p_adjustment_document_id
       AND NOT EXISTS (
         SELECT 1 FROM accounting.customer_refund_reversals reversal
          WHERE reversal.installation_id = refund.installation_id
            AND reversal.refund_id = refund.id
       )
  ) THEN
    RAISE EXCEPTION 'customer_return_credit_has_active_refund';
  END IF;

  FOR allocation IN
    SELECT a.id
      FROM accounting.receivable_allocations a
     WHERE a.installation_id = p_installation_id
       AND a.source_receivable_document_id = p_adjustment_document_id
       AND NOT EXISTS (
         SELECT 1 FROM accounting.receivable_allocation_reversals r
          WHERE r.installation_id = a.installation_id AND r.allocation_id = a.id
       )
     ORDER BY a.created_at DESC, a.id DESC
  LOOP
    PERFORM accounting.reverse_receivable_allocation(
      accounting.stable_uuid(
        p_installation_id || ':return-credit-allocation-reversal:' || allocation.id::text
      ),
      p_installation_id, allocation.id, p_reason, p_actor_id, p_request_id,
      p_source_app, p_reversed_at,
      jsonb_build_object('customerReturnCreditId', p_adjustment_document_id)
    );
  END LOOP;

  SELECT * INTO adjustment
    FROM accounting.receivable_documents
   WHERE installation_id = p_installation_id AND id = p_adjustment_document_id
   FOR UPDATE;
  IF adjustment.allocated_amount <> 0 THEN
    RAISE EXCEPTION 'customer_return_credit_reversal_projection_invalid';
  END IF;

  PERFORM set_config('npp.receivable_write_context', 'receivable_service', true);
  UPDATE accounting.receivable_documents
     SET status = 'reversed', remaining_amount = 0,
         reversed_at = p_reversed_at, reversed_by = p_actor_id,
         reversal_reason = p_reason, revision = revision + 1,
         updated_at = p_reversed_at, updated_by = p_actor_id
   WHERE installation_id = p_installation_id AND id = p_adjustment_document_id;

  INSERT INTO accounting.receivable_ledger_entries (
    id, installation_id, receivable_document_id, customer_id, currency_code,
    entry_type, amount, source_document_type, source_document_id,
    source_document_number, source_revision, document_status_after,
    actor_id, request_id, source_app, occurred_at, metadata
  ) VALUES (
    accounting.stable_uuid(
      p_installation_id || ':customer-return-credit-reversal-ledger:' || p_adjustment_document_id::text
    ),
    p_installation_id, p_adjustment_document_id, adjustment.customer_id,
    adjustment.currency_code, 'CUSTOMER_RETURN_CREDIT_REVERSE', adjustment.original_amount,
    'CUSTOMER_RETURN', adjustment.source_document_id, adjustment.source_document_number,
    adjustment.revision + 1, 'reversed', p_actor_id, p_request_id,
    p_source_app, p_reversed_at,
    jsonb_build_object('customerReturnCreditId', p_adjustment_document_id)
  );

  INSERT INTO accounting.customer_return_adjustment_reversals (
    id, installation_id, adjustment_receivable_document_id, reason,
    actor_id, request_id, source_app, reversed_at, metadata
  ) VALUES (
    p_reversal_id, p_installation_id, p_adjustment_document_id, btrim(p_reason),
    p_actor_id, p_request_id, p_source_app, p_reversed_at,
    COALESCE(p_metadata, '{}'::jsonb)
  ) RETURNING * INTO created;

  PERFORM set_config('npp.receivable_write_context', COALESCE(previous_write_context, ''), true);
  RETURN created;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('npp.receivable_write_context', COALESCE(previous_write_context, ''), true);
  RAISE;
END;
$$;
