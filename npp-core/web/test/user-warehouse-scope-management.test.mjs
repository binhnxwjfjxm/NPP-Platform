import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workspace = await readFile(new URL('../app/access/users/scopes/user-scope-workspace.tsx', import.meta.url), 'utf8');
const route = await readFile(new URL('../app/api/access/users/[id]/scopes/route.ts', import.meta.url), 'utf8');
const accessTypes = await readFile(new URL('../lib/access-types.ts', import.meta.url), 'utf8');

test('warehouse scope UI keeps owner full-installation and regular-user zero-scope contracts visible', () => {
  assert.match(workspace, /Security Owner — toàn installation/);
  assert.match(workspace, /Zero-scope đang được chọn/);
  assert.match(workspace, /ngưng hoạt động \/ lịch sử/);
  assert.match(workspace, /branchIds: sortedIds\(draftBranchIds\)/);
  assert.match(workspace, /warehouseIds: sortedIds\(draftWarehouseIds\)/);
  assert.match(accessTypes, /warehouse_ids: string\[\]/);
  assert.match(accessTypes, /owner_kind: 'PERMANENT' \| 'TEMPORARY' \| null/);
});

test('scope mutation uses canonical shared HTTP Idempotency-Key and reuses key by logical intent', () => {
  assert.match(workspace, /createIdempotencyKey\('access-user-scopes'\)/);
  assert.match(workspace, /const existing = scopeKeys\.get\(intent\)/);
  assert.match(workspace, /'Idempotency-Key': idempotencyKey/);
  assert.match(route, /isValidIdempotencyKey/);
  assert.match(route, /normalizeIdempotencyKey/);
  assert.match(route, /'Idempotency-Key': idempotencyKey/);
  assert.doesNotMatch(workspace, /createIdempotencyKey\([^\n]*:/);
});
