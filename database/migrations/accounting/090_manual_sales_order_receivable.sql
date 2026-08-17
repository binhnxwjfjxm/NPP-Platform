-- Issue #622 Lô 4: direct receivable lineage for Sales Orders using Giao thủ công.
-- Inventory OUT remains owned by Lô 3. This migration only enables accounting
-- documents to point directly at the Sales Order when no Delivery Order exists.

ALTER TABLE accounting.receivable_documents
  DROP CONSTRAINT IF EXISTS receivable_documents_source_document_type_check,
  DROP CONSTRAINT IF EXISTS receivable_documents_business_shape_check;

ALTER TABLE accounting.receivable_document_lines
  ALTER COLUMN delivery_order_line_id DROP NOT NULL,
  ALTER COLUMN inventory_issue_line_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS receivable_document_lines_delivery_lineage_shape_check;

ALTER TABLE accounting.receivable_documents
  ADD CONSTRAINT receivable_documents_source_document_type_check CHECK (
    source_document_type IN (
      'DELIVERY_ATTEMPT', 'PICKUP_HANDOVER', 'CUSTOMER_PAYMENT',
      'CUSTOMER_RETURN', 'CUSTOMER_REFUND', 'MANUAL_HANDOVER', 'MANUAL_SALES_ORDER'
    )
  ),
  ADD CONSTRAINT receivable_documents_business_shape_check CHECK (
    (
      document_type IN ('SALE_DELIVERY', 'SALE_PICKUP')
      AND direction = 'DEBIT'
      AND source_document_type <> 'MANUAL_SALES_ORDER'
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
      document_type = 'SALE_DELIVERY'
      AND direction = 'DEBIT'
      AND source_document_type = 'MANUAL_SALES_ORDER'
      AND source_document_id = sales_order_id
      AND sales_order_id IS NOT NULL
      AND sales_order_version_id IS NOT NULL
      AND delivery_order_id IS NULL
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

ALTER TABLE accounting.receivable_document_lines
  ADD CONSTRAINT receivable_document_lines_delivery_lineage_shape_check CHECK (
    (delivery_order_line_id IS NULL AND delivery_attempt_line_id IS NULL AND inventory_issue_line_id IS NULL)
    OR (delivery_order_line_id IS NOT NULL AND inventory_issue_line_id IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION accounting.sync_manual_sales_order_settlement_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  next_status text;
BEGIN
  IF NEW.source_document_type IS DISTINCT FROM 'MANUAL_SALES_ORDER'
     OR NEW.sales_order_id IS NULL THEN
    RETURN NEW;
  END IF;

  next_status := CASE NEW.status
    WHEN 'settled' THEN 'paid'
    WHEN 'partially_allocated' THEN 'partially_paid'
    WHEN 'open' THEN 'pending'
    WHEN 'reversed' THEN 'not_due'
    ELSE NULL
  END;

  IF next_status IS NOT NULL THEN
    UPDATE sales.sales_orders
       SET settlement_status = next_status,
           updated_at = now(),
           updated_by = NEW.updated_by
     WHERE installation_id = NEW.installation_id
       AND id = NEW.sales_order_id
       AND settlement_status IS DISTINCT FROM next_status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS receivable_documents_manual_sales_order_settlement
  ON accounting.receivable_documents;
CREATE TRIGGER receivable_documents_manual_sales_order_settlement
AFTER INSERT OR UPDATE OF status, allocated_amount, remaining_amount
ON accounting.receivable_documents
FOR EACH ROW EXECUTE FUNCTION accounting.sync_manual_sales_order_settlement_status();