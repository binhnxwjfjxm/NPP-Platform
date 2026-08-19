-- Customer-payment office flow: keep the optional employee who remits money
-- distinct from the authenticated actor who records the receipt.

UPDATE shared.permission_catalog
   SET description = 'Cho phép đọc phiếu thu và lịch sử ghi tiền vào đơn trong phạm vi kho được cấp.'
 WHERE permission_key = 'core.customer-payment.read';

UPDATE shared.permission_catalog
   SET label = 'Hủy phiếu thu khách hàng',
       description = 'Cho phép hủy phiếu thu không còn khoản nào đang ghi vào đơn, với lý do bắt buộc.'
 WHERE permission_key = 'core.customer-payment.reverse';

UPDATE shared.permission_catalog
   SET label = 'Ghi tiền thu vào công nợ',
       description = 'Cho phép ghi một phiếu thu vào một hoặc nhiều khoản phải thu trong phạm vi được cấp.'
 WHERE permission_key = 'core.receivable-allocation.create';

UPDATE shared.permission_catalog
   SET label = 'Hủy phần tiền đã ghi',
       description = 'Cho phép hủy phần tiền đã ghi và lưu đầy đủ lịch sử điều chỉnh.'
 WHERE permission_key = 'core.receivable-allocation.reverse';

ALTER TABLE accounting.receivable_documents
  ADD COLUMN IF NOT EXISTS remitting_employee_id uuid NULL,
  ADD COLUMN IF NOT EXISTS remitting_employee_code_snapshot text NULL,
  ADD COLUMN IF NOT EXISTS remitting_employee_name_snapshot text NULL;

ALTER TABLE accounting.receivable_documents
  DROP CONSTRAINT IF EXISTS receivable_documents_remitting_employee_fk,
  DROP CONSTRAINT IF EXISTS receivable_documents_remitting_employee_shape_check;

ALTER TABLE accounting.receivable_documents
  ADD CONSTRAINT receivable_documents_remitting_employee_fk
    FOREIGN KEY (installation_id, remitting_employee_id)
    REFERENCES shared.employees (installation_id, id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
    NOT VALID,
  ADD CONSTRAINT receivable_documents_remitting_employee_shape_check CHECK (
    (
      remitting_employee_id IS NULL
      AND remitting_employee_code_snapshot IS NULL
      AND remitting_employee_name_snapshot IS NULL
    )
    OR
    (
      document_type = 'CUSTOMER_PAYMENT'
      AND remitting_employee_id IS NOT NULL
      AND remitting_employee_code_snapshot IS NOT NULL
      AND remitting_employee_name_snapshot IS NOT NULL
      AND char_length(btrim(remitting_employee_code_snapshot)) BETWEEN 1 AND 64
      AND char_length(btrim(remitting_employee_name_snapshot)) BETWEEN 1 AND 256
    )
  ) NOT VALID;

ALTER TABLE accounting.receivable_documents
  VALIDATE CONSTRAINT receivable_documents_remitting_employee_fk;

ALTER TABLE accounting.receivable_documents
  VALIDATE CONSTRAINT receivable_documents_remitting_employee_shape_check;

CREATE INDEX IF NOT EXISTS receivable_documents_remitting_employee_idx
  ON accounting.receivable_documents (
    installation_id, remitting_employee_id, source_document_date DESC, id
  )
  WHERE remitting_employee_id IS NOT NULL;

COMMENT ON COLUMN accounting.receivable_documents.remitting_employee_id IS
  'Optional employee who remitted customer money; distinct from posted_by.';
COMMENT ON COLUMN accounting.receivable_documents.remitting_employee_code_snapshot IS
  'Employee code preserved at customer-payment posting time.';
COMMENT ON COLUMN accounting.receivable_documents.remitting_employee_name_snapshot IS
  'Employee name preserved at customer-payment posting time.';

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
       OR NEW.note IS DISTINCT FROM OLD.note
       OR NEW.remitting_employee_id IS DISTINCT FROM OLD.remitting_employee_id
       OR NEW.remitting_employee_code_snapshot IS DISTINCT FROM OLD.remitting_employee_code_snapshot
       OR NEW.remitting_employee_name_snapshot IS DISTINCT FROM OLD.remitting_employee_name_snapshot THEN
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
