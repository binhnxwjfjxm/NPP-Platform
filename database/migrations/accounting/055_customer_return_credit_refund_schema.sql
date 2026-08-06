-- Phase 6F.3: accepted Customer Return -> receivable credit, unapplied customer credit,
-- explicit refund and compensating reversal. Inventory receipt remains owned by Phase 6D.

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES
  ('core.customer-return-credit.read', 'Điều chỉnh công nợ khách hàng', 'Xem credit hàng khách trả', 'Cho phép đọc credit phát sinh từ Customer Return đã được kho nhận trong phạm vi kho.', true, now()),
  ('core.customer-return-credit.allocate', 'Điều chỉnh công nợ khách hàng', 'Phân bổ credit hàng khách trả', 'Cho phép phân bổ phần credit chưa dùng vào khoản phải thu hợp lệ.', true, now()),
  ('core.customer-return-credit.reverse', 'Điều chỉnh công nợ khách hàng', 'Đảo credit hàng khách trả', 'Cho phép đảo credit bằng bút toán bù sau khi hoàn tiền liên quan đã được đảo.', true, now()),
  ('core.customer-refund.create', 'Hoàn tiền khách hàng', 'Hoàn tiền từ số dư credit', 'Cho phép ghi nhận hoàn tiền từ credit chưa phân bổ, với nơi nhận và lý do bắt buộc.', true, now()),
  ('core.customer-refund.reverse', 'Hoàn tiền khách hàng', 'Đảo hoàn tiền khách hàng', 'Cho phép đảo một khoản hoàn tiền bằng bút toán bù bất biến.', true, now())
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

