-- Phase 5.6: supplier payment and payable allocation.
-- Supplier payments are posted accounting facts. Allocations are immutable facts;
-- allocation reversal is represented by a separate immutable reversal row.

INSERT INTO shared.permission_catalog (
  permission_key,module,label,description,is_system,created_at
) VALUES
  ('core.supplier-payment.read','Thanh toán nhà cung cấp','Xem thanh toán nhà cung cấp','Cho phép đọc phiếu thanh toán nhà cung cấp trong phạm vi kho được cấp.',true,now()),
  ('core.supplier-payment.create','Thanh toán nhà cung cấp','Ghi nhận thanh toán nhà cung cấp','Cho phép ghi nhận phiếu thanh toán nhà cung cấp đã post trong phạm vi kho được cấp.',true,now()),
  ('core.supplier-payment.reverse','Thanh toán nhà cung cấp','Đảo thanh toán nhà cung cấp','Cho phép đảo phiếu thanh toán nhà cung cấp chưa có phân bổ đang hiệu lực.',true,now()),
  ('core.payable-allocation.create','Công nợ phải trả','Phân bổ công nợ phải trả','Cho phép phân bổ thanh toán hoặc phiếu trả nhà cung cấp vào chứng từ phải trả.',true,now()),
  ('core.payable-allocation.reverse','Công nợ phải trả','Đảo phân bổ công nợ phải trả','Cho phép đảo một phân bổ công nợ bằng chứng từ đảo bất biến.',true,now())
ON CONFLICT (permission_key) DO UPDATE
SET module=EXCLUDED.module,label=EXCLUDED.label,description=EXCLUDED.description,is_system=EXCLUDED.is_system;

-- Every installation receives a deterministic default payment series. Operators may
-- change the format later through the existing document-numbering administration API.
INSERT INTO shared.document_number_series (
  id,installation_id,code,document_type,name,prefix,number_template,reset_policy,
  sequence_width,start_counter,timezone_name,description,is_active,
  created_at,updated_at,created_by,updated_by
)
SELECT accounting.stable_uuid(i.installation_id || ':document-series:SUPPLIER_PAYMENT'),
       i.installation_id,'SUPPLIER_PAYMENT','SUPPLIER_PAYMENT',
       'Phiếu thanh toán nhà cung cấp','SP-','{PREFIX}{YYYY}{MM}-{SEQ}','MONTHLY',
       6,1,'Asia/Ho_Chi_Minh','Series mặc định cho thanh toán nhà cung cấp.',true,
       now(),now(),'migration:031_supplier_payment_allocation','migration:031_supplier_payment_allocation'
  FROM (SELECT DISTINCT installation_id FROM shared.suppliers) i
ON CONFLICT (installation_id,code) DO NOTHING;

ALTER TABLE accounting.payable_documents
  ADD COLUMN IF NOT EXISTS document_number_allocation_id uuid,
  ADD COLUMN IF NOT EXISTS external_reference text,
  ADD COLUMN IF NOT EXISTS note text;

ALTER TABLE accounting.payable_documents
  DROP CONSTRAINT IF EXISTS payable_documents_document_type_check,
  DROP CONSTRAINT IF EXISTS payable_documents_source_domain_check,
  DROP CONSTRAINT IF EXISTS payable_documents_source_document_type_check;

