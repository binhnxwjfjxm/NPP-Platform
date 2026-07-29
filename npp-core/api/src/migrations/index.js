import { readFileSync } from 'node:fs';
import {
  CORE_API_MIGRATIONS as CORE_API_MIGRATIONS_THROUGH_028,
  runMigrations,
} from './index-core.js';

const SUPPLIER_RETURN_INVARIANTS_SQL = readFileSync(
  new URL('../../../../database/migrations/inventory/029_supplier_return_invariants.sql', import.meta.url),
  'utf8',
);

export const CORE_API_MIGRATIONS = Object.freeze([
  ...CORE_API_MIGRATIONS_THROUGH_028,
  Object.freeze({
    id: '029_supplier_return_invariants',
    sql: SUPPLIER_RETURN_INVARIANTS_SQL,
  }),
]);

export { runMigrations };
