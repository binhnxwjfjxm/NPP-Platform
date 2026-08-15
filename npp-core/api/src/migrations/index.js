import { readFileSync } from 'node:fs';
import {
  CORE_API_MIGRATIONS as CORE_API_MIGRATIONS_THROUGH_081,
  runMigrations,
} from './index-through-081.js';

const SALES_FULFILLMENT_REVERSAL_SQL = readFileSync(
  new URL('../../../../database/migrations/sales/082_sales_fulfillment_reversal.sql', import.meta.url),
  'utf8',
);
const SALES_DELIVERY_REVERSAL_HARDENING_SQL = readFileSync(
  new URL('../../../../database/migrations/sales/082b_sales_delivery_reversal_hardening.sql', import.meta.url),
  'utf8',
);
const LOGISTICS_TRIP_RECOVERY_SQL = readFileSync(
  new URL('../../../../database/migrations/logistics/082_logistics_trip_recovery.sql', import.meta.url),
  'utf8',
);

export const CORE_API_MIGRATIONS = Object.freeze([
  ...CORE_API_MIGRATIONS_THROUGH_081,
  Object.freeze({
    id: '082_sales_fulfillment_reversal',
    sql: [
      SALES_FULFILLMENT_REVERSAL_SQL,
      SALES_DELIVERY_REVERSAL_HARDENING_SQL,
      LOGISTICS_TRIP_RECOVERY_SQL,
    ].join('\n\n'),
  }),
]);

export { runMigrations };
