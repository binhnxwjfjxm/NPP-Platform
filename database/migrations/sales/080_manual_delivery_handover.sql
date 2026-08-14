-- Task 1: manual Delivery Order handover + accounting lineage.
-- Extends the existing packed -> Delivery Order -> Inventory OUT -> receivable flow
-- without creating a parallel manual-sales ledger or bypassing exact reservation lineage.

INSERT INTO shared.permission_catalog (
  permission_key, module, label, description, is_system, created_at
) VALUES (
  'core.delivery-order.manual-handover',
  'Giao nhận',
  'Xác nhận giao thủ công',
  'Cho phép NPP Operations xác nhận giao trực tiếp một Delivery Order giao tận nơi đã sẵn sàng, ghi Inventory OUT và công nợ theo lượng thực giao.',
  true,
  now()
)
ON CONFLICT (permission_key) DO UPDATE
SET module = EXCLUDED.module,
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    is_system = EXCLUDED.is_system;

ALTER TABLE sales.delivery_order_inventory_issues
  DROP CONSTRAINT IF EXISTS delivery_order_inventory_issues_issue_source_type_check;
ALTER TABLE sales.delivery_order_inventory_issues
  ADD CONSTRAINT delivery_order_inventory_issues_issue_source_type_check
  CHECK (issue_source_type IN ('LOGISTICS_DISPATCH', 'PICKUP_HANDOVER', 'MANUAL_HANDOVER'));

ALTER TABLE sales.delivery_order_inventory_issues
  DROP CONSTRAINT IF EXISTS delivery_order_inventory_issues_pickup_shape;
ALTER TABLE sales.delivery_order_inventory_issues
  DROP CONSTRAINT IF EXISTS delivery_order_inventory_issues_receiver_shape;
ALTER TABLE sales.delivery_order_inventory_issues
  ADD CONSTRAINT delivery_order_inventory_issues_receiver_shape CHECK (
    issue_source_type NOT IN ('PICKUP_HANDOVER', 'MANUAL_HANDOVER') OR receiver_name IS NOT NULL
  );

ALTER TABLE sales.delivery_order_events
  DROP CONSTRAINT IF EXISTS delivery_order_events_event_type_check;
ALTER TABLE sales.delivery_order_events
  ADD CONSTRAINT delivery_order_events_event_type_check CHECK (event_type IN (
    'CREATED', 'CONFIRMED', 'CANCELLED',
    'INVENTORY_ISSUED', 'PICKUP_HANDED_OVER', 'MANUAL_HANDED_OVER',
    'INVENTORY_ISSUE_REVERSED'
  ));

ALTER TABLE accounting.receivable_documents
  DROP CONSTRAINT IF EXISTS receivable_documents_source_document_type_check;
ALTER TABLE accounting.receivable_documents
  ADD CONSTRAINT receivable_documents_source_document_type_check
  CHECK (source_document_type IN ('DELIVERY_ATTEMPT', 'PICKUP_HANDOVER', 'MANUAL_HANDOVER'));

