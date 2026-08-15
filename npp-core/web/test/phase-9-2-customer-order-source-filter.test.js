import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL('../app/sales/sales-orders/SalesOrderWorkspace.tsx', import.meta.url);

test('Sales Order workspace filters one canonical list by source lineage and shows source on each row', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  for (const label of ['Nguồn', 'Tất cả', 'Công Ty', 'Nhân viên thị trường', 'Khách hàng']) assert.ok(source.includes(label), `missing ${label}`);
  assert.match(source, /CUSTOMER_PORTAL:/);
  assert.match(source, /order\.sourceType === 'MCP'/);
  assert.match(source, /order\.sourceType === 'API'/);
  assert.match(source, /Nguồn \{salesOrderSourceLabel\(order\)\}/);
  assert.doesNotMatch(source, /customerOrders|mcpOrders|internalOrders/);
});
