import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('production price-list inspection can only read, and requires exact Issue #5 command', () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/vps-price-lists-readonly-audit.yml', import.meta.url), 'utf8');
  assert.match(workflow, /github\.event\.issue\.number == 5/);
  assert.match(workflow, /github\.event\.comment\.body == '\/audit-vps-price-lists'/);
  assert.match(workflow, /BEGIN TRANSACTION READ ONLY;/);
  assert.match(workflow, /shared\.sales_channel_customer_groups/);
  assert.match(workflow, /psql -X --csv -v ON_ERROR_STOP=1/);
  assert.match(workflow, /price_list_name/);
  assert.match(workflow, /currently_effective_item_count/);
  assert.doesNotMatch(workflow, /\b(?:INSERT INTO|UPDATE shared\.|DELETE FROM|TRUNCATE TABLE|DROP TABLE)\b/i);
});
