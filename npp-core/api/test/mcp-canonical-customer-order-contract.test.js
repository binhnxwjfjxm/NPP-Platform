import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const service = readFileSync(new URL('../src/services/sales-order-legacy.js', import.meta.url), 'utf8');
const migrationIndex = readFileSync(new URL('../src/migrations/index.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../../database/migrations/sales/162_mcp_canonical_customer_orders.sql', import.meta.url), 'utf8');
const migrationIndex = readFileSync(new URL('../src/migrations/index.js', import.meta.url), 'utf8');

test('MCP canonical customer order may omit field outlet provenance', () => {
  assert.match(service, /const sourceOutletId = text\(payload\?\.sourceOutletId, 256, false\)/);
  assert.doesNotMatch(service, /SOURCE_OUTLET_ID_REQUIRED/);
  assert.match(migration, /source_type = 'MCP' AND source_id IS NOT NULL/);
  assert.doesNotMatch(migration, /source_type = 'MCP' AND source_id IS NOT NULL AND source_outlet_id IS NOT NULL/);
  assert.match(migrationIndex, /162_mcp_canonical_customer_orders/);
  assert.match(migrationIndex, /sales\/162_mcp_canonical_customer_orders\.sql/);
});


test('MCP canonical customer order migration is registered in Công Ty migration flow', () => {
  assert.match(migrationIndex, /migration\('107_mcp_canonical_customer_orders', 'sales\/105_mcp_canonical_customer_orders\.sql'\)/);
});
