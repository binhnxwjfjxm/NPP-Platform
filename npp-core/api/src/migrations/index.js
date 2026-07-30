import { readFileSync } from 'node:fs';
import {
  CORE_API_MIGRATIONS as CORE_API_MIGRATIONS_THROUGH_033,
  runMigrations,
} from './index-through-033.js';

const DOCUMENT_NUMBER_IDEMPOTENCY_NAMESPACE_SQL = readFileSync(
  new URL('../../../../database/migrations/accounting/034_document_number_idempotency_namespace.sql', import.meta.url),
  'utf8',
);

export const CORE_API_MIGRATIONS = Object.freeze([
  ...CORE_API_MIGRATIONS_THROUGH_033,
  Object.freeze({
    id: '034_document_number_idempotency_namespace',
    sql: DOCUMENT_NUMBER_IDEMPOTENCY_NAMESPACE_SQL,
  }),
]);

export { runMigrations };
