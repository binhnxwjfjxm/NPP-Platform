import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(relative) {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

test('sales order entry defaults do not create a second audit record inside the order transaction', () => {
  const entryService = source('../src/services/sales-order-entry.js');
  const route = source('../src/routes/sales-orders.js');

  assert.doesNotMatch(entryService, /insertAuditRecord|buildAuditRecord/);
  assert.match(entryService, /persistEntryDefaults\(client/);
  assert.match(entryService, /filter\(\(\[key\]\) => key !== 'entryDefaults'\)/);
  assert.match(route, /writeAuditOutbox\(client/);
  assert.match(route, /withAuditOutboxTransaction\(/);
});
