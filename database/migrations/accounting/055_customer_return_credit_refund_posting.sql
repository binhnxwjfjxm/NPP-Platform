CREATE OR REPLACE FUNCTION accounting.create_credit_allocation(
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

  -- Stable lock order prevents deadlocks when multiple credits target the same debit.
  IF p_source_id::text < p_target_id::text THEN
    SELECT * INTO source_document FROM accounting.receivable_documents
     WHERE installation_id = p_installation_id AND id = p_source_id FOR UPDATE;
    SELECT * INTO target_document FROM accounting.receivable_documents
     WHERE installation_id = p_installation_id AND id = p_target_id FOR UPDATE;
  ELSE
    SELECT * INTO target_document FROM accounting.receivable_documents
     WHERE installation_id = p_installation_id AND id = p_target_id FOR UPDATE;
    SELECT * INTO source_document FROM accounting.receivable_documents
     WHERE installation_id = p_installation_id AND id = p_source_id FOR UPDATE;
  END IF;

  IF source_document.id IS NULL OR target_document.id IS NULL THEN
    RAISE EXCEPTION 'receivable_document_not_found';
  END IF;
  IF source_document.direction <> 'CREDIT'
     OR source_document.document_type NOT IN ('CUSTOMER_PAYMENT', 'CUSTOMER_RETURN_CREDIT')
     OR source_document.status NOT IN ('open', 'partially_allocated') THEN
    RAISE EXCEPTION 'invalid_credit_allocation_source';
  END IF;
  IF target_document.direction <> 'DEBIT'
     OR target_document.document_type NOT IN ('SALE_DELIVERY', 'SALE_PICKUP', 'CUSTOMER_REFUND')
     OR target_document.status NOT IN ('open', 'partially_allocated') THEN
    RAISE EXCEPTION 'invalid_credit_allocation_target';
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
         status = accounting.receivable_status_for_amounts(original_amount, allocated_amount + p_amount),
         revision = revision + 1,
         updated_at = now(),
         updated_by = p_actor_id
   WHERE installation_id = p_installation_id AND id = p_source_id;

  UPDATE accounting.receivable_documents
     SET allocated_amount = allocated_amount + p_amount,
         remaining_amount = remaining_amount - p_amount,
         status = accounting.receivable_status_for_amounts(original_amount, allocated_amount + p_amount),
         revision = revision + 1,
         updated_at = now(),
         updated_by = p_actor_id
   WHERE installation_id = p_installation_id AND id = p_target_id;

  PERFORM set_config('npp.receivable_write_context', COALESCE(previous_write_context, ''), true);
  RETURN created;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('npp.receivable_write_context', COALESCE(previous_write_context, ''), true);
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION accounting.post_customer_return_credit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  receipt record;
  source record;
  currency_row record;
  allocation_row record;
  adjustment_document_id uuid;
  adjustment_source_id uuid;
  total_amount numeric(20,6);
  remaining_quantity numeric(30,12);
  available_quantity numeric(30,12);
  apply_quantity numeric(30,12);
  available_amount numeric(20,6);
  apply_amount numeric(20,6);
  allocation_amount numeric(20,6);
  customer_record record;
  warehouse_record record;
  request_key text;
  previous_write_context text := current_setting('npp.receivable_write_context', true);
BEGIN
  IF TG_OP <> 'UPDATE' OR OLD.status = 'received' OR NEW.status <> 'received' THEN
    RETURN NEW;
  END IF;
  IF NEW.return_number IS NULL OR NEW.received_at IS NULL OR NEW.received_by IS NULL THEN
    RAISE EXCEPTION 'customer_return_received_fact_incomplete';
  END IF;

  SELECT code, name INTO customer_record
    FROM shared.customers
   WHERE installation_id = NEW.installation_id AND id = NEW.customer_id;
  SELECT code, name INTO warehouse_record
    FROM shared.warehouses
   WHERE installation_id = NEW.installation_id AND id = NEW.warehouse_id;
  IF customer_record.code IS NULL OR warehouse_record.code IS NULL THEN
    RAISE EXCEPTION 'customer_return_accounting_snapshot_missing';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS customer_return_credit_stage (
    customer_return_line_id uuid NOT NULL,
    receipt_line_id uuid NOT NULL,
    issue_line_id uuid NOT NULL,
    source_receivable_document_id uuid NOT NULL,
    source_receivable_line_id uuid NOT NULL,
    currency_code text NOT NULL,
    accepted_base_quantity numeric(30,12) NOT NULL,
    adjustment_amount numeric(20,6) NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE TABLE customer_return_credit_stage;

  FOR receipt IN
    SELECT receipt_line.id AS receipt_line_id,
           receipt_line.accepted_base_quantity,
           return_line.id AS return_line_id,
           return_line.issue_line_id
      FROM sales.customer_return_receipt_lines receipt_line
      JOIN sales.customer_return_lines return_line
        ON return_line.installation_id = receipt_line.installation_id
       AND return_line.id = receipt_line.customer_return_line_id
     WHERE receipt_line.installation_id = NEW.installation_id
       AND receipt_line.customer_return_id = NEW.id
     ORDER BY return_line.line_number, receipt_line.id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      NEW.installation_id || ':customer-return-credit:' || receipt.issue_line_id::text,
      0
    ));
    remaining_quantity := receipt.accepted_base_quantity;

    FOR source IN
      SELECT receivable_line.id AS receivable_line_id,
             receivable_line.receivable_document_id,
             receivable_line.accepted_base_quantity,
             receivable_line.line_amount,
             document.currency_code,
             COALESCE(prior.adjusted_quantity, 0) AS adjusted_quantity,
             COALESCE(prior.adjusted_amount, 0) AS adjusted_amount
        FROM accounting.receivable_document_lines receivable_line
        JOIN accounting.receivable_documents document
          ON document.installation_id = receivable_line.installation_id
         AND document.id = receivable_line.receivable_document_id
        LEFT JOIN LATERAL (
          SELECT sum(active_line.accepted_base_quantity) AS adjusted_quantity,
                 sum(active_line.adjustment_amount) AS adjusted_amount
            FROM accounting.customer_return_adjustment_lines active_line
            JOIN accounting.receivable_documents active_document
              ON active_document.installation_id = active_line.installation_id
             AND active_document.id = active_line.adjustment_receivable_document_id
           WHERE active_line.installation_id = receivable_line.installation_id
             AND active_line.source_receivable_line_id = receivable_line.id
             AND active_document.status <> 'reversed'
        ) prior ON true
       WHERE receivable_line.installation_id = NEW.installation_id
         AND receivable_line.inventory_issue_line_id = receipt.issue_line_id
         AND document.direction = 'DEBIT'
         AND document.document_type IN ('SALE_DELIVERY', 'SALE_PICKUP')
         AND document.status <> 'reversed'
       ORDER BY document.source_document_date, document.id, receivable_line.line_number
       FOR UPDATE OF document
    LOOP
      EXIT WHEN remaining_quantity <= 0;
      available_quantity := source.accepted_base_quantity - source.adjusted_quantity;
      IF available_quantity <= 0 THEN CONTINUE; END IF;
      apply_quantity := LEAST(remaining_quantity, available_quantity);
      available_amount := source.line_amount - source.adjusted_amount;
      IF available_amount < 0 THEN
        RAISE EXCEPTION 'customer_return_adjustment_amount_projection_invalid';
      END IF;
      IF apply_quantity = available_quantity THEN
        apply_amount := available_amount;
      ELSE
        apply_amount := LEAST(
          round(source.line_amount * apply_quantity / source.accepted_base_quantity, 6),
          available_amount
        );
      END IF;

      INSERT INTO customer_return_credit_stage (
        customer_return_line_id, receipt_line_id, issue_line_id,
        source_receivable_document_id, source_receivable_line_id,
        currency_code, accepted_base_quantity, adjustment_amount
      ) VALUES (
        receipt.return_line_id, receipt.receipt_line_id, receipt.issue_line_id,
        source.receivable_document_id, source.receivable_line_id,
        source.currency_code, apply_quantity, apply_amount
      );
      remaining_quantity := remaining_quantity - apply_quantity;
    END LOOP;

    IF remaining_quantity > 0 THEN
      RAISE EXCEPTION 'customer_return_exceeds_posted_receivable_quantity';
    END IF;
  END LOOP;

  PERFORM set_config('npp.receivable_write_context', 'receivable_service', true);
  request_key := left('customer-return-received:' || NEW.id::text, 128);

  FOR currency_row IN
    SELECT currency_code, sum(adjustment_amount)::numeric(20,6) AS total_amount
      FROM customer_return_credit_stage
     GROUP BY currency_code
     ORDER BY currency_code
  LOOP
    total_amount := currency_row.total_amount;
    -- Free goods can be received without creating a zero-value accounting fact.
    IF total_amount <= 0 THEN CONTINUE; END IF;

    adjustment_document_id := accounting.stable_uuid(
      NEW.installation_id || ':customer-return-credit:' || NEW.id::text || ':' || currency_row.currency_code
    );
    adjustment_source_id := accounting.stable_uuid(
      NEW.installation_id || ':customer-return-credit-source:' || NEW.id::text || ':' || currency_row.currency_code
    );

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
      adjustment_document_id, NEW.installation_id, NEW.customer_id, NULL, NEW.warehouse_id,
      NULL, NULL, NULL,
      'CREDIT', 'CUSTOMER_RETURN_CREDIT', 'CUSTOMER_RETURN', adjustment_source_id,
      NEW.return_number, NEW.received_at::date,
      customer_record.code, customer_record.name,
      warehouse_record.code, warehouse_record.name,
      NULL, currency_row.currency_code,
      total_amount, 0, total_amount, 'open',
      NEW.revision, 'runtime', NEW.received_at, NEW.received_by,
      1, NEW.received_at, NEW.received_at, NEW.received_by, NEW.received_by,
      NULL, NULL, NULL, 'Credit tự động từ Customer Return đã được kho nhận.'
    );

    INSERT INTO accounting.customer_return_adjustment_lines (
      id, installation_id, adjustment_receivable_document_id,
      customer_return_id, customer_return_line_id, customer_return_receipt_line_id,
      source_receivable_document_id, source_receivable_line_id, line_number,
      accepted_base_quantity, adjustment_amount, currency_code,
      actor_id, created_at, metadata
    )
    SELECT accounting.stable_uuid(
             NEW.installation_id || ':customer-return-adjustment-line:' ||
             staged.receipt_line_id::text || ':' || staged.source_receivable_line_id::text
           ),
           NEW.installation_id,
           adjustment_document_id,
           NEW.id,
           staged.customer_return_line_id,
           staged.receipt_line_id,
           staged.source_receivable_document_id,
           staged.source_receivable_line_id,
           row_number() OVER (
             ORDER BY staged.customer_return_line_id, staged.receipt_line_id,
                      staged.source_receivable_document_id, staged.source_receivable_line_id
           )::integer,
           staged.accepted_base_quantity,
           staged.adjustment_amount,
           staged.currency_code,
           NEW.received_by,
           NEW.received_at,
           jsonb_build_object('originIssueLineId', staged.issue_line_id)
      FROM customer_return_credit_stage staged
     WHERE staged.currency_code = currency_row.currency_code;

    INSERT INTO accounting.receivable_ledger_entries (
      id, installation_id, receivable_document_id, customer_id, currency_code,
      entry_type, amount, source_document_type, source_document_id,
      source_document_number, source_revision, document_status_after,
      actor_id, request_id, source_app, occurred_at, metadata
    ) VALUES (
      accounting.stable_uuid(
        NEW.installation_id || ':customer-return-credit-ledger:' || adjustment_document_id::text
      ),
      NEW.installation_id, adjustment_document_id, NEW.customer_id,
      currency_row.currency_code, 'CUSTOMER_RETURN_CREDIT_POST', -total_amount,
      'CUSTOMER_RETURN', adjustment_source_id, NEW.return_number, NEW.revision, 'open',
      NEW.received_by, request_key, 'core', NEW.received_at,
      jsonb_build_object('customerReturnId', NEW.id, 'warehouseId', NEW.warehouse_id)
    );

    FOR allocation_row IN
      SELECT source_receivable_document_id,
             sum(adjustment_amount)::numeric(20,6) AS amount
        FROM customer_return_credit_stage
       WHERE currency_code = currency_row.currency_code
       GROUP BY source_receivable_document_id
       ORDER BY source_receivable_document_id
    LOOP
      SELECT LEAST(source_credit.remaining_amount, target_debit.remaining_amount, allocation_row.amount)
        INTO allocation_amount
        FROM accounting.receivable_documents source_credit
        JOIN accounting.receivable_documents target_debit
          ON target_debit.installation_id = source_credit.installation_id
       WHERE source_credit.installation_id = NEW.installation_id
         AND source_credit.id = adjustment_document_id
         AND target_debit.id = allocation_row.source_receivable_document_id;
      IF COALESCE(allocation_amount, 0) > 0 THEN
        PERFORM accounting.create_credit_allocation(
          accounting.stable_uuid(
            NEW.installation_id || ':return-credit-allocation:' ||
            adjustment_document_id::text || ':' || allocation_row.source_receivable_document_id::text
          ),
          NEW.installation_id,
          adjustment_document_id,
          allocation_row.source_receivable_document_id,
          allocation_amount,
          NEW.received_at::date,
          NEW.received_by,
          request_key,
          'core',
          jsonb_build_object('customerReturnId', NEW.id, 'automatic', true)
        );
      END IF;
    END LOOP;

    INSERT INTO shared.core_audit_records (
      audit_id, installation_id, actor_id, employee_id, source_app, request_id,
      action, resource_type, resource_id, before_data, after_data, metadata, occurred_at
    ) VALUES (
      accounting.stable_uuid(
        NEW.installation_id || ':audit:customer-return-credit:' || adjustment_document_id::text
      ),
      NEW.installation_id, NEW.received_by, NULL, 'core', request_key,
      'accounting.customer_return_credit.post', 'accounting.customer_return_credit',
      adjustment_document_id::text, NULL,
      jsonb_build_object(
        'id', adjustment_document_id,
        'customerReturnId', NEW.id,
        'amount', total_amount,
        'currencyCode', currency_row.currency_code
      ),
      jsonb_build_object('warehouseId', NEW.warehouse_id, 'returnNumber', NEW.return_number),
      NEW.received_at
    );

    INSERT INTO shared.core_outbox_events (
      event_id, installation_id, aggregate_type, aggregate_id, event_type,
      event_version, payload, metadata, request_id, actor_id, source_app,
      status, attempts, available_at, created_at
    ) VALUES (
      accounting.stable_uuid(
        NEW.installation_id || ':outbox:customer-return-credit:' || adjustment_document_id::text
      ),
      NEW.installation_id, 'accounting.customer_return_credit',
      adjustment_document_id::text, 'accounting.customer_return_credit.posted', 1,
      jsonb_build_object(
        'id', adjustment_document_id,
        'customerReturnId', NEW.id,
        'amount', total_amount,
        'currencyCode', currency_row.currency_code
      ),
      jsonb_build_object('warehouseId', NEW.warehouse_id, 'returnNumber', NEW.return_number),
      request_key, NEW.received_by, 'core', 'pending', 0, NEW.received_at, NEW.received_at
    );
  END LOOP;

  PERFORM set_config('npp.receivable_write_context', COALESCE(previous_write_context, ''), true);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('npp.receivable_write_context', COALESCE(previous_write_context, ''), true);
  RAISE;
END;
$$;

DROP TRIGGER IF EXISTS customer_returns_post_receivable_credit ON sales.customer_returns;
CREATE TRIGGER customer_returns_post_receivable_credit
AFTER UPDATE OF status ON sales.customer_returns
FOR EACH ROW EXECUTE FUNCTION accounting.post_customer_return_credit();
