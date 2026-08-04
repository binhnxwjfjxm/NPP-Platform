import { readFileSync } from 'node:fs';
import {
  CORE_API_MIGRATIONS as CORE_API_MIGRATIONS_THROUGH_033,
  runMigrations,
} from './index-through-033.js';

const DOCUMENT_NUMBER_IDEMPOTENCY_NAMESPACE_SQL = readFileSync(
  new URL('../../../../database/migrations/accounting/034_document_number_idempotency_namespace.sql', import.meta.url),
  'utf8',
);

const PURCHASE_ORDER_LINE_ENTRY_CONTRACT_SQL = readFileSync(
  new URL('../../../../database/migrations/purchasing/035_purchase_order_line_entry_contract.sql', import.meta.url),
  'utf8',
);

const SUPPLIER_PURCHASE_PRICING_SQL = readFileSync(
  new URL('../../../../database/migrations/purchasing/036_supplier_purchase_pricing.sql', import.meta.url),
  'utf8',
);

const SALES_ORDER_FOUNDATION_SQL = readFileSync(
  new URL('../../../../database/migrations/sales/037_sales_order_foundation.sql', import.meta.url),
  'utf8',
);

const SALES_ORDER_CONFIRMATION_GUARD_SQL = readFileSync(
  new URL('../../../../database/migrations/sales/038_sales_order_confirmation_guard.sql', import.meta.url),
  'utf8',
);

const SALES_ORDER_OPERATIONAL_ENTRY_SQL = readFileSync(
  new URL('../../../../database/migrations/sales/039_sales_order_operational_entry.sql', import.meta.url),
  'utf8',
);

const SALES_ORDER_COMMERCIAL_CONTROLS_SQL = readFileSync(
  new URL('../../../../database/migrations/sales/040_sales_order_commercial_controls.sql', import.meta.url),
  'utf8',
);

const CUSTOMER_ONBOARDING_REQUESTS_SQL = readFileSync(
  new URL('../../../../database/migrations/sales/041_customer_onboarding_requests.sql', import.meta.url),
  'utf8',
);

const SALES_FULFILLMENT_RESERVATION_DEMAND_SQL = readFileSync(
  new URL('../../../../database/migrations/sales/042_sales_fulfillment_reservation_demand.sql', import.meta.url),
  'utf8',
);

const SALES_FULFILLMENT_ALLOCATION_PICK_PACK_SQL = readFileSync(
  new URL('../../../../database/migrations/sales/043_sales_fulfillment_allocation_pick_pack.sql', import.meta.url),
  'utf8',
);

const SALES_FULFILLMENT_ALLOCATION_OPERATION_IDEMPOTENCY_SQL = readFileSync(
  new URL('../../../../database/migrations/sales/044_sales_fulfillment_allocation_operation_idempotency.sql', import.meta.url),
  'utf8',
);

const SALES_FULFILLMENT_ALLOCATION_PROJECTION_POLICY_SQL = readFileSync(
  new URL('../../../../database/migrations/sales/045_sales_fulfillment_allocation_projection_policy.sql', import.meta.url),
  'utf8',
);

export const CORE_API_MIGRATIONS = Object.freeze([
  ...CORE_API_MIGRATIONS_THROUGH_033,
  Object.freeze({
    id: '034_document_number_idempotency_namespace',
    sql: DOCUMENT_NUMBER_IDEMPOTENCY_NAMESPACE_SQL,
  }),
  Object.freeze({
    id: '035_purchase_order_line_entry_contract',
    sql: PURCHASE_ORDER_LINE_ENTRY_CONTRACT_SQL,
  }),
  Object.freeze({
    id: '036_supplier_purchase_pricing',
    sql: SUPPLIER_PURCHASE_PRICING_SQL,
  }),
  Object.freeze({
    id: '037_sales_order_foundation',
    sql: SALES_ORDER_FOUNDATION_SQL,
  }),
  Object.freeze({
    id: '038_sales_order_confirmation_guard',
    sql: SALES_ORDER_CONFIRMATION_GUARD_SQL,
  }),
  Object.freeze({
    id: '039_sales_order_operational_entry',
    sql: SALES_ORDER_OPERATIONAL_ENTRY_SQL,
  }),
  Object.freeze({
    id: '040_sales_order_commercial_controls',
    sql: SALES_ORDER_COMMERCIAL_CONTROLS_SQL,
  }),
  Object.freeze({
    id: '041_customer_onboarding_requests',
    sql: CUSTOMER_ONBOARDING_REQUESTS_SQL,
  }),
  Object.freeze({
    id: '042_sales_fulfillment_reservation_demand',
    sql: SALES_FULFILLMENT_RESERVATION_DEMAND_SQL,
  }),
  Object.freeze({
    id: '043_sales_fulfillment_allocation_pick_pack',
    sql: SALES_FULFILLMENT_ALLOCATION_PICK_PACK_SQL,
  }),
  Object.freeze({
    id: '044_sales_fulfillment_allocation_operation_idempotency',
    sql: SALES_FULFILLMENT_ALLOCATION_OPERATION_IDEMPOTENCY_SQL,
  }),
  Object.freeze({
    id: '045_sales_fulfillment_allocation_projection_policy',
    sql: SALES_FULFILLMENT_ALLOCATION_PROJECTION_POLICY_SQL,
  }),
]);

export { runMigrations };
