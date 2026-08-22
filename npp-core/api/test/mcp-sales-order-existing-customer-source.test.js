import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('MCP Sales Order keeps source id required but field outlet optional for existing Công Ty customers', () => {
  const service = source('../src/services/sales-order-legacy.js');
  assert.match(service, /sourceId = text\(payload\?\.sourceId, 256, sourceType !== 'MANUAL'\)/);
  assert.match(service, /sourceOutletId = text\(payload\?\.sourceOutletId, 256, false\)/);
  assert.doesNotMatch(service, /SOURCE_OUTLET_ID_REQUIRED/);
  assert.match(service, /sourceType === 'MCP' && payload\?\.sourceOutletId && !sourceOutletId/);
});

test('migration 107 allows MCP source without a field outlet and is registered', () => {
  const migration = source('../../../database/migrations/sales/107_mcp_sales_order_existing_customer_source.sql');
  const registry = source('../src/migrations/index.js');
  assert.match(migration, /source_type = 'MCP' AND source_id IS NOT NULL/);
  assert.doesNotMatch(migration, /source_type = 'MCP' AND source_id IS NOT NULL AND source_outlet_id IS NOT NULL/);
  assert.match(registry, /107_mcp_sales_order_existing_customer_source/);
});
