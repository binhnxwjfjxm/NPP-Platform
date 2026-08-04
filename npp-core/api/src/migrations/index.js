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
  readFileSync(
    new URL('../../../../database/migrations/logistics/046_logistics_trip_planning.sql', import.meta.url),
    'utf8',
  ),
  readFileSync(
    new URL('../../../../database/migrations/logistics/046_logistics_trip_planning_constraints.sql', import.meta.url),
    'utf8',
  ),
].join('\n\n');

const LOGISTICS_TRIP_DISPATCH_SQL = readFileSync(
  new URL('../../../../database/migrations/logistics/047_logistics_trip_dispatch.sql', import.meta.url),
  'utf8',
);

const LOGISTICS_DRIVER_DELIVERY_READ_SQL = readFileSync(
  new URL('../../../../database/migrations/logistics/048_logistics_driver_delivery_read.sql', import.meta.url),
  'utf8',
);

export const CORE_API_MIGRATIONS = Object.freeze([
  ...CORE_API_MIGRATIONS_THROUGH_045,
  Object.freeze({ id: '046_logistics_trip_planning', sql: LOGISTICS_TRIP_PLANNING_SQL }),
  Object.freeze({ id: '047_logistics_trip_dispatch', sql: LOGISTICS_TRIP_DISPATCH_SQL }),
  Object.freeze({ id: '048_logistics_driver_delivery_read', sql: LOGISTICS_DRIVER_DELIVERY_READ_SQL }),
]);

export { runMigrations };
