import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(relative) {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

test('commercial enrichment keeps a truly addressless sales order snapshot null', () => {
  const commercialRepository = source('../src/db/repositories/sales-order-commercial.js');
  const confirmationMigration = source('../../../database/migrations/sales/124_sales_order_address_optional.sql');

  assert.match(
    commercialRepository,
    /WHEN version\.customer_address_snapshot IS NULL\s+AND version\.customer_address_id IS NULL THEN NULL/,
  );
  assert.match(
    confirmationMigration,
    /NEW\.customer_address_id IS NULL[\s\S]*NEW\.customer_address_snapshot IS NOT NULL[\s\S]*sales_order_delivery_destination_invalid/,
  );
});
