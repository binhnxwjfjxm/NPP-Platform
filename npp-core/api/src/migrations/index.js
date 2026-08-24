import { readFileSync } from 'node:fs';
import {
  CORE_API_MIGRATIONS as CORE_API_MIGRATIONS_THROUGH_045,
  runMigrations,
} from './index-through-045.js';

/*
 * Compatibility markers for source-contract tests. The actual SQL remains owned by
 * index-through-045.js and is not duplicated here:
 * 042_sales_fulfillment_reservation_demand
 * 043_sales_fulfillment_allocation_pick_pack
 * 044_sales_delivery_order_handover
 * 045_sales_inventory_issue_customer_return
 */
const LOGISTICS_TRIP_PLANNING_SQL = [
  readFileSync(new URL('../../../../database/migrations/logistics/046_logistics_trip_planning.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('../../../../database/migrations/logistics/046_logistics_trip_planning_constraints.sql', import.meta.url), 'utf8'),
].join('\n\n');
const LOGISTICS_TRIP_DISPATCH_SQL = readFileSync(new URL('../../../../database/migrations/logistics/047_logistics_trip_dispatch.sql', import.meta.url), 'utf8');
const LOGISTICS_DRIVER_DELIVERY_READ_SQL = readFileSync(new URL('../../../../database/migrations/logistics/048_logistics_driver_delivery_read.sql', import.meta.url), 'utf8');
const LOGISTICS_DELIVERY_ATTEMPTS_SQL = readFileSync(new URL('../../../../database/migrations/logistics/049_logistics_delivery_attempts.sql', import.meta.url), 'utf8');
const LOGISTICS_DELIVERY_ATTEMPT_OUTBOX_SCHEDULE_SQL = readFileSync(new URL('../../../../database/migrations/logistics/050_logistics_delivery_attempt_outbox_schedule.sql', import.meta.url), 'utf8');
const LOGISTICS_TRIP_RECONCILIATION_SQL = [
  readFileSync(new URL('../../../../database/migrations/logistics/051_logistics_trip_reconciliation.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('../../../../database/migrations/logistics/051_logistics_trip_reconciliation_hardening.sql', import.meta.url), 'utf8'),
].join('\n\n');
const LOGISTICS_OPTIONAL_PROOF_OF_DELIVERY_SQL = readFileSync(new URL('../../../../database/migrations/logistics/052_logistics_optional_proof_of_delivery.sql', import.meta.url), 'utf8');
const CUSTOMER_RECEIVABLE_LEDGER_SQL = [
  readFileSync(new URL('../../../../database/migrations/accounting/053_customer_receivable_ledger.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('../../../../database/migrations/accounting/053_customer_receivable_pickup_reversal.sql', import.meta.url), 'utf8'),
].join('\n\n');
const CUSTOMER_PAYMENT_ALLOCATION_SQL = [
  readFileSync(new URL('../../../../database/migrations/accounting/054_customer_payment_allocation.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('../../../../database/migrations/accounting/054_customer_payment_allocation_hardening.sql', import.meta.url), 'utf8'),
].join('\n\n');
const CUSTOMER_RETURN_CREDIT_REFUND_SQL = [
  readFileSync(new URL('../../../../database/migrations/accounting/055_customer_return_credit_refund_schema.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('../../../../database/migrations/accounting/055_customer_return_credit_refund_posting.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('../../../../database/migrations/accounting/055_customer_return_credit_refund_actions.sql', import.meta.url), 'utf8'),
].join('\n\n');
const PHASE6F_RECONCILIATION_SQL = readFileSync(new URL('../../../../database/migrations/reporting/057_phase6f_reconciliation_views.sql', import.meta.url), 'utf8');
const COD_COLLECTION_HANDOVER_SQL = [
  readFileSync(new URL('../../../../database/migrations/accounting/056_cod_collection_handover_schema.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('../../../../database/migrations/accounting/056_cod_collection_handover_projections.sql', import.meta.url), 'utf8'),
].join('\n\n');
const INVENTORY_TRANSFER_IN_TRANSIT_SQL = readFileSync(new URL('../../../../database/migrations/inventory/058_inventory_transfer_in_transit_foundation.sql', import.meta.url), 'utf8');
const INVENTORY_TRANSFER_RECEIPT_RESOLUTION_SQL = readFileSync(new URL('../../../../database/migrations/inventory/059_inventory_transfer_receipt_resolution.sql', import.meta.url), 'utf8');
const INVENTORY_STOCKTAKE_SQL = readFileSync(new URL('../../../../database/migrations/inventory/060_inventory_stocktake.sql', import.meta.url), 'utf8');
const INVENTORY_ADJUSTMENTS_SQL = readFileSync(new URL('../../../../database/migrations/inventory/061_inventory_adjustments.sql', import.meta.url), 'utf8');
const INVENTORY_COSTING_FOUNDATION_SQL = readFileSync(new URL('../../../../database/migrations/inventory/062_inventory_costing_foundation.sql', import.meta.url), 'utf8');
const INVENTORY_COSTING_PERIODS_BACKDATE_SQL = readFileSync(new URL('../../../../database/migrations/inventory/063_inventory_costing_periods_backdate.sql', import.meta.url), 'utf8');
const REPORTING_PERMISSION_CATALOG_SQL = readFileSync(new URL('../../../../database/migrations/shared/064_reporting_permission_catalog.sql', import.meta.url), 'utf8');
const REPORTING_INVENTORY_PERMISSION_CATALOG_SQL = readFileSync(new URL('../../../../database/migrations/shared/065_reporting_inventory_permission_catalog.sql', import.meta.url), 'utf8');
const REPORTING_AGING_GROSS_MARGIN_PERMISSION_CATALOG_SQL = readFileSync(new URL('../../../../database/migrations/shared/066_reporting_aging_gross_margin_permission_catalog.sql', import.meta.url), 'utf8');
const REPORTING_EMPLOYEE_MCP_PERMISSION_CATALOG_SQL = readFileSync(new URL('../../../../database/migrations/shared/067_reporting_employee_mcp_permission_catalog.sql', import.meta.url), 'utf8');
const REPORTING_LOGISTICS_PERMISSION_CATALOG_SQL = readFileSync(new URL('../../../../database/migrations/shared/068_reporting_logistics_permission_catalog.sql', import.meta.url), 'utf8');
const REPORTING_COD_PERMISSION_CATALOG_SQL = readFileSync(new URL('../../../../database/migrations/shared/069_reporting_cod_permission_catalog.sql', import.meta.url), 'utf8');
const REPORTING_OPERATIONS_HISTORY_CONTROL_TOWER_SQL = readFileSync(new URL('../../../../database/migrations/reporting/070_reporting_operations_history_control_tower.sql', import.meta.url), 'utf8');
const CUSTOMER_PORTAL_ORDER_INTAKE_SQL = readFileSync(new URL('../../../../database/migrations/sales/071_customer_portal_order_intake.sql', import.meta.url), 'utf8');
const CUSTOMER_PORTAL_REGISTRATION_ONBOARDING_SQL = readFileSync(new URL('../../../../database/migrations/sales/072_customer_portal_registration_onboarding.sql', import.meta.url), 'utf8');
const INTERNAL_WORKFORCE_AUTH_SQL = readFileSync(new URL('../../../../database/migrations/shared/073_internal_workforce_auth.sql', import.meta.url), 'utf8');
const INTERNAL_WEB_LOGIN_CHALLENGE_SQL = readFileSync(new URL('../../../../database/migrations/shared/074_internal_web_login_challenge.sql', import.meta.url), 'utf8');
const LOGISTICS_TRIP_STOP_REORDER_CONSTRAINT_SQL = readFileSync(new URL('../../../../database/migrations/logistics/075_logistics_trip_stop_reorder_constraint.sql', import.meta.url), 'utf8');
const LOGISTICS_DRIVER_EMPLOYEE_INTEGRITY_SQL = readFileSync(new URL('../../../../database/migrations/logistics/076_logistics_driver_employee_integrity.sql', import.meta.url), 'utf8');
const DOCUMENT_NUMBERING_ACTIVE_SERIES_SQL = readFileSync(new URL('../../../../database/migrations/shared/077_document_numbering_active_series.sql', import.meta.url), 'utf8');
const CUSTOMER_ADDRESS_LOCATION_URL_SQL = readFileSync(new URL('../../../../database/migrations/shared/078_customer_address_location_url.sql', import.meta.url), 'utf8');
const CUSTOMER_MEDIA_SQL = readFileSync(new URL('../../../../database/migrations/shared/079_customer_media.sql', import.meta.url), 'utf8');
const MANUAL_DELIVERY_HANDOVER_SQL = readFileSync(new URL('../../../../database/migrations/sales/080_manual_delivery_handover.sql', import.meta.url), 'utf8');
const FULFILLMENT_SHORTAGE_DISCREPANCY_SQL = readFileSync(new URL('../../../../database/migrations/sales/081_sales_fulfillment_shortage_discrepancy.sql', import.meta.url), 'utf8');
const SALES_FULFILLMENT_REVERSAL_SQL = readFileSync(new URL('../../../../database/migrations/sales/082_sales_fulfillment_reversal.sql', import.meta.url), 'utf8');
const SALES_DELIVERY_REVERSAL_HARDENING_SQL = readFileSync(new URL('../../../../database/migrations/sales/082b_sales_delivery_reversal_hardening.sql', import.meta.url), 'utf8');
const LOGISTICS_TRIP_RECOVERY_SQL = readFileSync(new URL('../../../../database/migrations/logistics/082_logistics_trip_recovery.sql', import.meta.url), 'utf8');
const BACKUP_DELETE_FOUNDATION_SQL = readFileSync(new URL('../../../../database/migrations/shared/083_backup_delete_foundation.sql', import.meta.url), 'utf8');
const MCP_FIELD_PROFILE_VERIFICATION_SQL = readFileSync(new URL('../../../../database/migrations/sales/084_mcp_field_profile_verification.sql', import.meta.url), 'utf8');
const MCP_SALES_ORDER_EMPLOYEE_PROVENANCE_SQL = readFileSync(new URL('../../../../database/migrations/sales/085_mcp_sales_order_employee_provenance.sql', import.meta.url), 'utf8');
const MCP_WORKFORCE_PERMISSION_CATALOG_SQL = readFileSync(new URL('../../../../database/migrations/shared/086_mcp_workforce_permission_catalog.sql', import.meta.url), 'utf8');
const TECHNICAL_BACKUP_ACCESS_SQL = readFileSync(new URL('../../../../database/migrations/shared/087_technical_backup_access.sql', import.meta.url), 'utf8');
const SELECTIVE_BUSINESS_DATA_PURGE_SQL = readFileSync(new URL('../../../../database/migrations/shared/088_selective_business_data_purge.sql', import.meta.url), 'utf8');
const SALES_DELIVERY_EXECUTION_MODE_SQL = readFileSync(new URL('../../../../database/migrations/sales/089_sales_delivery_execution_mode.sql', import.meta.url), 'utf8');
const MANUAL_SALES_ORDER_RECEIVABLE_SQL = readFileSync(new URL('../../../../database/migrations/accounting/090_manual_sales_order_receivable.sql', import.meta.url), 'utf8');
const MANUAL_INBOUND_FOUNDATION_SQL = readFileSync(new URL('../../../../database/migrations/inventory/091_manual_inbound_foundation.sql', import.meta.url), 'utf8');
const SALES_SHARED_STOCK_HOLD_SQL = readFileSync(new URL('../../../../database/migrations/sales/092_sales_shared_stock_hold.sql', import.meta.url), 'utf8');
const PRODUCT_INVENTORY_MANAGEMENT_POLICY_SQL = readFileSync(new URL('../../../../database/migrations/shared/093_product_inventory_management_policy.sql', import.meta.url), 'utf8');
const MANUAL_DELIVERY_ALLOCATION_RELEASE_SQL = readFileSync(new URL('../../../../database/migrations/sales/094_manual_delivery_allocation_release.sql', import.meta.url), 'utf8');
const MANUAL_SALES_ORDER_RECEIVABLE_DELIVERY_ORDER_NULLABLE_SQL = readFileSync(new URL('../../../../database/migrations/accounting/095_manual_sales_order_receivable_delivery_order_nullable.sql', import.meta.url), 'utf8');
const SALES_ORDER_UNWIND_LOCKED_TRIP_SQL = readFileSync(new URL('../../../../database/migrations/logistics/096_sales_order_unwind_locked_trip.sql', import.meta.url), 'utf8');
const CUSTOMER_PAYMENT_REMITTING_EMPLOYEE_SQL = readFileSync(new URL('../../../../database/migrations/accounting/097_customer_payment_remitting_employee.sql', import.meta.url), 'utf8');
const DOCUMENT_PRINT_TEMPLATE_SETTINGS_SQL = readFileSync(new URL('../../../../database/migrations/shared/098_document_print_template_settings.sql', import.meta.url), 'utf8');
const BUSINESS_PURGE_GUARDED_DELETE_SQL = readFileSync(new URL('../../../../database/migrations/shared/099_business_purge_guarded_delete.sql', import.meta.url), 'utf8');
const DIRECT_PICKUP_SALES_ORDER_RECEIVABLE_SQL = readFileSync(new URL('../../../../database/migrations/accounting/100_direct_pickup_sales_order_receivable.sql', import.meta.url), 'utf8');
const BUSINESS_PURGE_OPERATIONAL_GUARDS_SQL = readFileSync(new URL('../../../../database/migrations/shared/101_business_purge_operational_guards.sql', import.meta.url), 'utf8');
const DOCUMENT_PRINT_TEMPLATE_HEADING_SQL = readFileSync(new URL('../../../../database/migrations/shared/102_document_print_template_heading.sql', import.meta.url), 'utf8');
const SALES_ORDER_EXECUTION_CLOSE_FULFILLMENT_SQL = readFileSync(new URL('../../../../database/migrations/sales/103_sales_order_execution_close_fulfillment.sql', import.meta.url), 'utf8');
const SALES_ORDER_EXECUTION_CLOSE_PARTIAL_RELEASE_SQL = readFileSync(new URL('../../../../database/migrations/sales/104_sales_order_execution_close_partial_release.sql', import.meta.url), 'utf8');
const BUSINESS_PURGE_REMAINING_OPERATIONAL_GUARDS_SQL = readFileSync(new URL('../../../../database/migrations/shared/105_business_purge_remaining_operational_guards.sql', import.meta.url), 'utf8');
const BUSINESS_PURGE_DOCUMENT_NUMBER_ALLOCATIONS_SQL = readFileSync(new URL('../../../../database/migrations/shared/106_business_purge_document_number_allocations.sql', import.meta.url), 'utf8');
const MANAGEMENT_PROPOSALS_SQL = readFileSync(new URL('../../../../database/migrations/shared/108_management_proposals.sql', import.meta.url), 'utf8');
const MANAGEMENT_PROPOSAL_SOURCE_ROUNDTRIP_SQL = readFileSync(new URL('../../../../database/migrations/shared/109_management_proposal_source_roundtrip.sql', import.meta.url), 'utf8');
const MANAGEMENT_PROPOSAL_OPTIONAL_DETAILS_SQL = readFileSync(new URL('../../../../database/migrations/shared/110_management_proposal_optional_details.sql', import.meta.url), 'utf8');
const AI_USAGE_METERING_SQL = readFileSync(new URL('../../../../database/migrations/shared/111_ai_usage_metering.sql', import.meta.url), 'utf8');
const AI_WEBSITE_ANONYMOUS_USAGE_SQL = readFileSync(new URL('../../../../database/migrations/shared/112_ai_website_anonymous_usage.sql', import.meta.url), 'utf8');

export const CORE_API_MIGRATIONS = Object.freeze([
  ...CORE_API_MIGRATIONS_THROUGH_045,
  Object.freeze({ id: '046_logistics_trip_planning', sql: LOGISTICS_TRIP_PLANNING_SQL }),
  Object.freeze({ id: '047_logistics_trip_dispatch', sql: LOGISTICS_TRIP_DISPATCH_SQL }),
  Object.freeze({ id: '048_logistics_driver_delivery_read', sql: LOGISTICS_DRIVER_DELIVERY_READ_SQL }),
  Object.freeze({ id: '049_logistics_delivery_attempts', sql: LOGISTICS_DELIVERY_ATTEMPTS_SQL }),
  Object.freeze({ id: '050_logistics_delivery_attempt_outbox_schedule', sql: LOGISTICS_DELIVERY_ATTEMPT_OUTBOX_SCHEDULE_SQL }),
  Object.freeze({ id: '051_logistics_trip_reconciliation', sql: LOGISTICS_TRIP_RECONCILIATION_SQL }),
  Object.freeze({ id: '052_logistics_optional_proof_of_delivery', sql: LOGISTICS_OPTIONAL_PROOF_OF_DELIVERY_SQL }),
  Object.freeze({ id: '053_customer_receivable_ledger', sql: CUSTOMER_RECEIVABLE_LEDGER_SQL }),
  Object.freeze({ id: '054_customer_payment_allocation', sql: CUSTOMER_PAYMENT_ALLOCATION_SQL }),
  Object.freeze({ id: '055_customer_return_credit_refund', sql: CUSTOMER_RETURN_CREDIT_REFUND_SQL }),
  Object.freeze({ id: '056_cod_collection_handover', sql: COD_COLLECTION_HANDOVER_SQL }),
  Object.freeze({ id: '057_phase6f_reconciliation_views', sql: PHASE6F_RECONCILIATION_SQL }),
  Object.freeze({ id: '058_inventory_transfer_in_transit_foundation', sql: INVENTORY_TRANSFER_IN_TRANSIT_SQL }),
  Object.freeze({ id: '059_inventory_transfer_receipt_resolution', sql: INVENTORY_TRANSFER_RECEIPT_RESOLUTION_SQL }),
  Object.freeze({ id: '060_inventory_stocktake', sql: INVENTORY_STOCKTAKE_SQL }),
  Object.freeze({ id: '061_inventory_adjustments', sql: INVENTORY_ADJUSTMENTS_SQL }),
  Object.freeze({ id: '062_inventory_costing_foundation', sql: INVENTORY_COSTING_FOUNDATION_SQL }),
  Object.freeze({ id: '063_inventory_costing_periods_backdate', sql: INVENTORY_COSTING_PERIODS_BACKDATE_SQL }),
  Object.freeze({ id: '064_reporting_permission_catalog', sql: REPORTING_PERMISSION_CATALOG_SQL }),
  Object.freeze({ id: '065_reporting_inventory_permission_catalog', sql: REPORTING_INVENTORY_PERMISSION_CATALOG_SQL }),
  Object.freeze({ id: '066_reporting_aging_gross_margin_permission_catalog', sql: REPORTING_AGING_GROSS_MARGIN_PERMISSION_CATALOG_SQL }),
  Object.freeze({ id: '067_reporting_employee_mcp_permission_catalog', sql: REPORTING_EMPLOYEE_MCP_PERMISSION_CATALOG_SQL }),
  Object.freeze({ id: '068_reporting_logistics_permission_catalog', sql: REPORTING_LOGISTICS_PERMISSION_CATALOG_SQL }),
  Object.freeze({ id: '069_reporting_cod_permission_catalog', sql: REPORTING_COD_PERMISSION_CATALOG_SQL }),
  Object.freeze({ id: '070_reporting_operations_history_control_tower', sql: REPORTING_OPERATIONS_HISTORY_CONTROL_TOWER_SQL }),
  Object.freeze({ id: '071_customer_portal_order_intake', sql: CUSTOMER_PORTAL_ORDER_INTAKE_SQL }),
  Object.freeze({ id: '072_customer_portal_registration_onboarding', sql: CUSTOMER_PORTAL_REGISTRATION_ONBOARDING_SQL }),
  Object.freeze({ id: '073_internal_workforce_auth', sql: INTERNAL_WORKFORCE_AUTH_SQL }),
  Object.freeze({ id: '074_internal_web_login_challenge', sql: INTERNAL_WEB_LOGIN_CHALLENGE_SQL }),
  Object.freeze({ id: '075_logistics_trip_stop_reorder_constraint', sql: LOGISTICS_TRIP_STOP_REORDER_CONSTRAINT_SQL }),
  Object.freeze({ id: '076_logistics_driver_employee_integrity', sql: LOGISTICS_DRIVER_EMPLOYEE_INTEGRITY_SQL }),
  Object.freeze({ id: '077_document_numbering_active_series', sql: DOCUMENT_NUMBERING_ACTIVE_SERIES_SQL }),
  Object.freeze({ id: '078_customer_address_location_url', sql: CUSTOMER_ADDRESS_LOCATION_URL_SQL }),
  Object.freeze({ id: '079_customer_media', sql: CUSTOMER_MEDIA_SQL }),
  Object.freeze({ id: '080_manual_delivery_handover', sql: MANUAL_DELIVERY_HANDOVER_SQL }),
  Object.freeze({ id: '081_sales_fulfillment_shortage_discrepancy', sql: FULFILLMENT_SHORTAGE_DISCREPANCY_SQL }),
  Object.freeze({ id: '082_sales_fulfillment_reversal', sql: [SALES_FULFILLMENT_REVERSAL_SQL, SALES_DELIVERY_REVERSAL_HARDENING_SQL, LOGISTICS_TRIP_RECOVERY_SQL].join('\n\n') }),
  Object.freeze({ id: '083_backup_delete_foundation', sql: BACKUP_DELETE_FOUNDATION_SQL }),
  Object.freeze({ id: '084_mcp_field_profile_verification', sql: MCP_FIELD_PROFILE_VERIFICATION_SQL }),
  Object.freeze({ id: '085_mcp_sales_order_employee_provenance', sql: MCP_SALES_ORDER_EMPLOYEE_PROVENANCE_SQL }),
  Object.freeze({ id: '086_mcp_workforce_permission_catalog', sql: MCP_WORKFORCE_PERMISSION_CATALOG_SQL }),
  Object.freeze({ id: '087_technical_backup_access', sql: TECHNICAL_BACKUP_ACCESS_SQL }),
  Object.freeze({ id: '088_selective_business_data_purge', sql: SELECTIVE_BUSINESS_DATA_PURGE_SQL }),
  Object.freeze({ id: '089_sales_delivery_execution_mode', sql: SALES_DELIVERY_EXECUTION_MODE_SQL }),
  Object.freeze({ id: '090_manual_sales_order_receivable', sql: MANUAL_SALES_ORDER_RECEIVABLE_SQL }),
  Object.freeze({ id: '091_manual_inbound_foundation', sql: MANUAL_INBOUND_FOUNDATION_SQL }),
  Object.freeze({ id: '092_sales_shared_stock_hold', sql: SALES_SHARED_STOCK_HOLD_SQL }),
  Object.freeze({ id: '093_product_inventory_management_policy', sql: PRODUCT_INVENTORY_MANAGEMENT_POLICY_SQL }),
  Object.freeze({ id: '094_manual_delivery_allocation_release', sql: MANUAL_DELIVERY_ALLOCATION_RELEASE_SQL }),
  Object.freeze({ id: '095_manual_sales_order_receivable_delivery_order_nullable', sql: MANUAL_SALES_ORDER_RECEIVABLE_DELIVERY_ORDER_NULLABLE_SQL }),
  Object.freeze({ id: '096_sales_order_unwind_locked_trip', sql: SALES_ORDER_UNWIND_LOCKED_TRIP_SQL }),
  Object.freeze({ id: '097_customer_payment_remitting_employee', sql: CUSTOMER_PAYMENT_REMITTING_EMPLOYEE_SQL }),
  Object.freeze({ id: '098_document_print_template_settings', sql: DOCUMENT_PRINT_TEMPLATE_SETTINGS_SQL }),
  Object.freeze({ id: '099_business_purge_guarded_delete', sql: BUSINESS_PURGE_GUARDED_DELETE_SQL }),
  Object.freeze({ id: '100_direct_pickup_sales_order_receivable', sql: DIRECT_PICKUP_SALES_ORDER_RECEIVABLE_SQL }),
  Object.freeze({ id: '101_business_purge_operational_guards', sql: BUSINESS_PURGE_OPERATIONAL_GUARDS_SQL }),
  Object.freeze({ id: '102_document_print_template_heading', sql: DOCUMENT_PRINT_TEMPLATE_HEADING_SQL }),
  Object.freeze({ id: '103_sales_order_execution_close_fulfillment', sql: SALES_ORDER_EXECUTION_CLOSE_FULFILLMENT_SQL }),
  Object.freeze({ id: '104_sales_order_execution_close_partial_release', sql: SALES_ORDER_EXECUTION_CLOSE_PARTIAL_RELEASE_SQL }),
  Object.freeze({ id: '105_business_purge_remaining_operational_guards', sql: BUSINESS_PURGE_REMAINING_OPERATIONAL_GUARDS_SQL }),
  Object.freeze({ id: '106_business_purge_document_number_allocations', sql: BUSINESS_PURGE_DOCUMENT_NUMBER_ALLOCATIONS_SQL }),
  Object.freeze({ id: '108_management_proposals', sql: MANAGEMENT_PROPOSALS_SQL }),
  Object.freeze({ id: '109_management_proposal_source_roundtrip', sql: MANAGEMENT_PROPOSAL_SOURCE_ROUNDTRIP_SQL }),
  Object.freeze({ id: '110_management_proposal_optional_details', sql: MANAGEMENT_PROPOSAL_OPTIONAL_DETAILS_SQL }),
  Object.freeze({ id: '111_ai_usage_metering', sql: AI_USAGE_METERING_SQL }),
  Object.freeze({ id: '112_ai_website_anonymous_usage', sql: AI_WEBSITE_ANONYMOUS_USAGE_SQL }),
]);

export { runMigrations };
