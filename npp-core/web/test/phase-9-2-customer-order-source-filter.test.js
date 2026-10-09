import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL('../app/sales/sales-orders/SalesOrderWorkspace.tsx', import.meta.url);

test('Sales Order workspace filters one canonical list by source lineage without rendering source on each card', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  for (const label of ['Nguồn', 'Tất cả', 'Công Ty', 'Nhân viên thị trường', 'Khách hàng']) assert.ok(source.includes(label), `missing ${label}`);
  const repository = await readFile(new URL('../../api/src/db/repositories/sales-order.js', import.meta.url), 'utf8');
  assert.match(repository, /CUSTOMER_PORTAL:/);
  assert.match(repository, /source==='mcp'/);
  assert.match(repository, /source==='customer'/);
  assert.doesNotMatch(source, /Nguồn \{salesOrderSourceLabel\(order\.sourceType, order\.sourceId\)\}/);
  assert.doesNotMatch(source, /customerOrders|mcpOrders|internalOrders/);
});
