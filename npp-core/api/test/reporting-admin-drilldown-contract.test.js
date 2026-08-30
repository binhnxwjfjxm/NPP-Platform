import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Admin drill-down extends Sales reporting with bounded customer and document facts', () => {
  const sales = source('../src/routes/reporting-sales.js');

  assert.match(sales, /customers: compatibilityCustomerRows/);
  assert.match(sales, /documents: mapRows\(documentsResult\.rows\)/);
  assert.match(sales, /so\.id AS sales_order_id/);
  assert.match(sales, /sov\.customer_id/);
  assert.match(sales, /so\.order_number/);
  assert.match(sales, /slice\(0, 100\)/);
  assert.match(sales, /LIMIT 200/);
  assert.match(sales, /so\.status IN \('confirmed','closed'\)/);
  assert.match(sales, /customers: breakdown\(facts, 'customers'\)/);
  assert.match(sales, /entityIdentity = identity\(dimension\.id/);
  assert.doesNotMatch(sales, /parseFloat\(|parseInt\(|Number\(/);
});

test('Admin drill-down extends Employee MCP reporting with outlet and visit facts under existing scope', () => {
  const mcp = source('../src/routes/reporting-employee-mcp.js');

  assert.match(mcp, /sessionCustomers: mapRows\(sessionCustomers\.rows\)/);
  assert.match(mcp, /visits: mapRows\(visits\.rows\)/);
  assert.match(mcp, /customer\.session_id = session\.session_id/);
  assert.match(mcp, /visit\.session_id = session\.session_id/);
  assert.match(mcp, /customer\.order_id AS order_intent_id/);
  assert.match(mcp, /customer\.test_id/);
  assert.match(mcp, /customer\.report_id/);
  assert.match(mcp, /customer\.followup_count::text/);
  assert.match(mcp, /LIMIT 300/);
  assert.match(mcp, /LIMIT 400/);
  assert.doesNotMatch(mcp, /checkin_lat|checkin_lng|geo_lat|geo_lng|geo_accuracy/i);
  assert.doesNotMatch(mcp, /INSERT\s+INTO|UPDATE\s+mcp\.|DELETE\s+FROM/i);
});
