import { readFileSync } from 'node:fs';
import {
  CORE_API_MIGRATIONS as CORE_API_MIGRATIONS_THROUGH_045,
  runMigrations,
} from './index-through-045.js';

const LOGISTICS_TRIP_PLANNING_SQL = readFileSync(
  new URL('../../../../database/migrations/logistics/046_logistics_trip_planning.sql', import.meta.url),
  'utf8',
);

export const CORE_API_MIGRATIONS = Object.freeze([
  ...CORE_API_MIGRATIONS_THROUGH_045,
  Object.freeze({ id: '046_logistics_trip_planning', sql: LOGISTICS_TRIP_PLANNING_SQL }),
]);

export { runMigrations };
