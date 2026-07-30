-- Phase 5.6 hardening: evaluate legitimate payable reversal before allocation projection guards.

CREATE OR REPLACE FUNCTION accounting.guard_payable_document_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  allocation_update_allowed boolean := COALESCE(current_setting('npp.payable_allocation_update',true),'')='on';
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'payable_documents_are_immutable';
  END IF;

  IF NEW.installation_id IS DISTINCT FROM OLD.installation_id
     OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
     OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
     OR NEW.direction IS DISTINCT FROM OLD.direction
     OR NEW.document_type IS DISTINCT FROM OLD.document_type
     OR NEW.source_domain IS DISTINCT FROM OLD.source_domain
     OR NEW.source_document_type IS DISTINCT FROM OLD.source_document_type
     OR NEW.source_document_id IS DISTINCT FROM OLD.source_document_id
     OR NEW.source_document_number IS DISTINCT FROM OLD.source_document_number
     OR NEW.source_document_date IS DISTINCT FROM OLD.source_document_date
     OR NEW.currency_code IS DISTINCT FROM OLD.currency_code
     OR NEW.payment_method_snapshot IS DISTINCT FROM OLD.payment_method_snapshot
     OR NEW.payment_term_days_snapshot IS DISTINCT FROM OLD.payment_term_days_snapshot
     OR NEW.due_date IS DISTINCT FROM OLD.due_date
     OR NEW.original_amount IS DISTINCT FROM OLD.original_amount
     OR NEW.posting_origin IS DISTINCT FROM OLD.posting_origin
     OR NEW.posted_at IS DISTINCT FROM OLD.posted_at
     OR NEW.posted_by IS DISTINCT FROM OLD.posted_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.document_number_allocation_id IS DISTINCT FROM OLD.document_number_allocation_id
     OR NEW.external_reference IS DISTINCT FROM OLD.external_reference
     OR NEW.note IS DISTINCT FROM OLD.note
  THEN
    RAISE EXCEPTION 'payable_documents_are_immutable';
  END IF;

  IF OLD.status='reversed' THEN
    RAISE EXCEPTION 'invalid_payable_status_transition';
  END IF;

  IF NEW.status='reversed' AND OLD.status<>'reversed' THEN
    IF OLD.allocated_amount<>0
       OR NEW.allocated_amount<>0
       OR NEW.remaining_amount<>0
       OR NEW.reversed_at IS NULL
       OR NEW.reversed_by IS NULL
       OR NEW.reversal_reason IS NULL THEN
      RAISE EXCEPTION 'payable_allocation_exists';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM accounting.payable_allocations allocation
        LEFT JOIN accounting.payable_allocation_reversals reversal
          ON reversal.installation_id=allocation.installation_id
         AND reversal.allocation_id=allocation.id
       WHERE allocation.installation_id=OLD.installation_id
         AND (
           allocation.source_payable_document_id=OLD.id
           OR allocation.target_payable_document_id=OLD.id
         )
         AND reversal.id IS NULL
    ) THEN
      RAISE EXCEPTION 'payable_allocation_exists';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.allocated_amount IS DISTINCT FROM OLD.allocated_amount
     OR NEW.remaining_amount IS DISTINCT FROM OLD.remaining_amount
     OR NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT allocation_update_allowed THEN
      RAISE EXCEPTION 'payable_allocation_update_requires_function';
    END IF;
    IF NEW.allocated_amount<0
       OR NEW.allocated_amount>NEW.original_amount
       OR NEW.remaining_amount<>NEW.original_amount-NEW.allocated_amount
       OR NEW.status<>accounting.payable_status_for_amounts(NEW.original_amount,NEW.allocated_amount) THEN
      RAISE EXCEPTION 'invalid_payable_allocation_projection';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payable_documents_guard ON accounting.payable_documents;
CREATE TRIGGER payable_documents_guard
BEFORE UPDATE OR DELETE ON accounting.payable_documents
FOR EACH ROW EXECUTE FUNCTION accounting.guard_payable_document_mutation();