ALTER TABLE accounting.payable_documents
  ADD CONSTRAINT payable_documents_document_type_check
    CHECK (document_type IN ('GOODS_RECEIPT','SUPPLIER_RETURN_CREDIT','SUPPLIER_PAYMENT')),
  ADD CONSTRAINT payable_documents_source_domain_check
    CHECK (source_domain IN ('PURCHASING','ACCOUNTING')),
  ADD CONSTRAINT payable_documents_source_document_type_check
    CHECK (source_document_type IN ('GOODS_RECEIPT','SUPPLIER_RETURN','SUPPLIER_PAYMENT')),
  ADD CONSTRAINT payable_documents_number_allocation_fk
    FOREIGN KEY (installation_id,document_number_allocation_id)
    REFERENCES shared.document_number_allocations(installation_id,id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT payable_documents_external_reference_check
    CHECK (external_reference IS NULL OR char_length(btrim(external_reference)) BETWEEN 1 AND 256),
  ADD CONSTRAINT payable_documents_note_check
    CHECK (note IS NULL OR char_length(note) <= 4000),
  ADD CONSTRAINT payable_documents_payment_shape_check CHECK (
    document_type <> 'SUPPLIER_PAYMENT'
    OR (
      direction='CREDIT'
      AND source_domain='ACCOUNTING'
      AND source_document_type='SUPPLIER_PAYMENT'
      AND source_document_id=id
      AND payment_term_days_snapshot=0
      AND due_date=source_document_date
      AND document_number_allocation_id IS NOT NULL
    )
  );

ALTER TABLE accounting.payable_ledger_entries
  DROP CONSTRAINT IF EXISTS payable_ledger_entries_entry_type_check,
  DROP CONSTRAINT IF EXISTS payable_ledger_entries_source_document_type_check;

ALTER TABLE accounting.payable_ledger_entries
  ADD CONSTRAINT payable_ledger_entries_entry_type_check CHECK (
    entry_type IN (
      'GOODS_RECEIPT_POST','GOODS_RECEIPT_REVERSE',
      'SUPPLIER_RETURN_POST','SUPPLIER_RETURN_REVERSE',
      'SUPPLIER_PAYMENT_POST','SUPPLIER_PAYMENT_REVERSE'
    )
  ),
  ADD CONSTRAINT payable_ledger_entries_source_document_type_check CHECK (
    source_document_type IN ('GOODS_RECEIPT','SUPPLIER_RETURN','SUPPLIER_PAYMENT')
  );

CREATE TABLE IF NOT EXISTS accounting.payable_allocations (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  source_payable_document_id uuid NOT NULL,
  target_payable_document_id uuid NOT NULL,
  amount numeric(20,6) NOT NULL CHECK (amount>0),
  allocation_date date NOT NULL,
  source_revision_before bigint NOT NULL CHECK (source_revision_before>=1),
  target_revision_before bigint NOT NULL CHECK (target_revision_before>=1),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  CONSTRAINT payable_allocations_id_installation_unique UNIQUE (installation_id,id),
  CONSTRAINT payable_allocations_source_fk FOREIGN KEY (installation_id,source_payable_document_id)
    REFERENCES accounting.payable_documents(installation_id,id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT payable_allocations_target_fk FOREIGN KEY (installation_id,target_payable_document_id)
    REFERENCES accounting.payable_documents(installation_id,id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT payable_allocations_distinct_documents CHECK (source_payable_document_id<>target_payable_document_id)
);
CREATE INDEX IF NOT EXISTS payable_allocations_source_idx
  ON accounting.payable_allocations(installation_id,source_payable_document_id,allocation_date,created_at,id);
CREATE INDEX IF NOT EXISTS payable_allocations_target_idx
  ON accounting.payable_allocations(installation_id,target_payable_document_id,allocation_date,created_at,id);

CREATE TABLE IF NOT EXISTS accounting.payable_allocation_reversals (
  id uuid NOT NULL PRIMARY KEY,
  installation_id text NOT NULL CHECK (char_length(installation_id) BETWEEN 1 AND 128),
  allocation_id uuid NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
  actor_id text NOT NULL CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  source_app text NOT NULL CHECK (char_length(source_app) BETWEEN 1 AND 128),
  reversed_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  CONSTRAINT payable_allocation_reversals_id_installation_unique UNIQUE (installation_id,id),
  CONSTRAINT payable_allocation_reversals_allocation_unique UNIQUE (installation_id,allocation_id),
  CONSTRAINT payable_allocation_reversals_allocation_fk FOREIGN KEY (installation_id,allocation_id)
    REFERENCES accounting.payable_allocations(installation_id,id) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION accounting.reject_payable_allocation_history_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'payable_allocation_history_is_append_only';
END;
$$;
DROP TRIGGER IF EXISTS payable_allocations_append_only ON accounting.payable_allocations;
CREATE TRIGGER payable_allocations_append_only
BEFORE UPDATE OR DELETE ON accounting.payable_allocations
FOR EACH ROW EXECUTE FUNCTION accounting.reject_payable_allocation_history_mutation();
DROP TRIGGER IF EXISTS payable_allocation_reversals_append_only ON accounting.payable_allocation_reversals;
CREATE TRIGGER payable_allocation_reversals_append_only
BEFORE UPDATE OR DELETE ON accounting.payable_allocation_reversals
FOR EACH ROW EXECUTE FUNCTION accounting.reject_payable_allocation_history_mutation();

CREATE OR REPLACE FUNCTION accounting.payable_status_for_amounts(
  original_amount numeric,
  allocated_amount numeric
) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT CASE
    WHEN allocated_amount=0 THEN 'open'
    WHEN allocated_amount=original_amount THEN 'settled'
    ELSE 'partially_allocated'
  END;
$$;

CREATE OR REPLACE FUNCTION accounting.guard_payable_document_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  allocation_update_allowed boolean := COALESCE(current_setting('npp.payable_allocation_update',true),'')='on';
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'payable_documents_are_immutable'; END IF;
  IF NEW.installation_id IS DISTINCT FROM OLD.installation_id OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
     OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id OR NEW.direction IS DISTINCT FROM OLD.direction
     OR NEW.document_type IS DISTINCT FROM OLD.document_type OR NEW.source_domain IS DISTINCT FROM OLD.source_domain
     OR NEW.source_document_type IS DISTINCT FROM OLD.source_document_type OR NEW.source_document_id IS DISTINCT FROM OLD.source_document_id
     OR NEW.source_document_number IS DISTINCT FROM OLD.source_document_number OR NEW.source_document_date IS DISTINCT FROM OLD.source_document_date
     OR NEW.currency_code IS DISTINCT FROM OLD.currency_code OR NEW.payment_method_snapshot IS DISTINCT FROM OLD.payment_method_snapshot
     OR NEW.payment_term_days_snapshot IS DISTINCT FROM OLD.payment_term_days_snapshot OR NEW.due_date IS DISTINCT FROM OLD.due_date
     OR NEW.original_amount IS DISTINCT FROM OLD.original_amount OR NEW.posting_origin IS DISTINCT FROM OLD.posting_origin
     OR NEW.posted_at IS DISTINCT FROM OLD.posted_at OR NEW.posted_by IS DISTINCT FROM OLD.posted_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.document_number_allocation_id IS DISTINCT FROM OLD.document_number_allocation_id
     OR NEW.external_reference IS DISTINCT FROM OLD.external_reference OR NEW.note IS DISTINCT FROM OLD.note
  THEN RAISE EXCEPTION 'payable_documents_are_immutable'; END IF;

  IF OLD.status='reversed' THEN RAISE EXCEPTION 'invalid_payable_status_transition'; END IF;

  IF NEW.allocated_amount IS DISTINCT FROM OLD.allocated_amount
     OR NEW.remaining_amount IS DISTINCT FROM OLD.remaining_amount
     OR (NEW.status IS DISTINCT FROM OLD.status AND NEW.status<>'reversed') THEN
    IF NOT allocation_update_allowed THEN RAISE EXCEPTION 'payable_allocation_update_requires_function'; END IF;
    IF NEW.allocated_amount<0 OR NEW.allocated_amount>NEW.original_amount
       OR NEW.remaining_amount<>NEW.original_amount-NEW.allocated_amount
       OR NEW.status<>accounting.payable_status_for_amounts(NEW.original_amount,NEW.allocated_amount) THEN
      RAISE EXCEPTION 'invalid_payable_allocation_projection';
    END IF;
  END IF;

  IF NEW.status='reversed' AND OLD.status<>'reversed' THEN
    IF OLD.allocated_amount<>0 OR NEW.allocated_amount<>0 OR NEW.remaining_amount<>0 THEN
      RAISE EXCEPTION 'payable_allocation_exists';
    END IF;
    IF EXISTS (
      SELECT 1 FROM accounting.payable_allocations a
      LEFT JOIN accounting.payable_allocation_reversals r
        ON r.installation_id=a.installation_id AND r.allocation_id=a.id
      WHERE a.installation_id=OLD.installation_id
        AND (a.source_payable_document_id=OLD.id OR a.target_payable_document_id=OLD.id)
        AND r.id IS NULL
    ) THEN RAISE EXCEPTION 'payable_allocation_exists'; END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NOT allocation_update_allowed THEN
    RAISE EXCEPTION 'invalid_payable_status_transition';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS payable_documents_guard ON accounting.payable_documents;
CREATE TRIGGER payable_documents_guard BEFORE UPDATE OR DELETE ON accounting.payable_documents
FOR EACH ROW EXECUTE FUNCTION accounting.guard_payable_document_mutation();

CREATE OR REPLACE FUNCTION accounting.create_payable_allocation(
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
) RETURNS accounting.payable_allocations
LANGUAGE plpgsql AS $$
DECLARE
  source_doc accounting.payable_documents%ROWTYPE;
  target_doc accounting.payable_documents%ROWTYPE;
  created accounting.payable_allocations%ROWTYPE;
BEGIN
  IF p_amount IS NULL OR p_amount<=0 THEN RAISE EXCEPTION 'invalid_allocation_amount'; END IF;

  PERFORM id FROM accounting.payable_documents
   WHERE installation_id=p_installation_id AND id IN (p_source_id,p_target_id)
   ORDER BY id FOR UPDATE;

  SELECT * INTO source_doc FROM accounting.payable_documents
   WHERE installation_id=p_installation_id AND id=p_source_id;
  SELECT * INTO target_doc FROM accounting.payable_documents
   WHERE installation_id=p_installation_id AND id=p_target_id;

  IF source_doc.id IS NULL OR target_doc.id IS NULL THEN RAISE EXCEPTION 'payable_document_not_found'; END IF;
  IF source_doc.direction<>'CREDIT' OR source_doc.document_type NOT IN ('SUPPLIER_PAYMENT','SUPPLIER_RETURN_CREDIT')
     OR source_doc.status='reversed' THEN RAISE EXCEPTION 'invalid_allocation_source'; END IF;
  IF target_doc.direction<>'DEBIT' OR target_doc.document_type<>'GOODS_RECEIPT'
     OR target_doc.status='reversed' THEN RAISE EXCEPTION 'invalid_allocation_target'; END IF;
  IF source_doc.supplier_id<>target_doc.supplier_id THEN RAISE EXCEPTION 'allocation_supplier_mismatch'; END IF;
  IF source_doc.warehouse_id<>target_doc.warehouse_id THEN RAISE EXCEPTION 'allocation_warehouse_mismatch'; END IF;
  IF source_doc.currency_code<>target_doc.currency_code THEN RAISE EXCEPTION 'allocation_currency_mismatch'; END IF;
  IF p_amount>source_doc.remaining_amount THEN RAISE EXCEPTION 'allocation_exceeds_source_remaining'; END IF;
  IF p_amount>target_doc.remaining_amount THEN RAISE EXCEPTION 'allocation_exceeds_target_remaining'; END IF;

  INSERT INTO accounting.payable_allocations(
    id,installation_id,source_payable_document_id,target_payable_document_id,
    amount,allocation_date,source_revision_before,target_revision_before,
    actor_id,request_id,source_app,created_at,metadata
  ) VALUES (
    p_id,p_installation_id,p_source_id,p_target_id,p_amount,p_allocation_date,
    source_doc.revision,target_doc.revision,p_actor_id,p_request_id,p_source_app,now(),COALESCE(p_metadata,'{}'::jsonb)
  ) RETURNING * INTO created;

  PERFORM set_config('npp.payable_allocation_update','on',true);
  UPDATE accounting.payable_documents
     SET allocated_amount=allocated_amount+p_amount,
         remaining_amount=remaining_amount-p_amount,
         status=accounting.payable_status_for_amounts(original_amount,allocated_amount+p_amount),
         revision=revision+1,updated_at=now(),updated_by=p_actor_id
   WHERE installation_id=p_installation_id AND id=p_source_id;
  UPDATE accounting.payable_documents
     SET allocated_amount=allocated_amount+p_amount,
         remaining_amount=remaining_amount-p_amount,
         status=accounting.payable_status_for_amounts(original_amount,allocated_amount+p_amount),
         revision=revision+1,updated_at=now(),updated_by=p_actor_id
   WHERE installation_id=p_installation_id AND id=p_target_id;
  PERFORM set_config('npp.payable_allocation_update','off',true);
  RETURN created;
END;
$$;

CREATE OR REPLACE FUNCTION accounting.reverse_payable_allocation(
  p_reversal_id uuid,
  p_installation_id text,
  p_allocation_id uuid,
  p_reason text,
  p_actor_id text,
  p_request_id text,
  p_source_app text,
  p_reversed_at timestamptz,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS accounting.payable_allocation_reversals
LANGUAGE plpgsql AS $$
DECLARE
  allocation accounting.payable_allocations%ROWTYPE;
  source_doc accounting.payable_documents%ROWTYPE;
  target_doc accounting.payable_documents%ROWTYPE;
  created accounting.payable_allocation_reversals%ROWTYPE;
BEGIN
  SELECT * INTO allocation FROM accounting.payable_allocations
   WHERE installation_id=p_installation_id AND id=p_allocation_id FOR UPDATE;
  IF allocation.id IS NULL THEN RAISE EXCEPTION 'payable_allocation_not_found'; END IF;
  IF EXISTS (SELECT 1 FROM accounting.payable_allocation_reversals
             WHERE installation_id=p_installation_id AND allocation_id=p_allocation_id) THEN
    RAISE EXCEPTION 'payable_allocation_already_reversed';
  END IF;

  PERFORM id FROM accounting.payable_documents
   WHERE installation_id=p_installation_id
     AND id IN (allocation.source_payable_document_id,allocation.target_payable_document_id)
   ORDER BY id FOR UPDATE;
  SELECT * INTO source_doc FROM accounting.payable_documents
   WHERE installation_id=p_installation_id AND id=allocation.source_payable_document_id;
  SELECT * INTO target_doc FROM accounting.payable_documents
   WHERE installation_id=p_installation_id AND id=allocation.target_payable_document_id;
  IF source_doc.status='reversed' OR target_doc.status='reversed' THEN RAISE EXCEPTION 'allocated_document_reversed'; END IF;
  IF source_doc.allocated_amount<allocation.amount OR target_doc.allocated_amount<allocation.amount THEN
    RAISE EXCEPTION 'invalid_allocation_projection';
  END IF;

  INSERT INTO accounting.payable_allocation_reversals(
    id,installation_id,allocation_id,reason,actor_id,request_id,source_app,reversed_at,metadata
  ) VALUES (
    p_reversal_id,p_installation_id,p_allocation_id,btrim(p_reason),p_actor_id,p_request_id,p_source_app,
    p_reversed_at,COALESCE(p_metadata,'{}'::jsonb)
  ) RETURNING * INTO created;

  PERFORM set_config('npp.payable_allocation_update','on',true);
  UPDATE accounting.payable_documents
     SET allocated_amount=allocated_amount-allocation.amount,
         remaining_amount=remaining_amount+allocation.amount,
         status=accounting.payable_status_for_amounts(original_amount,allocated_amount-allocation.amount),
         revision=revision+1,updated_at=p_reversed_at,updated_by=p_actor_id
   WHERE installation_id=p_installation_id AND id=allocation.source_payable_document_id;
  UPDATE accounting.payable_documents
     SET allocated_amount=allocated_amount-allocation.amount,
         remaining_amount=remaining_amount+allocation.amount,
         status=accounting.payable_status_for_amounts(original_amount,allocated_amount-allocation.amount),
         revision=revision+1,updated_at=p_reversed_at,updated_by=p_actor_id
   WHERE installation_id=p_installation_id AND id=allocation.target_payable_document_id;
  PERFORM set_config('npp.payable_allocation_update','off',true);
  RETURN created;
END;
$$;

CREATE OR REPLACE VIEW accounting.active_payable_allocations AS
SELECT a.*
  FROM accounting.payable_allocations a
  LEFT JOIN accounting.payable_allocation_reversals r
    ON r.installation_id=a.installation_id AND r.allocation_id=a.id
 WHERE r.id IS NULL;
