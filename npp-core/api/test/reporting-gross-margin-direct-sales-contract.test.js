import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('gross margin direct-sales lineage compares canonical source ids with compatible PostgreSQL types', () => {
  const inventorySchema = source('../../../database/migrations/inventory/017_inventory_ledger_foundation.sql');
  const receivableSchema = source('../../../database/migrations/accounting/053_customer_receivable_ledger.sql');
  const finance = source('../src/routes/reporting-finance.js');

  assert.match(inventorySchema, /source_document_id text NULL/);
  assert.match(receivableSchema, /sales_order_id uuid NOT NULL/);
  assert.match(finance, /movement\.source_document_id = document\.sales_order_id::text/);
  assert.doesNotMatch(finance, /movement\.source_document_id = document\.sales_order_id\s*(?:\n|AND)/);
});
