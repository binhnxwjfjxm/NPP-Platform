import { readFileSync } from 'node:fs';
import {
  CORE_API_MIGRATIONS as CORE_API_MIGRATIONS_THROUGH_045,
  runMigrations,
} from './index-through-045.js';

/* Compatibility markers owned by index-through-045.js:
 * 042_sales_fulfillment_reservation_demand
 * 043_sales_fulfillment_allocation_pick_pack
 * 044_sales_delivery_order_handover
 * 045_sales_inventory_issue_customer_return
 */

function sql(path) {
  return readFileSync(new URL(`../../../../database/migrations/${path}`, import.meta.url), 'utf8');
}
function migration(id, paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  return Object.freeze({ id, sql: list.map(sql).join('\n\n') });
}

export const CORE_API_MIGRATIONS = Object.freeze([
  ...CORE_API_MIGRATIONS_THROUGH_045,
  migration('046_logistics_trip_planning', ['logistics/046_logistics_trip_planning.sql', 'logistics/046_logistics_trip_planning_constraints.sql']),
  migration('047_logistics_trip_dispatch', 'logistics/047_logistics_trip_dispatch.sql'),
  migration('048_logistics_driver_delivery_read', 'logistics/048_logistics_driver_delivery_read.sql'),
  migration('049_logistics_delivery_attempts', 'logistics/049_logistics_delivery_attempts.sql'),
  migration('050_logistics_delivery_attempt_outbox_schedule', 'logistics/050_logistics_delivery_attempt_outbox_schedule.sql'),
  migration('051_logistics_trip_reconciliation', ['logistics/051_logistics_trip_reconciliation.sql', 'logistics/051_logistics_trip_reconciliation_hardening.sql']),
  migration('052_logistics_optional_proof_of_delivery', 'logistics/052_logistics_optional_proof_of_delivery.sql'),
  migration('053_customer_receivable_ledger', ['accounting/053_customer_receivable_ledger.sql', 'accounting/053_customer_receivable_pickup_reversal.sql']),
  migration('054_customer_payment_allocation', ['accounting/054_customer_payment_allocation.sql', 'accounting/054_customer_payment_allocation_hardening.sql']),
  migration('055_customer_return_credit_refund', ['accounting/055_customer_return_credit_refund_schema.sql', 'accounting/055_customer_return_credit_refund_posting.sql', 'accounting/055_customer_return_credit_refund_actions.sql']),
  migration('056_cod_collection_handover', ['accounting/056_cod_collection_handover_schema.sql', 'accounting/056_cod_collection_handover_projections.sql']),
  migration('057_phase6f_reconciliation_views', 'reporting/057_phase6f_reconciliation_views.sql'),
  migration('058_inventory_transfer_in_transit_foundation', 'inventory/058_inventory_transfer_in_transit_foundation.sql'),
  migration('059_inventory_transfer_receipt_resolution', 'inventory/059_inventory_transfer_receipt_resolution.sql'),
  migration('060_inventory_stocktake', 'inventory/060_inventory_stocktake.sql'),
  migration('061_inventory_adjustments', 'inventory/061_inventory_adjustments.sql'),
  migration('062_inventory_costing_foundation', 'inventory/062_inventory_costing_foundation.sql'),
  migration('063_inventory_costing_periods_backdate', 'inventory/063_inventory_costing_periods_backdate.sql'),
  migration('064_reporting_permission_catalog', 'shared/064_reporting_permission_catalog.sql'),
  migration('065_reporting_inventory_permission_catalog', 'shared/065_reporting_inventory_permission_catalog.sql'),
  migration('066_reporting_aging_gross_margin_permission_catalog', 'shared/066_reporting_aging_gross_margin_permission_catalog.sql'),
  migration('067_reporting_employee_mcp_permission_catalog', 'shared/067_reporting_employee_mcp_permission_catalog.sql'),
  migration('068_reporting_logistics_permission_catalog', 'shared/068_reporting_logistics_permission_catalog.sql'),
  migration('069_reporting_cod_permission_catalog', 'shared/069_reporting_cod_permission_catalog.sql'),
  migration('070_reporting_operations_history_control_tower', 'reporting/070_reporting_operations_history_control_tower.sql'),
  migration('071_customer_portal_order_intake', 'sales/071_customer_portal_order_intake.sql'),
  migration('072_customer_portal_registration_onboarding', 'sales/072_customer_portal_registration_onboarding.sql'),
  migration('073_internal_workforce_auth', 'shared/073_internal_workforce_auth.sql'),
  migration('074_internal_web_login_challenge', 'shared/074_internal_web_login_challenge.sql'),
  migration('075_logistics_trip_stop_reorder_constraint', 'logistics/075_logistics_trip_stop_reorder_constraint.sql'),
  migration('076_logistics_driver_employee_integrity', 'logistics/076_logistics_driver_employee_integrity.sql'),
  migration('077_document_numbering_active_series', 'shared/077_document_numbering_active_series.sql'),
  migration('078_customer_address_location_url', 'shared/078_customer_address_location_url.sql'),
  migration('079_customer_media', 'shared/079_customer_media.sql'),
  migration('080_manual_delivery_handover', 'sales/080_manual_delivery_handover.sql'),
  Object.freeze({ id: '081_sales_fulfillment_shortage_discrepancy', sql: sql('sales/081_sales_fulfillment_shortage_discrepancy.sql') }),
  Object.freeze({
    id: '082_sales_fulfillment_reversal',
    sql: [
      sql('sales/082_sales_fulfillment_reversal.sql'),
      sql('sales/082b_sales_delivery_reversal_hardening.sql'),
      sql('logistics/082_logistics_trip_recovery.sql'),
    ].join('\n\n'),
  }),
  Object.freeze({ id: '083_backup_delete_foundation', sql: sql('shared/083_backup_delete_foundation.sql') }),
  migration('084_mcp_field_profile_verification', 'sales/084_mcp_field_profile_verification.sql'),
  migration('085_mcp_sales_order_employee_provenance', 'sales/085_mcp_sales_order_employee_provenance.sql'),
  Object.freeze({ id: '086_mcp_workforce_permission_catalog', sql: sql('shared/086_mcp_workforce_permission_catalog.sql') }),
  Object.freeze({ id: '087_technical_backup_access', sql: sql('shared/087_technical_backup_access.sql') }),
  migration('088_selective_business_data_purge', 'shared/088_selective_business_data_purge.sql'),
  migration('089_sales_delivery_execution_mode', 'sales/089_sales_delivery_execution_mode.sql'),
  migration('090_manual_sales_order_receivable', 'accounting/090_manual_sales_order_receivable.sql'),
  migration('091_manual_inbound_foundation', 'inventory/091_manual_inbound_foundation.sql'),
  migration('092_sales_shared_stock_hold', 'sales/092_sales_shared_stock_hold.sql'),
  migration('093_product_inventory_management_policy', 'shared/093_product_inventory_management_policy.sql'),
  migration('094_manual_delivery_allocation_release', 'sales/094_manual_delivery_allocation_release.sql'),
  migration('095_manual_sales_order_receivable_delivery_order_nullable', 'accounting/095_manual_sales_order_receivable_delivery_order_nullable.sql'),
  migration('096_sales_order_unwind_locked_trip', 'logistics/096_sales_order_unwind_locked_trip.sql'),
  migration('097_customer_payment_remitting_employee', 'accounting/097_customer_payment_remitting_employee.sql'),
  migration('098_document_print_template_settings', 'shared/098_document_print_template_settings.sql'),
  migration('099_business_purge_guarded_delete', 'shared/099_business_purge_guarded_delete.sql'),
  migration('100_direct_pickup_sales_order_receivable', 'accounting/100_direct_pickup_sales_order_receivable.sql'),
  migration('101_business_purge_operational_guards', 'shared/101_business_purge_operational_guards.sql'),
  migration('102_document_print_template_heading', 'shared/102_document_print_template_heading.sql'),
  Object.freeze({ id: '103_sales_order_execution_close_fulfillment', sql: sql('sales/103_sales_order_execution_close_fulfillment.sql') }),
  Object.freeze({ id: '104_sales_order_execution_close_partial_release', sql: sql('sales/104_sales_order_execution_close_partial_release.sql') }),
  migration('105_business_purge_remaining_operational_guards', 'shared/105_business_purge_remaining_operational_guards.sql'),
  migration('106_business_purge_document_number_allocations', 'shared/106_business_purge_document_number_allocations.sql'),
  migration('108_management_proposals', 'shared/108_management_proposals.sql'),
  migration('109_management_proposal_source_roundtrip', 'shared/109_management_proposal_source_roundtrip.sql'),
  migration('110_management_proposal_optional_details', 'shared/110_management_proposal_optional_details.sql'),
  migration('111_ai_usage_metering', 'shared/111_ai_usage_metering.sql'),
  migration('112_ai_website_anonymous_usage', 'shared/112_ai_website_anonymous_usage.sql'),
  migration('113_ai_dialogflow_cx_request_billing', 'shared/113_ai_dialogflow_cx_request_billing.sql'),
  migration('114_sales_order_permission_metadata', 'shared/114_sales_order_permission_metadata.sql'),
  migration('115_sales_order_split_line_identity', 'sales/115_sales_order_split_line_identity.sql'),
  migration('116_controlled_negative_stock', 'inventory/116_controlled_negative_stock.sql'),
  Object.freeze({ id: '117_sku_weight_sales_order_snapshot', sql: sql('shared/117_sku_weight_sales_order_snapshot.sql') }),
  Object.freeze({ id: '118_sales_order_employee_visibility', sql: sql('shared/118_sales_order_employee_visibility.sql') }),
  Object.freeze({ id: '119_retail_print_agent', sql: sql('shared/119_retail_print_agent.sql') }),
  Object.freeze({ id: '120_reporting_sales_dimension_snapshots', sql: sql('sales/120_reporting_sales_dimension_snapshots.sql') }),
]);

export { runMigrations };