-- Accepted delivery is a per-Sales-Order-line fact. Do not sum quantities across SKUs.
-- The projection is derived from non-reversed SALE_DELIVERY receivable lines because
-- those rows are created only from accepted physical delivery facts.
CREATE OR REPLACE FUNCTION sales.refresh_sales_order_accepted_delivery_status(
  p_installation_id text,
  p_sales_order_id uuid,
  p_actor_id text
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  projected_status text;
BEGIN
  WITH target AS (
    SELECT orders.id,
           orders.delivery_mode,
           orders.delivery_status,
           version.id AS sales_order_version_id
      FROM sales.sales_orders orders
      JOIN sales.sales_order_versions version
        ON version.installation_id = orders.installation_id
       AND version.sales_order_id = orders.id
       AND version.version_number = orders.current_version_number
       AND version.version_status = 'confirmed'
     WHERE orders.installation_id = p_installation_id
       AND orders.id = p_sales_order_id
       AND orders.status = 'confirmed'
  ),
  expected AS (
    SELECT line.id AS sales_order_line_id,
           line.base_quantity
      FROM target
      JOIN sales.sales_order_version_lines line
        ON line.installation_id = p_installation_id
       AND line.sales_order_version_id = target.sales_order_version_id
  ),
  accepted AS (
    SELECT line.sales_order_line_id,
           sum(line.accepted_base_quantity)::numeric(30,12) AS accepted_base_quantity
      FROM accounting.receivable_document_lines line
      JOIN accounting.receivable_documents document
        ON document.installation_id = line.installation_id
       AND document.id = line.receivable_document_id
     WHERE line.installation_id = p_installation_id
       AND document.sales_order_id = p_sales_order_id
       AND document.document_type = 'SALE_DELIVERY'
       AND document.status <> 'reversed'
     GROUP BY line.sales_order_line_id
  ),
  accepted_state AS (
    SELECT count(*)::integer AS line_count,
           count(*) FILTER (
             WHERE COALESCE(accepted.accepted_base_quantity, 0) >= expected.base_quantity
           )::integer AS completed_line_count,
           COALESCE(bool_or(COALESCE(accepted.accepted_base_quantity, 0) > 0), false) AS has_accepted
      FROM expected
      LEFT JOIN accepted USING (sales_order_line_id)
  ),
  fallback AS (
    SELECT CASE
      WHEN EXISTS (
        SELECT 1
          FROM sales.delivery_orders delivery_order
         WHERE delivery_order.installation_id = p_installation_id
           AND delivery_order.sales_order_id = p_sales_order_id
           AND delivery_order.status = 'dispatched'
      ) THEN 'dispatched'
      WHEN EXISTS (
        SELECT 1
          FROM sales.delivery_orders delivery_order
         WHERE delivery_order.installation_id = p_installation_id
           AND delivery_order.sales_order_id = p_sales_order_id
           AND delivery_order.status = 'ready_to_dispatch'
      ) THEN 'ready_to_dispatch'
      ELSE 'pending'
    END AS status
  )
  SELECT CASE
    WHEN target.delivery_mode <> 'DELIVERY' THEN target.delivery_status
    WHEN accepted_state.line_count > 0
         AND accepted_state.completed_line_count = accepted_state.line_count THEN 'delivered'
    WHEN accepted_state.has_accepted THEN 'partially_delivered'
    ELSE fallback.status
  END
    INTO projected_status
    FROM target
    CROSS JOIN accepted_state
    CROSS JOIN fallback;

  IF projected_status IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE sales.sales_orders
     SET delivery_status = projected_status,
         updated_at = now(),
         updated_by = p_actor_id
   WHERE installation_id = p_installation_id
     AND id = p_sales_order_id
     AND status = 'confirmed'
     AND delivery_status IS DISTINCT FROM projected_status;

  RETURN projected_status;
END;
$$;

-- Generalize the existing pickup-only correction so manual delivery reversal also
-- removes the receivable atomically. A receivable that already has allocations stays
-- fail-closed: accounting correction must happen before inventory reversal.
CREATE OR REPLACE FUNCTION accounting.reverse_handover_receivable_on_inventory_reversal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  receivable accounting.receivable_documents%ROWTYPE;
  previous_write_context text := current_setting('npp.receivable_write_context', true);
  reversal_entry_id uuid;
  source_type text;
BEGIN
  IF OLD.status IS DISTINCT FROM 'POSTED'
     OR NEW.status IS DISTINCT FROM 'REVERSED'
     OR NEW.issue_source_type NOT IN ('PICKUP_HANDOVER', 'MANUAL_HANDOVER') THEN
    RETURN NEW;
  END IF;

  source_type := NEW.issue_source_type;

  SELECT * INTO receivable
    FROM accounting.receivable_documents
   WHERE installation_id = NEW.installation_id
     AND source_document_type = source_type
     AND source_document_id = NEW.id
   FOR UPDATE;

  IF NOT FOUND OR receivable.status = 'reversed' THEN
    RETURN NEW;
  END IF;

  IF receivable.allocated_amount <> 0 OR receivable.status <> 'open' THEN
    RAISE EXCEPTION 'receivable_reversal_requires_unallocated_open_document';
  END IF;

  IF NEW.reversed_at IS NULL OR NEW.reversed_by IS NULL OR NEW.reversal_reason IS NULL THEN
    IF source_type = 'PICKUP_HANDOVER' THEN
      RAISE EXCEPTION 'pickup_receivable_reversal_source_incomplete';
    END IF;
    RAISE EXCEPTION 'manual_receivable_reversal_source_incomplete';
  END IF;

  PERFORM set_config('npp.receivable_write_context', 'receivable_service', true);

  UPDATE accounting.receivable_documents
     SET status = 'reversed',
         remaining_amount = 0,
         reversed_at = NEW.reversed_at,
         reversed_by = NEW.reversed_by,
         reversal_reason = NEW.reversal_reason,
         revision = revision + 1,
         updated_at = NEW.reversed_at,
         updated_by = NEW.reversed_by
   WHERE installation_id = receivable.installation_id
     AND id = receivable.id;

  reversal_entry_id := md5(
    NEW.installation_id || ':' || source_type || ':' || NEW.id::text || ':SALE_REVERSE'
  )::uuid;

  INSERT INTO accounting.receivable_ledger_entries (
    id, installation_id, receivable_document_id, customer_id, currency_code,
    entry_type, amount, source_document_type, source_document_id,
    source_document_number, source_revision, document_status_after,
    actor_id, request_id, source_app, occurred_at, metadata
  ) VALUES (
    reversal_entry_id,
    receivable.installation_id,
    receivable.id,
    receivable.customer_id,
    receivable.currency_code,
    'SALE_REVERSE',
    -receivable.original_amount,
    source_type,
    NEW.id,
    receivable.source_document_number,
    receivable.source_revision,
    'reversed',
    NEW.reversed_by,
    left('inventory-reversal-' || NEW.id::text, 128),
    'core.inventory-reversal-trigger',
    NEW.reversed_at,
    jsonb_build_object(
      'deliveryOrderId', NEW.delivery_order_id,
      'inventoryIssueId', NEW.id,
      'inventoryMovementId', NEW.inventory_movement_id,
      'inventoryReversalMovementId', NEW.inventory_reversal_movement_id,
      'reason', NEW.reversal_reason,
      'sourceType', source_type
    )
  );

  IF source_type = 'MANUAL_HANDOVER' THEN
    PERFORM sales.refresh_sales_order_accepted_delivery_status(
      NEW.installation_id,
      receivable.sales_order_id,
      NEW.reversed_by
    );
  END IF;

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
EXECUTE FUNCTION accounting.reverse_handover_receivable_on_inventory_reversal();
