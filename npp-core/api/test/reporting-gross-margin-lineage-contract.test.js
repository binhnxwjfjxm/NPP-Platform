import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('gross margin direct-sale lineage compares canonical text document ids', () => {
  const finance = source('../src/routes/reporting-finance.js');
  const inventoryLedger = source('../../../database/migrations/inventory/017_inventory_ledger_foundation.sql');

  assert.match(inventoryLedger, /source_document_id text NULL/);
  assert.match(finance, /movement\.source_document_id = document\.sales_order_id::text/);
  assert.equal(finance.includes('movement.source_document_id = document.sales_order_id\n'), false);
});
