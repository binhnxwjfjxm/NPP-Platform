import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const workspacePath = fileURLToPath(new URL('../app/sales/sales-orders/SalesOrderWorkspace.tsx', import.meta.url));
const routePath = fileURLToPath(new URL('../app/api/sales-orders/[id]/issue-stock/route.ts', import.meta.url));
const gatewayPath = fileURLToPath(new URL('../lib/sales-order-gateway.ts', import.meta.url));

test('Issue #622 Xuất kho has a Công Ty web route that preserves body and idempotency contract', async () => {
  const [workspace, route, gateway] = await Promise.all([
    readFile(workspacePath, 'utf8'),
    readFile(routePath, 'utf8'),
    readFile(gatewayPath, 'utf8'),
  ]);

  assert.match(workspace, /\/api\/sales-orders\/\$\{selected\.id\}\/issue-stock/);
  assert.match(workspace, /headers: \{ 'Idempotency-Key': key \}/);
  assert.match(workspace, /body: JSON\.stringify\(\{ expectedRevision: current\.revision \}\)/);
  assert.match(route, /export async function POST/);
  assert.match(route, /readSalesOrderBody\(request, requestId\)/);
  assert.match(route, /issueManualSalesOrderStock<SalesOrder>/);
  assert.match(route, /salesOrderIdempotencyKey\(request\)/);
  assert.match(route, /salesOrderErrorResponse\(error, requestId\)/);
  assert.match(gateway, /export function issueManualSalesOrderStock<T>/);
  assert.match(gateway, /method:'POST',path:`\$\{path\(id\)\}\/issue-stock`/);
  assert.match(gateway, /body:b,idempotencyKey:key\(k\)/);
});
