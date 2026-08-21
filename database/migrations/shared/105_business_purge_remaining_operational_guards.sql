-- Extend the authorised business-data purge to operational tables whose ordinary
-- write guards also listen for DELETE. Normal application deletes keep their exact
-- existing guard; only the transaction-scoped PURGING intent bypasses that guard.
--
-- This migration intentionally does not disable triggers, use replication-role
-- bypasses, or truncate tables. It splits mixed write/delete triggers so the purge
-- remains deny-by-default outside one authorised deletion transaction.

DO $$
DECLARE
  spec record;
  qualified_table text;
  ordinary_delete_trigger text;
  purge_delete_trigger text;
BEGIN
  FOR spec IN
    SELECT *
    FROM (VALUES
      -- Sales Order immutable commercial history.
      ('sales', 'sales_order_versions', 'sales_order_versions_immutable', 'UPDATE', 'sales.guard_sales_order_version_mutation', 'sales_order_version_locked'),
      ('sales', 'sales_order_version_lines', 'sales_order_version_lines_draft_only', 'INSERT OR UPDATE', 'sales.guard_sales_order_line_mutation', 'sales_order_version_lines_locked'),

      -- Customer receivable allocation / return-credit history.
      ('accounting', 'receivable_allocations', 'receivable_allocations_write_guard', 'INSERT OR UPDATE', 'accounting.guard_receivable_allocation_history', 'receivable_allocation_history_is_append_only'),
      ('accounting', 'receivable_allocation_reversals', 'receivable_allocation_reversals_write_guard', 'INSERT OR UPDATE', 'accounting.guard_receivable_allocation_history', 'receivable_allocation_history_is_append_only'),
      ('accounting', 'customer_return_adjustment_lines', 'customer_return_adjustment_lines_write_guard', 'INSERT OR UPDATE', 'accounting.guard_customer_return_credit_history', 'customer_return_credit_history_is_append_only'),
      ('accounting', 'customer_return_adjustment_reversals', 'customer_return_adjustment_reversals_write_guard', 'INSERT OR UPDATE', 'accounting.guard_customer_return_credit_history', 'customer_return_credit_history_is_append_only'),
      ('accounting', 'customer_refunds', 'customer_refunds_write_guard', 'INSERT OR UPDATE', 'accounting.guard_customer_return_credit_history', 'customer_return_credit_history_is_append_only'),
      ('accounting', 'customer_refund_reversals', 'customer_refund_reversals_write_guard', 'INSERT OR UPDATE', 'accounting.guard_customer_return_credit_history', 'customer_return_credit_history_is_append_only'),

      -- COD custody history.
      ('accounting', 'cod_collections', 'cod_collections_write_guard', 'INSERT OR UPDATE', 'accounting.guard_cod_history', 'cod_history_is_append_only'),
      ('accounting', 'cod_collection_reversals', 'cod_collection_reversals_write_guard', 'INSERT OR UPDATE', 'accounting.guard_cod_history', 'cod_history_is_append_only'),
      ('accounting', 'cod_cash_handovers', 'cod_cash_handovers_write_guard', 'INSERT OR UPDATE', 'accounting.guard_cod_history', 'cod_history_is_append_only'),
      ('accounting', 'cod_cash_handover_lines', 'cod_cash_handover_lines_write_guard', 'INSERT OR UPDATE', 'accounting.guard_cod_history', 'cod_history_is_append_only'),
      ('accounting', 'cod_cash_handover_reversals', 'cod_cash_handover_reversals_write_guard', 'INSERT OR UPDATE', 'accounting.guard_cod_history', 'cod_history_is_append_only'),
      ('accounting', 'cod_cash_acceptances', 'cod_cash_acceptances_write_guard', 'INSERT OR UPDATE', 'accounting.guard_cod_history', 'cod_history_is_append_only'),
      ('accounting', 'cod_cash_acceptance_reversals', 'cod_cash_acceptance_reversals_write_guard', 'INSERT OR UPDATE', 'accounting.guard_cod_history', 'cod_history_is_append_only'),

      -- Inventory projections and immutable opening-balance history.
      ('inventory', 'inventory_balances', 'inventory_balances_writer_guard', 'INSERT OR UPDATE', 'inventory.guard_inventory_balance_write', 'inventory_balance_write_requires_projector'),
      ('inventory', 'inventory_lots', 'inventory_lots_append_only', 'UPDATE', 'inventory.prevent_inventory_lot_mutation', 'inventory_lots_are_append_only'),
      ('inventory', 'opening_balance_imports', 'opening_balance_imports_append_only', 'UPDATE', 'inventory.prevent_opening_balance_mutation', 'opening_balance_imports_are_append_only'),
      ('inventory', 'opening_balance_import_rows', 'opening_balance_import_rows_append_only', 'UPDATE', 'inventory.prevent_opening_balance_mutation', 'opening_balance_imports_are_append_only'),

      -- Warehouse transfer lifecycle and append-only receipt/resolution history.
      ('inventory', 'inventory_transfers', 'inventory_transfers_locked_state_guard', 'UPDATE', 'inventory.guard_inventory_transfer_mutation', 'inventory_transfer_is_locked'),
      ('inventory', 'inventory_transfer_lines', 'inventory_transfer_lines_locked_state_guard', 'UPDATE', 'inventory.guard_inventory_transfer_line_mutation', 'inventory_transfer_lines_are_locked'),
      ('inventory', 'inventory_transfer_receipts', 'inventory_transfer_receipts_append_only', 'UPDATE', 'inventory.prevent_inventory_transfer_resolution_mutation', 'inventory_transfer_resolution_rows_are_append_only'),
      ('inventory', 'inventory_transfer_receipt_lines', 'inventory_transfer_receipt_lines_append_only', 'UPDATE', 'inventory.prevent_inventory_transfer_resolution_mutation', 'inventory_transfer_resolution_rows_are_append_only'),
      ('inventory', 'inventory_transfer_damage_approvals', 'inventory_transfer_damage_approvals_append_only', 'UPDATE', 'inventory.prevent_inventory_transfer_resolution_mutation', 'inventory_transfer_resolution_rows_are_append_only'),
      ('inventory', 'inventory_transfer_short_closures', 'inventory_transfer_short_closures_append_only', 'UPDATE', 'inventory.prevent_inventory_transfer_resolution_mutation', 'inventory_transfer_resolution_rows_are_append_only'),
      ('inventory', 'inventory_transfer_short_closure_lines', 'inventory_transfer_short_closure_lines_append_only', 'UPDATE', 'inventory.prevent_inventory_transfer_resolution_mutation', 'inventory_transfer_resolution_rows_are_append_only'),
      ('inventory', 'inventory_transfer_receipt_reversals', 'inventory_transfer_receipt_reversals_append_only', 'UPDATE', 'inventory.prevent_inventory_transfer_resolution_mutation', 'inventory_transfer_resolution_rows_are_append_only'),

      -- Costing facts/projections and period history.
      ('inventory', 'inventory_cost_rebuild_runs', 'inventory_cost_runs_append_only', 'UPDATE', 'inventory.guard_inventory_cost_append_only', 'inventory_cost_facts_are_append_only'),
      ('inventory', 'inventory_cost_facts', 'inventory_cost_facts_append_only', 'UPDATE', 'inventory.guard_inventory_cost_append_only', 'inventory_cost_facts_are_append_only'),
      ('inventory', 'inventory_cost_anomalies', 'inventory_cost_anomalies_append_only', 'UPDATE', 'inventory.guard_inventory_cost_append_only', 'inventory_cost_facts_are_append_only'),
      ('inventory', 'inventory_cost_balances', 'inventory_cost_balances_projector_only', 'INSERT OR UPDATE', 'inventory.guard_inventory_cost_balance_write', 'inventory_cost_balances_projector_only'),
      ('inventory', 'inventory_costing_periods', 'inventory_costing_periods_transition_guard', 'UPDATE', 'inventory.guard_inventory_costing_period_transition', 'inventory_costing_periods_are_not_deletable'),
      ('inventory', 'inventory_cost_period_balances', 'inventory_cost_period_balances_append_only', 'UPDATE', 'inventory.guard_inventory_cost_phase76_append_only', 'inventory_cost_phase76_facts_are_append_only'),
      ('inventory', 'inventory_cost_adjustment_events', 'inventory_cost_adjustment_events_append_only', 'UPDATE', 'inventory.guard_inventory_cost_phase76_append_only', 'inventory_cost_phase76_facts_are_append_only'),

      -- Manual inbound documents are immutable after posting.
      ('inventory', 'manual_inbound_documents', 'manual_inbound_documents_append_only', 'UPDATE', 'inventory.prevent_manual_inbound_mutation', 'manual_inbound_documents_are_append_only'),
      ('inventory', 'manual_inbound_document_lines', 'manual_inbound_document_lines_append_only', 'UPDATE', 'inventory.prevent_manual_inbound_mutation', 'manual_inbound_documents_are_append_only'),

      -- MCP audit history can share the installation purge when that schema is present.
      ('mcp', 'audit_events', 'mcp_audit_events_append_only', 'UPDATE', 'mcp.reject_audit_event_mutation', 'mcp_audit_events_append_only')
    ) AS v(schema_name, table_name, original_trigger, write_events, function_name, denial_code)
  LOOP
    qualified_table := format('%I.%I', spec.schema_name, spec.table_name);
    IF to_regclass(qualified_table) IS NULL THEN
      CONTINUE;
    END IF;

    ordinary_delete_trigger := spec.table_name || '_delete_guard';
    purge_delete_trigger := spec.table_name || '_purge_delete_guard';

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %s', spec.original_trigger, qualified_table);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %s', ordinary_delete_trigger, qualified_table);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %s', purge_delete_trigger, qualified_table);

    -- Preserve every non-delete mutation under the original domain guard.
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE %s ON %s FOR EACH ROW EXECUTE FUNCTION %s()',
      spec.original_trigger,
      spec.write_events,
      qualified_table,
      spec.function_name
    );

    -- Preserve the original DELETE contract outside an authorised purge.
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE DELETE ON %s FOR EACH ROW '
      || 'WHEN (NOT shared.business_purge_delete_allowed(OLD.installation_id)) '
      || 'EXECUTE FUNCTION %s()',
      ordinary_delete_trigger,
      qualified_table,
      spec.function_name
    );

    -- Only the exact PURGING intent in this transaction may take the cleanup path.
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE DELETE ON %s FOR EACH ROW '
      || 'WHEN (shared.business_purge_delete_allowed(OLD.installation_id)) '
      || 'EXECUTE FUNCTION shared.guard_business_purge_delete(%L)',
      purge_delete_trigger,
      qualified_table,
      spec.denial_code
    );
  END LOOP;
END $$;
