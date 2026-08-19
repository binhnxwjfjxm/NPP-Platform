-- Controlled delete path for the application-owned business-data purge.
-- Normal business mutations remain immutable. DELETE is allowed only inside the same
-- transaction that has marked one exact deletion intent PURGING for the same installation.

CREATE OR REPLACE FUNCTION shared.business_purge_delete_allowed(p_installation_id text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(p_installation_id, '') <> ''
     AND EXISTS (
       SELECT 1
       FROM shared.data_deletion_intents intent
       WHERE intent.installation_id = p_installation_id
         AND intent.status = 'PURGING'
         AND intent.id::text = NULLIF(current_setting('npp.business_purge_intent_id', true), '')
     );
$$;

CREATE OR REPLACE FUNCTION shared.prevent_core_audit_record_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND shared.business_purge_delete_allowed(OLD.installation_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'core_audit_records_are_append_only';
END;
$$;

CREATE OR REPLACE FUNCTION purchasing.guard_purchase_order_line_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_status text;
  target_installation text;
  target_order uuid;
BEGIN
  IF TG_OP = 'DELETE' AND shared.business_purge_delete_allowed(OLD.installation_id) THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'DELETE' THEN
    target_installation := OLD.installation_id;
    target_order := OLD.purchase_order_id;
  ELSE
    target_installation := NEW.installation_id;
    target_order := NEW.purchase_order_id;
  END IF;

  SELECT status INTO current_status
  FROM purchasing.purchase_orders
  WHERE installation_id = target_installation AND id = target_order;

  IF current_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'purchase_order_lines_locked';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION purchasing.guard_goods_receipt_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF shared.business_purge_delete_allowed(OLD.installation_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'goods_receipts_are_immutable';
  END IF;

  IF OLD.status <> 'draft' THEN
    IF NEW.purchase_order_id IS DISTINCT FROM OLD.purchase_order_id
      OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
      OR NEW.receipt_date IS DISTINCT FROM OLD.receipt_date
      OR NEW.supplier_delivery_reference IS DISTINCT FROM OLD.supplier_delivery_reference
      OR NEW.note IS DISTINCT FROM OLD.note THEN
      RAISE EXCEPTION 'goods_receipts_are_immutable';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION purchasing.guard_goods_receipt_line_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_status text;
  target_installation text;
  target_receipt uuid;
BEGIN
  IF TG_OP = 'DELETE' AND shared.business_purge_delete_allowed(OLD.installation_id) THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'DELETE' THEN
    target_installation := OLD.installation_id;
    target_receipt := OLD.goods_receipt_id;
  ELSE
    target_installation := NEW.installation_id;
    target_receipt := NEW.goods_receipt_id;
  END IF;

  SELECT status INTO current_status
    FROM purchasing.goods_receipts
   WHERE installation_id = target_installation
     AND id = target_receipt;

  IF current_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'goods_receipt_lines_locked';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION purchasing.guard_supplier_return_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_status text;
  target_installation text;
  target_return uuid;
BEGIN
  IF TG_OP = 'DELETE' AND shared.business_purge_delete_allowed(OLD.installation_id) THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'DELETE' THEN
    target_installation := OLD.installation_id;
    target_return := OLD.supplier_return_id;
  ELSE
    target_installation := NEW.installation_id;
    target_return := NEW.supplier_return_id;
  END IF;

  SELECT status INTO current_status
  FROM purchasing.supplier_returns
  WHERE installation_id = target_installation AND id = target_return
  FOR NO KEY UPDATE;

  IF current_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'supplier_returns_locked';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION purchasing.guard_supplier_return_document_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF shared.business_purge_delete_allowed(OLD.installation_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'supplier_returns_are_immutable';
  END IF;

  IF OLD.status <> 'draft' THEN
    IF NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
      OR NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id
      OR NEW.return_date IS DISTINCT FROM OLD.return_date
      OR NEW.note IS DISTINCT FROM OLD.note THEN
      RAISE EXCEPTION 'supplier_returns_are_immutable';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION accounting.reject_payable_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND shared.business_purge_delete_allowed(OLD.installation_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'payable_history_is_append_only';
END;
$$;

CREATE OR REPLACE FUNCTION accounting.reject_payable_allocation_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND shared.business_purge_delete_allowed(OLD.installation_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'payable_allocation_history_is_append_only';
END;
$$;

CREATE OR REPLACE FUNCTION accounting.guard_payable_document_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  allocation_update_allowed boolean := COALESCE(current_setting('npp.payable_allocation_update',true),'')='on';
BEGIN
  IF TG_OP='DELETE' THEN
    IF shared.business_purge_delete_allowed(OLD.installation_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'payable_documents_are_immutable';
  END IF;

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
