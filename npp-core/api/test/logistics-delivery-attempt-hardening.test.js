import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CORE_API_MIGRATIONS } from '../src/migrations/index.js';

const migrationSource = readFileSync(
  new URL('../../../database/migrations/logistics/050_logistics_delivery_attempt_outbox_schedule.sql', import.meta.url),
  'utf8',
);

test('delivery-attempt outbox is scheduled by trusted database time', () => {
  const migrations = CORE_API_MIGRATIONS.filter(
    (entry) => entry.id === '050_logistics_delivery_attempt_outbox_schedule',
  );
  assert.equal(migrations.length, 1);
  assert.match(migrations[0].sql, /statement_timestamp\(\)/);
  assert.match(migrationSource, /NEW\.event_type = 'core\.delivery_attempt\.recorded'/);
  assert.match(migrationSource, /NEW\.created_at := trusted_now/);
  assert.match(migrationSource, /NEW\.available_at := trusted_now/);
  assert.match(migrationSource, /BEFORE INSERT ON shared\.core_outbox_events/);
});
