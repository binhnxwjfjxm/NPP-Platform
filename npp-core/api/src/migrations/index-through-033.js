import { readFileSync } from 'node:fs';
import {
  CORE_API_MIGRATIONS as CORE_API_MIGRATIONS_THROUGH_032,
  runMigrations,
} from './index-through-032.js';

const SUPPLIER_PAYMENT_SERIES_LIFECYCLE_SQL = readFileSync(
  new URL('../../../../database/migrations/accounting/033_supplier_payment_series_lifecycle.sql', import.meta.url),
  'utf8',
);

export const CORE_API_MIGRATIONS = Object.freeze([
  ...CORE_API_MIGRATIONS_THROUGH_032,
  Object.freeze({
    id: '033_supplier_payment_series_lifecycle',
    sql: SUPPLIER_PAYMENT_SERIES_LIFECYCLE_SQL,
  }),
]);

export { runMigrations };
