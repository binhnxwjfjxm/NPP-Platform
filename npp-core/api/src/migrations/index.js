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
  readFileSync(new URL('../../../../database/migrations/accounting/053_customer_RECEIVABLE_PICKUP_REVERSAL.sql', import.meta.url), 'utf8'),
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
]);

export { runMigrations };
