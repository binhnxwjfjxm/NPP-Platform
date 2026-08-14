import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workspace = await readFile(new URL('../app/access/users/user-workspace.tsx', import.meta.url), 'utf8');
const page = await readFile(new URL('../app/access/users/page.tsx', import.meta.url), 'utf8');
const route = await readFile(new URL('../app/api/access/users/[id]/scopes/route.ts', import.meta.url), 'utf8');
const accessTypes = await readFile(new URL('../lib/access-types.ts', import.meta.url), 'utf8');

test('warehouse scope management lives in the canonical access/users screen', () => {
  assert.match(page, /loadOrganizationSnapshot/);
  assert.match(page, /initialBranches=\{branches\}/);
  assert.match(page, /initialWarehouses=\{warehouses\}/);
  assert.match(workspace, /Phạm vi kho/);
  assert.match(workspace, /Security Owner — toàn installation/);
  assert.match(workspace, /zero-scope/);
  assert.match(workspace, /ngưng hoạt động \/ lịch sử/);
  assert.match(workspace, /branchIds: sortedIds\(draft\.branchIds\)/);
  assert.match(workspace, /warehouseIds: sortedIds\(draft\.warehouseIds\)/);
  assert.match(workspace, /\/api\/access\/users\/\$\{userId\}\/scopes/);
  assert.match(accessTypes, /warehouse_ids: string\[\]/);
  assert.match(accessTypes, /owner_kind: 'PERMANENT' \| 'TEMPORARY' \| null/);
});

test('scope mutation uses canonical shared HTTP Idempotency-Key and reuses key by logical intent', () => {
  assert.match(workspace, /createIdempotencyKey\(`access-user-\$\{operation\}`\)/);
  assert.match(workspace, /const existing = idempotencyKeys\.get\(intent\)/);
  assert.match(workspace, /keyFor\('scopes', userId, payload\)/);
  assert.match(workspace, /'Idempotency-Key': keyFor\('scopes', userId, payload\)/);
  assert.match(route, /isValidIdempotencyKey/);
  assert.match(route, /normalizeIdempotencyKey/);
  assert.match(route, /'Idempotency-Key': idempotencyKey/);
  assert.doesNotMatch(workspace, /createIdempotencyKey\([^\n]*:/);
});
