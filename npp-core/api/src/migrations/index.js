import { readFileSync } from 'node:fs';
import {
  CORE_API_MIGRATIONS as CORE_API_MIGRATIONS_THROUGH_029,
  runMigrations,
} from './index-through-029.js';

const PAYABLE_POSTING_SQL = readFileSync(
  new URL('../../../../database/migrations/accounting/030_payable_posting.sql', import.meta.url),
  'utf8',
);

export const CORE_API_MIGRATIONS = Object.freeze([
  ...CORE_API_MIGRATIONS_THROUGH_029,
  Object.freeze({
    id: '030_payable_posting',
    sql: PAYABLE_POSTING_SQL,
  }),
]);

export { runMigrations };
