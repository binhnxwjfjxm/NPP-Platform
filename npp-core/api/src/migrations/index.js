import { readFileSync } from 'node:fs';
import {
  CORE_API_MIGRATIONS as CORE_API_MIGRATIONS_THROUGH_106,
  runMigrations,
} from './index-through-106.js';

const MANAGEMENT_PROPOSALS_SQL = readFileSync(
  new URL('../../../../database/migrations/shared/108_management_proposals.sql', import.meta.url),
  'utf8',
);

export const CORE_API_MIGRATIONS = Object.freeze([
  ...CORE_API_MIGRATIONS_THROUGH_106,
  Object.freeze({ id: '108_management_proposals', sql: MANAGEMENT_PROPOSALS_SQL }),
]);

export { runMigrations };
