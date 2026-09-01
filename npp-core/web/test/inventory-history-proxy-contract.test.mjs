import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

async function source(relativePath) {
  return readFile(join(repoRoot, relativePath), 'utf8');
}

test('inventory history web route forwards the canonical history endpoint and warehouse scope', async () => {
  const gateway = await source('npp-core/web/lib/inventory-gateway.ts');
  const route = await source('npp-core/web/app/api/inventory/balances/history/route.ts');

  assert.match(gateway, /ALLOWED_QUERY_KEYS=new Set\(\[[^\]]*'scope'/);
  assert.match(gateway, /export function listInventoryBalanceHistory<[^>]+>\(requestId:string,searchParams:URLSearchParams\):Promise<[^>]+>\{return req<[^>]+>\(\{path:'\/balances\/history',method:'GET',requestId,searchParams\}\);\}/);
  assert.match(route, /listInventoryBalanceHistory<unknown\[]>\(requestId, request\.nextUrl\.searchParams\)/);
  assert.match(route, /return errorResponse\(error, requestId\)/);
});
