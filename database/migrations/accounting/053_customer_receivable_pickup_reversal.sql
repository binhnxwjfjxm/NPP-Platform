-- Phase 6F.1: keep pickup inventory reversal and customer receivable reversal atomic.
-- Delivery attempts are immutable; the only existing 6F.1 source correction path is
-- reversal of a posted PICKUP_HANDOVER inventory issue.

CREATE OR REPLACE FUNCTION accounting.reverse_pickup_receivable_on_inventory_reversal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  receivable accounting.receivable_documents%ROWTYPE;
  previous_write_context text := current_setting('npp.receivable_write_context', true);
  reversal_entry_id uuid;
BEGIN
  IF OLD.status IS DISTINCT FROM 'POSTED'
     OR NEW.status IS DISTINCT FROM 'REVERSED'
     OR NEW.issue_source_type IS DISTINCT FROM 'PICKUP_HANDOVER' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO receivable
    FROM accounting.receivable_documents
   WHERE installation_id = NEW.installation_id
     AND source_document_type = 'PICKUP_HANDOVER'
     AND source_document_id = NEW.id
   FOR UPDATE;

  IF NOT FOUND OR receivable.status = 'reversed' THEN
    RETURN NEW;
  END IF;

  IF receivable.allocated_amount <> 0 OR receivable.status <> 'open' THEN
    RAISE EXCEPTION 'receivable_reversal_requires_unallocated_open_document';
  END IF;

  IF NEW.reversed_at IS NULL OR NEW.reversed_by IS NULL OR NEW.reversal_reason IS NULL THEN
    RAISE EXCEPTION 'pickup_receivable_reversal_source_incomplete';
  END IF;

  PERFORM set_config('npp.receivable_write_context', 'receivable_service', true);

  UPDATE accounting.receivable_documents
     SET status = 'reversed',
         reversed_at = NEW.reversed_at,
         reversed_by = NEW.reversed_by,
         reversal_reason = NEW.reversal_reason,
         revision = revision + 1,
         updated_at = NEW.reversed_at,
         updated_by = NEW.reversed_by
   WHERE installation_id = receivable.installation_id
     AND id = receivable.id;

  reversal_entry_id := md5(
    NEW.installation_id || ':PICKUP_HANDOVER:' || NEW.id::text || ':SALE_REVERSE'
  )::uuid;

  INSERT INTO accounting.receivable_ledger_entries (
    id,
    installation_id,
    receivable_document_id,
    customer_id,
    currency_code,
    entry_type,
    amount,
    source_document_type,
    source_document_id,
    source_document_number,
    source_revision,
    document_status_after,
    actor_id,
    request_id,
    source_app,
    occurred_at,
    metadata
  ) VALUES (
    reversal_entry_id,
    receivable.installation_id,
    receivable.id,
    receivable.customer_id,
    receivable.currency_code,
    'SALE_REVERSE',
    -receivable.original_amount,
    'PICKUP_HANDOVER',
    NEW.id,
    receivable.source_document_number,
    receivable.source_revision,
    'reversed',
    NEW.reversed_by,
    left('inventory-reversal:' || NEW.id::text, 128),
    'core.inventory-reversal-trigger',
    NEW.reversed_at,
    jsonb_build_object(
      'deliveryOrderId', NEW.delivery_order_id,
      'inventoryIssueId', NEW.id,
      'inventoryMovementId', NEW.inventory_movement_id,
      'inventoryReversalMovementId', NEW.inventory_reversal_movement_id,
      'reason', NEW.reversal_reason
    )
  );

  PERFORM set_config(
    'npp.receivable_write_context',
    COALESCE(previous_write_context, ''),
    true
  );
  RETURN NEW;
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

DROP TRIGGER IF EXISTS delivery_inventory_issue_reverse_receivable
  ON sales.delivery_order_inventory_issues;
CREATE TRIGGER delivery_inventory_issue_reverse_receivable
AFTER UPDATE OF status ON sales.delivery_order_inventory_issues
FOR EACH ROW
EXECUTE FUNCTION accounting.reverse_pickup_receivable_on_inventory_reversal();
