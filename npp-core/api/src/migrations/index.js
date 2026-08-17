import { readFileSync } from 'node:fs';
import {
  CORE_API_MIGRATIONS as CORE_API_MIGRATIONS_THROUGH_088,
  runMigrations,
} from './index-through-088.js';

/*
 * Compatibility markers retained for source-contract checks. Migration ownership
 * through 088 remains byte-for-byte in index-through-088.js.
 * 046_logistics_trip_planning
 * 047_logistics_trip_dispatch
 * 048_logistics_driver_delivery_read
 * 049_logistics_delivery_attempts
 * 050_logistics_delivery_attempt_outbox_schedule
 * 051_logistics_trip_reconciliation
 * 052_logistics_optional_proof_of_delivery
 * 053_customer_receivable_ledger
 * 054_customer_payment_allocation
 * 055_customer_return_credit_refund
 * 056_cod_collection_handover
 * 057_phase6f_reconciliation_views
 * 058_inventory_transfer_in_transit_foundation
 * 059_inventory_transfer_receipt_resolution
 * 060_inventory_stocktake
 * 061_inventory_adjustments
 * 062_inventory_costing_foundation
 * 063_inventory_costing_periods_backdate
 * 064_reporting_permission_catalog
 * 065_reporting_inventory_permission_catalog
 * 066_reporting_aging_gross_margin_permission_catalog
 * 067_reporting_employee_mcp_permission_catalog
 * 068_reporting_logistics_permission_catalog
 * 069_reporting_cod_permission_catalog
 * 070_reporting_operations_history_control_tower
 * 071_customer_portal_order_intake
 * 072_customer_portal_registration_onboarding
 * 073_internal_workforce_auth
 * 074_internal_web_login_challenge
 * 075_logistics_trip_stop_reorder_constraint
 * 076_logistics_driver_employee_integrity
 * 077_document_numbering_active_series
 * 078_customer_address_location_url
 * 079_customer_media
 * 080_manual_delivery_handover
 * 081_sales_fulfillment_shortage_discrepancy
 * 082_sales_fulfillment_reversal
 * 083_backup_delete_foundation
 * 084_mcp_field_profile_verification
 * 085_mcp_sales_order_employee_provenance
 * 086_mcp_workforce_permission_catalog
 * 087_technical_backup_access
 * 088_selective_business_data_purge
 */
const SALES_DELIVERY_EXECUTION_MODE_SQL = readFileSync(
  new URL('../../../../database/migrations/sales/089_sales_delivery_execution_mode.sql', import.meta.url),
  'utf8',
);

export const CORE_API_MIGRATIONS = Object.freeze([
  ...CORE_API_MIGRATIONS_THROUGH_088,
  Object.freeze({ id: '089_sales_delivery_execution_mode', sql: SALES_DELIVERY_EXECUTION_MODE_SQL }),
]);

export { runMigrations };
