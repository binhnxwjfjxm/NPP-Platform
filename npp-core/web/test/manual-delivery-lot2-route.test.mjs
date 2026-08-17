import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const formPath = fileURLToPath(new URL('../app/sales/sales-orders/SalesOrderCommercialForm.tsx', import.meta.url));
const routePath = fileURLToPath(new URL('../app/api/sales-orders/[id]/manual-edit/route.ts', import.meta.url));
const gatewayPath = fileURLToPath(new URL('../lib/sales-order-gateway.ts', import.meta.url));

test('Issue #622 Lô 2 manual edit has a Công Ty web route to the backend contract', async () => {
  const [form, route, gateway] = await Promise.all([
    readFile(formPath, 'utf8'),
    readFile(routePath, 'utf8'),
    readFile(gatewayPath, 'utf8'),
  ]);

  assert.match(form, /\/api\/sales-orders\/\$\{props\.orderId\}\/manual-edit/);
  assert.match(route, /export async function PUT/);
  assert.match(route, /quickEditManualSalesOrder<SalesOrder>/);
  assert.match(route, /salesOrderIdempotencyKey\(request\)/);
  assert.match(gateway, /export function quickEditManualSalesOrder<T>/);
  assert.match(gateway, /method:'PUT',path:`\$\{path\(id\)\}\/manual-edit`/);
  assert.match(gateway, /idempotencyKey:key\(k\)/);
});
