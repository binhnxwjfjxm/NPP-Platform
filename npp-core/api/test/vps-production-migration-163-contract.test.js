import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('migration 163 deploy gate requires verified backup, restore rehearsal, privileges and explicit customer eligibility', async () => {
  const script = await readFile(new URL('../scripts/vps-production-migrate-sales-channel-customer-groups-163.sh', import.meta.url), 'utf8');
  const workflow = await readFile(new URL('../../../.github/workflows/vps-production-migration-163-manual.yml', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../../../database/migrations/shared/163_sales_channel_customer_group_eligibility.sql', import.meta.url), 'utf8');
  for (const pattern of [/pg_dump -Fc/, /pg_restore --exit-on-error/, /protected_row_count/, /grant_company_runtime_access/, /PRODUCTION_VERIFY=PASS/, /COMPANY_ROLLOUT_PRICE_GATE=REQUIRES_EXPLICIT_GROUP_ASSIGNMENTS/, /sales_channel_group_channel_fk/, /sales_channel_group_group_fk/]) {
    assert.match(script, pattern);
  }
  assert.match(workflow, /\/migrate-vps-production-163/);
  assert.match(workflow, /vps-production-db-migration/);
  assert.match(workflow, /bash -n/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS shared.sales_channel_customer_groups/);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+shared\.sales_channel_customer_groups|TRUNCATE|DROP\s+TABLE/i);
});
