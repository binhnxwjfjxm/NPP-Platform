import { readFileSync } from 'node:fs';
import {
  CORE_API_MIGRATIONS as CORE_API_MIGRATIONS_THROUGH_030,
  runMigrations,
} from './index-through-030.js';

const SUPPLIER_PAYMENT_ALLOCATION_SQL = readFileSync(
  new URL('../../../../database/migrations/accounting/031_supplier_payment_allocation.sql', import.meta.url),
  'utf8',
);

export const CORE_API_MIGRATIONS = Object.freeze([
  ...CORE_API_MIGRATIONS_THROUGH_030,
  Object.freeze({
    id: '031_supplier_payment_allocation',
    sql: SUPPLIER_PAYMENT_ALLOCATION_SQL,
  }),
]);

export { runMigrations };