CREATE OR REPLACE FUNCTION accounting.ensure_customer_refund_series_for_installation(
  p_installation_id text
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO shared.document_number_series (
    id, installation_id, code, document_type, name, prefix, number_template,
    reset_policy, sequence_width, start_counter, timezone_name, description,
    is_active, created_at, updated_at, created_by, updated_by
  ) VALUES (
    accounting.stable_uuid(p_installation_id || ':document-series:CUSTOMER_REFUND'),
    p_installation_id,
    'CUSTOMER_REFUND',
    'CUSTOMER_REFUND',
    'Phiếu hoàn tiền khách hàng',
    'RF-',
    '{PREFIX}{YYYY}{MM}-{SEQ}',
    'MONTHLY',
    6,
    1,
    'Asia/Ho_Chi_Minh',
    'Series mặc định cho phiếu hoàn tiền khách hàng.',
    true,
    now(),
    now(),
    'system:customer-refund-series',
    'system:customer-refund-series'
  )
  ON CONFLICT (installation_id, code) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION accounting.ensure_customer_refund_series_after_customer_insert()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM accounting.ensure_customer_refund_series_for_installation(NEW.installation_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customers_ensure_customer_refund_series ON shared.customers;
CREATE TRIGGER customers_ensure_customer_refund_series
AFTER INSERT ON shared.customers
FOR EACH ROW EXECUTE FUNCTION accounting.ensure_customer_refund_series_after_customer_insert();

DO $$
DECLARE
  installation record;
BEGIN
  FOR installation IN SELECT DISTINCT installation_id FROM shared.customers LOOP
    PERFORM accounting.ensure_customer_refund_series_for_installation(installation.installation_id);
  END LOOP;
END;
$$;

ALTER TABLE accounting.receivable_documents
  DROP CONSTRAINT IF EXISTS receivable_documents_document_type_check,
  DROP CONSTRAINT IF EXISTS receivable_documents_source_document_type_check,
  DROP CONSTRAINT IF EXISTS receivable_documents_business_shape_check;

ALTER TABLE accounting.receivable_documents
  ADD CONSTRAINT receivable_documents_document_type_check CHECK (
    document_type IN (
      'SALE_DELIVERY', 'SALE_PICKUP', 'CUSTOMER_PAYMENT',
      'CUSTOMER_RETURN_CREDIT', 'CUSTOMER_REFUND'
    )
  ),
  ADD CONSTRAINT receivable_documents_source_document_type_check CHECK (
    source_document_type IN (
      'DELIVERY_ATTEMPT', 'PICKUP_HANDOVER', 'CUSTOMER_PAYMENT',
      'CUSTOMER_RETURN', 'CUSTOMER_REFUND'
    )
  ),
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
    OR
    (
      document_type = 'CUSTOMER_RETURN_CREDIT'
      AND direction = 'CREDIT'
      AND source_document_type = 'CUSTOMER_RETURN'
      AND sales_order_id IS NULL
      AND sales_order_version_id IS NULL
      AND delivery_order_id IS NULL
      AND collection_policy IS NULL
      AND document_number_allocation_id IS NULL
      AND payment_method IS NULL
      AND original_amount > 0
    )
    OR
    (
      document_type = 'CUSTOMER_REFUND'
      AND direction = 'DEBIT'
      AND source_document_type = 'CUSTOMER_REFUND'
      AND source_document_id = id
      AND sales_order_id IS NULL
      AND sales_order_version_id IS NULL
      AND delivery_order_id IS NULL
      AND collection_policy IS NULL
      AND document_number_allocation_id IS NOT NULL
      AND payment_method IS NOT NULL
      AND external_reference IS NOT NULL
      AND original_amount > 0
    )
  );

ALTER TABLE accounting.receivable_ledger_entries
  DROP CONSTRAINT IF EXISTS receivable_ledger_entries_entry_type_check;
ALTER TABLE accounting.receivable_ledger_entries
  ADD CONSTRAINT receivable_ledger_entries_entry_type_check CHECK (
    entry_type IN (
      'SALE_POST', 'SALE_REVERSE',
      'CUSTOMER_PAYMENT_POST', 'CUSTOMER_PAYMENT_REVERSE',
      'CUSTOMER_RETURN_CREDIT_POST', 'CUSTOMER_RETURN_CREDIT_REVERSE',
      'CUSTOMER_REFUND_POST', 'CUSTOMER_REFUND_REVERSE'
    )
  );

CREATE TABLE IF NOT EXISTS accounting.customer_return_adjustment_lines (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  adjustment_receivable_document_id uuid NOT NULL,
  customer_return_id uuid NOT NULL,
  customer_return_line_id uuid NOT NULL,
  customer_return_receipt_line_id uuid NOT NULL,
  source_receivable_document_id uuid NOT NULL,
  source_receivable_line_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number BETWEEN 1 AND 10000),
  accepted_base_quantity numeric(30,12) NOT NULL CHECK (accepted_base_quantity > 0),
  adjustment_amount numeric(20,6) NOT NULL CHECK (adjustment_amount >= 0),
  currency_code text NOT NULL CHECK (char_length(currency_code) = 3 AND currency_code = upper(currency_code)),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT customer_return_adjustment_lines_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT customer_return_adjustment_lines_origin_unique UNIQUE (
    installation_id, customer_return_receipt_line_id, source_receivable_line_id
  ),
  CONSTRAINT customer_return_adjustment_lines_number_unique UNIQUE (
    installation_id, adjustment_receivable_document_id, line_number
  ),
  CONSTRAINT customer_return_adjustment_lines_adjustment_fk
    FOREIGN KEY (installation_id, adjustment_receivable_document_id)
    REFERENCES accounting.receivable_documents (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT customer_return_adjustment_lines_return_fk
    FOREIGN KEY (installation_id, customer_return_id)
    REFERENCES sales.customer_returns (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT customer_return_adjustment_lines_return_line_fk
    FOREIGN KEY (installation_id, customer_return_line_id)
    REFERENCES sales.customer_return_lines (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT customer_return_adjustment_lines_receipt_line_fk
    FOREIGN KEY (installation_id, customer_return_receipt_line_id)
    REFERENCES sales.customer_return_receipt_lines (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT customer_return_adjustment_lines_source_document_fk
    FOREIGN KEY (installation_id, source_receivable_document_id)
    REFERENCES accounting.receivable_documents (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT customer_return_adjustment_lines_source_line_fk
    FOREIGN KEY (installation_id, source_receivable_line_id)
    REFERENCES accounting.receivable_document_lines (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS customer_return_adjustment_lines_return_idx
  ON accounting.customer_return_adjustment_lines (
    installation_id, customer_return_id, adjustment_receivable_document_id, line_number
  );
CREATE INDEX IF NOT EXISTS customer_return_adjustment_lines_source_idx
  ON accounting.customer_return_adjustment_lines (
    installation_id, source_receivable_document_id, source_receivable_line_id
  );

CREATE TABLE IF NOT EXISTS accounting.customer_return_adjustment_reversals (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  adjustment_receivable_document_id uuid NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  reversed_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT customer_return_adjustment_reversals_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT customer_return_adjustment_reversals_document_unique UNIQUE (
    installation_id, adjustment_receivable_document_id
  ),
  CONSTRAINT customer_return_adjustment_reversals_document_fk
    FOREIGN KEY (installation_id, adjustment_receivable_document_id)
    REFERENCES accounting.receivable_documents (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS accounting.customer_refunds (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  receivable_document_id uuid NOT NULL,
  source_credit_document_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  warehouse_id uuid NOT NULL,
  currency_code text NOT NULL CHECK (char_length(currency_code) = 3 AND currency_code = upper(currency_code)),
  amount numeric(20,6) NOT NULL CHECK (amount > 0),
  refund_method text NOT NULL CHECK (char_length(btrim(refund_method)) BETWEEN 1 AND 64),
  destination_reference text NOT NULL CHECK (char_length(btrim(destination_reference)) BETWEEN 1 AND 512),
  external_reference text NULL CHECK (external_reference IS NULL OR char_length(btrim(external_reference)) BETWEEN 1 AND 256),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  posted_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT customer_refunds_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT customer_refunds_idempotency_unique UNIQUE (installation_id, idempotency_key),
  CONSTRAINT customer_refunds_document_unique UNIQUE (installation_id, receivable_document_id),
  CONSTRAINT customer_refunds_document_fk
    FOREIGN KEY (installation_id, receivable_document_id)
    REFERENCES accounting.receivable_documents (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT customer_refunds_source_credit_fk
    FOREIGN KEY (installation_id, source_credit_document_id)
    REFERENCES accounting.receivable_documents (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT customer_refunds_customer_fk
    FOREIGN KEY (installation_id, customer_id)
    REFERENCES shared.customers (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT customer_refunds_warehouse_fk
    FOREIGN KEY (installation_id, warehouse_id)
    REFERENCES shared.warehouses (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS customer_refunds_source_idx
  ON accounting.customer_refunds (
    installation_id, source_credit_document_id, posted_at, id
  );
CREATE INDEX IF NOT EXISTS customer_refunds_customer_idx
  ON accounting.customer_refunds (
    installation_id, customer_id, currency_code, posted_at DESC, id
  );

CREATE TABLE IF NOT EXISTS accounting.customer_refund_reversals (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  refund_id uuid NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  reversed_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT customer_refund_reversals_installation_id_unique UNIQUE (installation_id, id),
  CONSTRAINT customer_refund_reversals_refund_unique UNIQUE (installation_id, refund_id),
  CONSTRAINT customer_refund_reversals_refund_fk
    FOREIGN KEY (installation_id, refund_id)
    REFERENCES accounting.customer_refunds (installation_id, id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION accounting.guard_customer_return_credit_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.receivable_write_context', true);
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'customer_return_credit_history_is_append_only';
  END IF;
  IF write_context IS DISTINCT FROM 'receivable_service' THEN
    RAISE EXCEPTION 'customer_return_credit_write_requires_service_context';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customer_return_adjustment_lines_write_guard
  ON accounting.customer_return_adjustment_lines;
CREATE TRIGGER customer_return_adjustment_lines_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON accounting.customer_return_adjustment_lines
FOR EACH ROW EXECUTE FUNCTION accounting.guard_customer_return_credit_history();

DROP TRIGGER IF EXISTS customer_return_adjustment_reversals_write_guard
  ON accounting.customer_return_adjustment_reversals;
CREATE TRIGGER customer_return_adjustment_reversals_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON accounting.customer_return_adjustment_reversals
FOR EACH ROW EXECUTE FUNCTION accounting.guard_customer_return_credit_history();

DROP TRIGGER IF EXISTS customer_refunds_write_guard ON accounting.customer_refunds;
CREATE TRIGGER customer_refunds_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON accounting.customer_refunds
FOR EACH ROW EXECUTE FUNCTION accounting.guard_customer_return_credit_history();

DROP TRIGGER IF EXISTS customer_refund_reversals_write_guard
  ON accounting.customer_refund_reversals;
CREATE TRIGGER customer_refund_reversals_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON accounting.customer_refund_reversals
FOR EACH ROW EXECUTE FUNCTION accounting.guard_customer_return_credit_history();
