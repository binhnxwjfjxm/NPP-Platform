-- Customer Return claim reconciliation for migration 045.
-- Draft rows hold their requested quantity; received rows only hold the quantity
-- physically accepted into the warehouse. Cancelled rows hold no claim.

CREATE OR REPLACE FUNCTION sales.guard_customer_return_line_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  write_context text := current_setting('npp.customer_return_write_context', true);
  source_issue sales.delivery_order_inventory_issues;
  source_issue_line sales.delivery_order_inventory_issue_lines;
  active_claimed numeric(30,12);
BEGIN
  IF write_context IS DISTINCT FROM 'customer_return_service' THEN
    RAISE EXCEPTION 'customer_return_line_requires_service_context';
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'customer_return_lines_are_immutable';
  END IF;

  SELECT * INTO source_issue
    FROM sales.delivery_order_inventory_issues
   WHERE installation_id = NEW.installation_id
     AND id = NEW.issue_id
   FOR UPDATE;

  SELECT * INTO source_issue_line
    FROM sales.delivery_order_inventory_issue_lines
   WHERE installation_id = NEW.installation_id
     AND id = NEW.issue_line_id;

  IF source_issue IS NULL
     OR source_issue.status <> 'POSTED'
     OR source_issue_line IS NULL
     OR source_issue_line.issue_id IS DISTINCT FROM NEW.issue_id
     OR source_issue_line.delivery_order_line_id IS DISTINCT FROM NEW.delivery_order_line_id
     OR source_issue_line.inventory_movement_line_id IS DISTINCT FROM NEW.inventory_movement_line_id
     OR source_issue.inventory_movement_id IS DISTINCT FROM NEW.inventory_movement_id THEN
    RAISE EXCEPTION 'customer_return_origin_mismatch';
  END IF;

  SELECT COALESCE(sum(
           CASE
             WHEN header.status = 'received' THEN COALESCE(receipt.accepted_base_quantity, 0)
             WHEN header.status = 'draft' THEN return_line.requested_base_quantity
             ELSE 0
           END
         ), 0)
    INTO active_claimed
    FROM sales.customer_return_lines return_line
    JOIN sales.customer_returns header
      ON header.installation_id = return_line.installation_id
     AND header.id = return_line.customer_return_id
    LEFT JOIN sales.customer_return_receipt_lines receipt
      ON receipt.installation_id = return_line.installation_id
     AND receipt.customer_return_line_id = return_line.id
   WHERE return_line.installation_id = NEW.installation_id
     AND return_line.issue_line_id = NEW.issue_line_id
     AND header.status IN ('draft', 'received');

  IF active_claimed + NEW.requested_base_quantity > source_issue_line.issued_base_quantity THEN
    RAISE EXCEPTION 'customer_return_quantity_exceeds_issued';
  END IF;

  RETURN NEW;
END;
$$;
