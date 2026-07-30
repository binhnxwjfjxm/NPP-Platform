import { readFileSync } from 'node:fs';
import {
  CORE_API_MIGRATIONS as CORE_API_MIGRATIONS_THROUGH_031,
  runMigrations,
} from './index-through-031.js';

const SUPPLIER_PAYMENT_ALLOCATION_HARDENING_SQL = readFileSync(
  new URL('../../../../database/migrations/accounting/032_supplier_payment_allocation_hardening.sql', import.meta.url),
  'utf8',
);

export const CORE_API_MIGRATIONS = Object.freeze([
  ...CORE_API_MIGRATIONS_THROUGH_031,
  Object.freeze({
    id: '032_supplier_payment_allocation_hardening',
    sql: SUPPLIER_PAYMENT_ALLOCATION_HARDENING_SQL,
  }),
]);

export { runMigrations };
