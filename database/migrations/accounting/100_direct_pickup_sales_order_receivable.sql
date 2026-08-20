-- Issue #675 Lô 2: canonical receivable for direct Sales Order pickup.
-- This keeps the existing Giao thủ công shape intact and adds the equivalent
-- direct pickup shape without inventing a Delivery Order or inventory issue row.

ALTER TABLE accounting.receivable_documents
  DROP CONSTRAINT IF EXISTS receivable_documents_source_document_type_check,
  DROP CONSTRAINT IF EXISTS receivable_documents_business_shape_check;

ALTER TABLE accounting.receivable_documents
  ADD CONSTRAINT receivable_documents_source_document_type_check CHECK (
    source_document_type IN (
      'DELIVERY_ATTEMPT', 'PICKUP_HANDOVER', 'CUSTOMER_PAYMENT',
      'CUSTOMER_RETURN', 'CUSTOMER_REFUND', 'MANUAL_HANDOVER', 'MANUAL_SALES_ORDER',
      'DIRECT_PICKUP_SALES_ORDER'
    )
  ),
  ADD CONSTRAINT receivable_documents_business_shape_check CHECK (
    (
      document_type IN ('SALE_DELIVERY', 'SALE_PICKUP')
      AND direction = 'DEBIT'
      AND source_document_type NOT IN ('MANUAL_SALES_ORDER', 'DIRECT_PICKUP_SALES_ORDER')
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
      document_type = 'SALE_PICKUP'
      AND direction = 'DEBIT'
      AND source_document_type = 'DIRECT_PICKUP_SALES_ORDER'
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

CREATE OR REPLACE FUNCTION accounting.sync_manual_sales_order_settlement_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  next_status text;
BEGIN
  IF NEW.source_document_type NOT IN ('MANUAL_SALES_ORDER', 'DIRECT_PICKUP_SALES_ORDER')
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
