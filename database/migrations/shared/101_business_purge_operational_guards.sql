-- Complete the controlled delete path for operational facts reached by the
-- application-owned business purge.  Ordinary writes stay protected by their
-- existing trigger functions; only DELETE is routed through this guard.

CREATE OR REPLACE FUNCTION shared.guard_business_purge_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF shared.business_purge_delete_allowed(OLD.installation_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '%', COALESCE(NULLIF(TG_ARGV[0], ''), 'business_history_is_append_only');
END;
$$;

-- Inventory ledger and stock-control history.
DROP TRIGGER IF EXISTS inventory_movements_append_only ON inventory.inventory_movements;
CREATE TRIGGER inventory_movements_append_only
BEFORE UPDATE ON inventory.inventory_movements
FOR EACH ROW EXECUTE FUNCTION inventory.prevent_inventory_ledger_mutation();
CREATE TRIGGER inventory_movements_purge_delete_guard
BEFORE DELETE ON inventory.inventory_movements
FOR EACH ROW EXECUTE FUNCTION shared.guard_business_purge_delete('inventory_ledger_rows_are_append_only');

DROP TRIGGER IF EXISTS inventory_movement_lines_append_only ON inventory.inventory_movement_lines;
CREATE TRIGGER inventory_movement_lines_append_only
BEFORE UPDATE ON inventory.inventory_movement_lines
FOR EACH ROW EXECUTE FUNCTION inventory.prevent_inventory_ledger_mutation();
CREATE TRIGGER inventory_movement_lines_purge_delete_guard
BEFORE DELETE ON inventory.inventory_movement_lines
FOR EACH ROW EXECUTE FUNCTION shared.guard_business_purge_delete('inventory_ledger_rows_are_append_only');

DROP TRIGGER IF EXISTS stocktake_lines_history_guard ON inventory.stocktake_lines;
CREATE TRIGGER stocktake_lines_history_guard
BEFORE UPDATE ON inventory.stocktake_lines
FOR EACH ROW EXECUTE FUNCTION inventory.guard_stocktake_history();
CREATE TRIGGER stocktake_lines_purge_delete_guard
BEFORE DELETE ON inventory.stocktake_lines
FOR EACH ROW EXECUTE FUNCTION shared.guard_business_purge_delete('stocktake_history_is_append_only');

DROP TRIGGER IF EXISTS inventory_adjustment_lifecycle_guard ON inventory.inventory_adjustments;
CREATE TRIGGER inventory_adjustment_lifecycle_guard
BEFORE UPDATE ON inventory.inventory_adjustments
FOR EACH ROW EXECUTE FUNCTION inventory.guard_inventory_adjustment_lifecycle();
CREATE TRIGGER inventory_adjustments_purge_delete_guard
BEFORE DELETE ON inventory.inventory_adjustments
FOR EACH ROW EXECUTE FUNCTION shared.guard_business_purge_delete('inventory_adjustment_history_is_append_only');

DROP TRIGGER IF EXISTS inventory_adjustment_line_guard ON inventory.inventory_adjustment_lines;
CREATE TRIGGER inventory_adjustment_line_guard
BEFORE INSERT OR UPDATE ON inventory.inventory_adjustment_lines
FOR EACH ROW EXECUTE FUNCTION inventory.guard_inventory_adjustment_line();
CREATE TRIGGER inventory_adjustment_lines_purge_delete_guard
BEFORE DELETE ON inventory.inventory_adjustment_lines
FOR EACH ROW EXECUTE FUNCTION shared.guard_business_purge_delete('inventory_adjustment_history_is_append_only');

-- Customer receivable documents are part of operational data, but normal
-- application paths continue to require the receivable service context.
DROP TRIGGER IF EXISTS receivable_documents_write_guard ON accounting.receivable_documents;
CREATE TRIGGER receivable_documents_write_guard
BEFORE INSERT OR UPDATE ON accounting.receivable_documents
FOR EACH ROW EXECUTE FUNCTION accounting.guard_receivable_document_write();
CREATE TRIGGER receivable_documents_purge_delete_guard
BEFORE DELETE ON accounting.receivable_documents
FOR EACH ROW EXECUTE FUNCTION shared.guard_business_purge_delete('receivable_documents_cannot_be_deleted');

DROP TRIGGER IF EXISTS receivable_document_lines_write_guard ON accounting.receivable_document_lines;
CREATE TRIGGER receivable_document_lines_write_guard
BEFORE INSERT OR UPDATE ON accounting.receivable_document_lines
FOR EACH ROW EXECUTE FUNCTION accounting.guard_receivable_append_only();
CREATE TRIGGER receivable_document_lines_purge_delete_guard
BEFORE DELETE ON accounting.receivable_document_lines
FOR EACH ROW EXECUTE FUNCTION shared.guard_business_purge_delete('receivable_history_is_append_only');

DROP TRIGGER IF EXISTS receivable_ledger_entries_write_guard ON accounting.receivable_ledger_entries;
CREATE TRIGGER receivable_ledger_entries_write_guard
BEFORE INSERT OR UPDATE ON accounting.receivable_ledger_entries
FOR EACH ROW EXECUTE FUNCTION accounting.guard_receivable_append_only();
CREATE TRIGGER receivable_ledger_entries_purge_delete_guard
BEFORE DELETE ON accounting.receivable_ledger_entries
FOR EACH ROW EXECUTE FUNCTION shared.guard_business_purge_delete('receivable_history_is_append_only');

-- Delivery and logistics facts are normally insert-only.  The purge deletes their
-- children first, so each existing guard remains in force for INSERT/UPDATE.
DROP TRIGGER IF EXISTS delivery_orders_write_guard ON sales.delivery_orders;
CREATE TRIGGER delivery_orders_write_guard
BEFORE INSERT OR UPDATE ON sales.delivery_orders
FOR EACH ROW EXECUTE FUNCTION sales.guard_delivery_order_header_write();
DROP TRIGGER IF EXISTS delivery_orders_reversal_guard ON sales.delivery_orders;
CREATE TRIGGER delivery_orders_reversal_guard
BEFORE UPDATE ON sales.delivery_orders
FOR EACH ROW EXECUTE FUNCTION sales.guard_delivery_order_reversal_write();
CREATE TRIGGER delivery_orders_purge_delete_guard
BEFORE DELETE ON sales.delivery_orders
FOR EACH ROW EXECUTE FUNCTION shared.guard_business_purge_delete('delivery_order_delete_forbidden');

DROP TRIGGER IF EXISTS delivery_order_lines_write_guard ON sales.delivery_order_lines;
CREATE TRIGGER delivery_order_lines_write_guard
BEFORE INSERT OR UPDATE ON sales.delivery_order_lines
FOR EACH ROW EXECUTE FUNCTION sales.guard_delivery_order_line_write();
CREATE TRIGGER delivery_order_lines_purge_delete_guard
BEFORE DELETE ON sales.delivery_order_lines
FOR EACH ROW EXECUTE FUNCTION shared.guard_business_purge_delete('delivery_order_lines_are_immutable');

DROP TRIGGER IF EXISTS delivery_order_events_write_guard ON sales.delivery_order_events;
CREATE TRIGGER delivery_order_events_write_guard
BEFORE INSERT OR UPDATE ON sales.delivery_order_events
FOR EACH ROW EXECUTE FUNCTION sales.guard_delivery_order_event_write();
CREATE TRIGGER delivery_order_events_purge_delete_guard
BEFORE DELETE ON sales.delivery_order_events
FOR EACH ROW EXECUTE FUNCTION shared.guard_business_purge_delete('delivery_order_events_are_append_only');

DROP TRIGGER IF EXISTS delivery_attempt_lines_write_guard ON logistics.delivery_attempt_lines;
CREATE TRIGGER delivery_attempt_lines_write_guard
BEFORE INSERT OR UPDATE ON logistics.delivery_attempt_lines
FOR EACH ROW EXECUTE FUNCTION logistics.guard_delivery_attempt_line_write();
CREATE TRIGGER delivery_attempt_lines_purge_delete_guard
BEFORE DELETE ON logistics.delivery_attempt_lines
FOR EACH ROW EXECUTE FUNCTION shared.guard_business_purge_delete('delivery_attempt_lines_are_immutable');

DROP TRIGGER IF EXISTS delivery_attempt_proofs_write_guard ON logistics.delivery_attempt_proofs;
CREATE TRIGGER delivery_attempt_proofs_write_guard
BEFORE INSERT OR UPDATE ON logistics.delivery_attempt_proofs
FOR EACH ROW EXECUTE FUNCTION logistics.guard_delivery_attempt_proof_write();
CREATE TRIGGER delivery_attempt_proofs_purge_delete_guard
BEFORE DELETE ON logistics.delivery_attempt_proofs
FOR EACH ROW EXECUTE FUNCTION shared.guard_business_purge_delete('delivery_attempt_proofs_are_immutable');

DROP TRIGGER IF EXISTS delivery_attempts_write_guard ON logistics.delivery_attempts;
CREATE TRIGGER delivery_attempts_write_guard
BEFORE INSERT OR UPDATE ON logistics.delivery_attempts
FOR EACH ROW EXECUTE FUNCTION logistics.guard_delivery_attempt_write();
CREATE TRIGGER delivery_attempts_purge_delete_guard
BEFORE DELETE ON logistics.delivery_attempts
FOR EACH ROW EXECUTE FUNCTION shared.guard_business_purge_delete('delivery_attempts_are_immutable');

-- The delivery issue, return and trip records below form one factual chain.  They
-- remain service-owned on ordinary writes; the guarded path is solely for the
-- authorised, installation-scoped business purge.
DROP TRIGGER IF EXISTS delivery_order_inventory_issues_write_guard ON sales.delivery_order_inventory_issues;
CREATE TRIGGER delivery_order_inventory_issues_write_guard
BEFORE INSERT OR UPDATE ON sales.delivery_order_inventory_issues
FOR EACH ROW EXECUTE FUNCTION sales.guard_delivery_issue_header_write();
CREATE TRIGGER delivery_order_inventory_issues_purge_delete_guard
BEFORE DELETE ON sales.delivery_order_inventory_issues
FOR EACH ROW EXECUTE FUNCTION shared.guard_business_purge_delete('delivery_issue_is_immutable');

DROP TRIGGER IF EXISTS delivery_order_inventory_issue_lines_write_guard ON sales.delivery_order_inventory_issue_lines;
CREATE TRIGGER delivery_order_inventory_issue_lines_write_guard
BEFORE INSERT OR UPDATE ON sales.delivery_order_inventory_issue_lines
FOR EACH ROW EXECUTE FUNCTION sales.guard_delivery_issue_line_write();
CREATE TRIGGER delivery_order_inventory_issue_lines_purge_delete_guard
BEFORE DELETE ON sales.delivery_order_inventory_issue_lines
FOR EACH ROW EXECUTE FUNCTION shared.guard_business_purge_delete('delivery_issue_lines_are_immutable');

DROP TRIGGER IF EXISTS customer_returns_write_guard ON sales.customer_returns;
CREATE TRIGGER customer_returns_write_guard
BEFORE INSERT OR UPDATE ON sales.customer_returns
FOR EACH ROW EXECUTE FUNCTION sales.guard_customer_return_header_write();
CREATE TRIGGER customer_returns_purge_delete_guard
BEFORE DELETE ON sales.customer_returns
FOR EACH ROW EXECUTE FUNCTION shared.guard_business_purge_delete('customer_returns_are_immutable');

DROP TRIGGER IF EXISTS customer_return_events_write_guard ON sales.customer_return_events;
CREATE TRIGGER customer_return_events_write_guard
BEFORE INSERT OR UPDATE ON sales.customer_return_events
FOR EACH ROW EXECUTE FUNCTION sales.guard_customer_return_event_write();
CREATE TRIGGER customer_return_events_purge_delete_guard
BEFORE DELETE ON sales.customer_return_events
FOR EACH ROW EXECUTE FUNCTION shared.guard_business_purge_delete('customer_return_events_are_append_only');

DROP TRIGGER IF EXISTS customer_return_lines_write_guard ON sales.customer_return_lines;
CREATE TRIGGER customer_return_lines_write_guard
BEFORE INSERT OR UPDATE ON sales.customer_return_lines
FOR EACH ROW EXECUTE FUNCTION sales.guard_customer_return_line_write();
CREATE TRIGGER customer_return_lines_purge_delete_guard
BEFORE DELETE ON sales.customer_return_lines
FOR EACH ROW EXECUTE FUNCTION shared.guard_business_purge_delete('customer_return_lines_are_immutable');

DROP TRIGGER IF EXISTS customer_return_receipt_lines_write_guard ON sales.customer_return_receipt_lines;
CREATE TRIGGER customer_return_receipt_lines_write_guard
BEFORE INSERT OR UPDATE ON sales.customer_return_receipt_lines
FOR EACH ROW EXECUTE FUNCTION sales.guard_customer_return_receipt_line_write();
CREATE TRIGGER customer_return_receipt_lines_purge_delete_guard
BEFORE DELETE ON sales.customer_return_receipt_lines
FOR EACH ROW EXECUTE FUNCTION shared.guard_business_purge_delete('customer_return_receipt_lines_are_append_only');

DROP TRIGGER IF EXISTS delivery_trips_write_guard ON logistics.delivery_trips;
CREATE TRIGGER delivery_trips_write_guard
BEFORE INSERT OR UPDATE ON logistics.delivery_trips
FOR EACH ROW EXECUTE FUNCTION logistics.guard_trip_header_write();
CREATE TRIGGER delivery_trips_purge_delete_guard
BEFORE DELETE ON logistics.delivery_trips
FOR EACH ROW EXECUTE FUNCTION shared.guard_business_purge_delete('logistics_trip_is_immutable');

DROP TRIGGER IF EXISTS trip_stops_write_guard ON logistics.trip_stops;
CREATE TRIGGER trip_stops_write_guard
BEFORE INSERT OR UPDATE ON logistics.trip_stops
FOR EACH ROW EXECUTE FUNCTION logistics.guard_trip_child_write();
CREATE TRIGGER trip_stops_purge_delete_guard
BEFORE DELETE ON logistics.trip_stops
FOR EACH ROW EXECUTE FUNCTION shared.guard_business_purge_delete('logistics_trip_child_is_immutable');

DROP TRIGGER IF EXISTS trip_order_assignments_write_guard ON logistics.trip_order_assignments;
CREATE TRIGGER trip_order_assignments_write_guard
BEFORE INSERT OR UPDATE ON logistics.trip_order_assignments
FOR EACH ROW EXECUTE FUNCTION logistics.guard_trip_child_write();
CREATE TRIGGER trip_order_assignments_purge_delete_guard
BEFORE DELETE ON logistics.trip_order_assignments
FOR EACH ROW EXECUTE FUNCTION shared.guard_business_purge_delete('logistics_trip_child_is_immutable');

DROP TRIGGER IF EXISTS trip_dispatch_items_write_guard ON logistics.trip_dispatch_items;
CREATE TRIGGER trip_dispatch_items_write_guard
BEFORE INSERT OR UPDATE ON logistics.trip_dispatch_items
FOR EACH ROW EXECUTE FUNCTION logistics.guard_trip_dispatch_item_write();
CREATE TRIGGER trip_dispatch_items_purge_delete_guard
BEFORE DELETE ON logistics.trip_dispatch_items
FOR EACH ROW EXECUTE FUNCTION shared.guard_business_purge_delete('trip_dispatch_items_are_immutable');

-- Fulfillment reservations, allocations and their append-only events are part of
-- the same sales execution graph.  Retain their context-specific writers for
-- INSERT/UPDATE while allowing only the deletion-intent transaction to delete.
DROP TRIGGER IF EXISTS inventory_reservation_events_append_only ON inventory.inventory_reservation_events;
CREATE TRIGGER inventory_reservation_events_append_only
BEFORE UPDATE ON inventory.inventory_reservation_events
FOR EACH ROW EXECUTE FUNCTION inventory.prevent_reservation_event_mutation();
CREATE TRIGGER inventory_reservation_events_purge_delete_guard
BEFORE DELETE ON inventory.inventory_reservation_events
FOR EACH ROW EXECUTE FUNCTION shared.guard_business_purge_delete('inventory_reservation_events_are_append_only');

DROP TRIGGER IF EXISTS inventory_reservations_writer_guard ON inventory.inventory_reservations;
CREATE TRIGGER inventory_reservations_writer_guard
BEFORE INSERT OR UPDATE ON inventory.inventory_reservations
FOR EACH ROW EXECUTE FUNCTION inventory.guard_inventory_reservation_write();
CREATE TRIGGER inventory_reservations_purge_delete_guard
BEFORE DELETE ON inventory.inventory_reservations
FOR EACH ROW EXECUTE FUNCTION shared.guard_business_purge_delete('inventory_reservations_are_immutable');

DROP TRIGGER IF EXISTS sales_order_fulfillment_demands_writer_guard ON sales.sales_order_fulfillment_demands;
CREATE TRIGGER sales_order_fulfillment_demands_writer_guard
BEFORE INSERT OR UPDATE ON sales.sales_order_fulfillment_demands
FOR EACH ROW EXECUTE FUNCTION sales.guard_sales_order_fulfillment_demand_write();
DROP TRIGGER IF EXISTS sales_order_fulfillment_demands_reversal_guard ON sales.sales_order_fulfillment_demands;
CREATE TRIGGER sales_order_fulfillment_demands_reversal_guard
BEFORE INSERT OR UPDATE ON sales.sales_order_fulfillment_demands
FOR EACH ROW
WHEN (current_setting('npp.sales_fulfillment_write_context', true) = 'fulfillment_reversal_service')
EXECUTE FUNCTION sales.guard_sales_order_fulfillment_demand_reversal_write();
CREATE TRIGGER sales_order_fulfillment_demands_purge_delete_guard
BEFORE DELETE ON sales.sales_order_fulfillment_demands
FOR EACH ROW EXECUTE FUNCTION shared.guard_business_purge_delete('sales_fulfillment_demand_is_immutable');

DROP TRIGGER IF EXISTS sales_order_fulfillment_allocations_writer_guard ON sales.sales_order_fulfillment_allocations;
CREATE TRIGGER sales_order_fulfillment_allocations_writer_guard
BEFORE INSERT OR UPDATE ON sales.sales_order_fulfillment_allocations
FOR EACH ROW
WHEN (
  current_setting('npp.sales_fulfillment_allocation_write_context', true)
    IS DISTINCT FROM 'fulfillment_reversal_service'
  AND current_setting('npp.sales_fulfillment_allocation_write_context', true)
    IS DISTINCT FROM 'fulfillment_release_service'
)
EXECUTE FUNCTION sales.guard_sales_order_fulfillment_allocation_write();
DROP TRIGGER IF EXISTS sales_order_fulfillment_allocations_release_guard ON sales.sales_order_fulfillment_allocations;
CREATE TRIGGER sales_order_fulfillment_allocations_release_guard
BEFORE INSERT OR UPDATE ON sales.sales_order_fulfillment_allocations
FOR EACH ROW
WHEN (current_setting('npp.sales_fulfillment_allocation_write_context', true) = 'fulfillment_release_service')
EXECUTE FUNCTION sales.guard_sales_order_fulfillment_allocation_release_write();
DROP TRIGGER IF EXISTS sales_order_fulfillment_allocations_reversal_guard ON sales.sales_order_fulfillment_allocations;
CREATE TRIGGER sales_order_fulfillment_allocations_reversal_guard
BEFORE INSERT OR UPDATE ON sales.sales_order_fulfillment_allocations
FOR EACH ROW
WHEN (current_setting('npp.sales_fulfillment_allocation_write_context', true) = 'fulfillment_reversal_service')
EXECUTE FUNCTION sales.guard_sales_order_fulfillment_allocation_reversal_write();
CREATE TRIGGER sales_order_fulfillment_allocations_purge_delete_guard
BEFORE DELETE ON sales.sales_order_fulfillment_allocations
FOR EACH ROW EXECUTE FUNCTION shared.guard_business_purge_delete('sales_fulfillment_allocation_is_immutable');

DROP TRIGGER IF EXISTS sales_order_fulfillment_allocation_events_writer_guard ON sales.sales_order_fulfillment_allocation_events;
CREATE TRIGGER sales_order_fulfillment_allocation_events_writer_guard
BEFORE INSERT OR UPDATE ON sales.sales_order_fulfillment_allocation_events
FOR EACH ROW
WHEN (
  current_setting('npp.sales_fulfillment_allocation_write_context', true)
    IS DISTINCT FROM 'fulfillment_reversal_service'
  AND current_setting('npp.sales_fulfillment_allocation_write_context', true)
    IS DISTINCT FROM 'fulfillment_release_service'
)
EXECUTE FUNCTION sales.guard_sales_order_fulfillment_allocation_event_write();
DROP TRIGGER IF EXISTS sales_order_fulfillment_allocation_events_release_guard ON sales.sales_order_fulfillment_allocation_events;
CREATE TRIGGER sales_order_fulfillment_allocation_events_release_guard
BEFORE INSERT OR UPDATE ON sales.sales_order_fulfillment_allocation_events
FOR EACH ROW
WHEN (current_setting('npp.sales_fulfillment_allocation_write_context', true) = 'fulfillment_release_service')
EXECUTE FUNCTION sales.guard_sales_order_fulfillment_allocation_release_event_write();
DROP TRIGGER IF EXISTS sales_order_fulfillment_allocation_events_reversal_guard ON sales.sales_order_fulfillment_allocation_events;
CREATE TRIGGER sales_order_fulfillment_allocation_events_reversal_guard
BEFORE INSERT OR UPDATE ON sales.sales_order_fulfillment_allocation_events
FOR EACH ROW
WHEN (current_setting('npp.sales_fulfillment_allocation_write_context', true) = 'fulfillment_reversal_service')
EXECUTE FUNCTION sales.guard_sales_order_fulfillment_allocation_reversal_event_write();
CREATE TRIGGER sales_order_fulfillment_allocation_events_purge_delete_guard
BEFORE DELETE ON sales.sales_order_fulfillment_allocation_events
FOR EACH ROW EXECUTE FUNCTION shared.guard_business_purge_delete('sales_fulfillment_allocation_events_are_append_only');
