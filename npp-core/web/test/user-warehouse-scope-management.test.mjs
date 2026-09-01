import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workspace = await readFile(new URL('../app/access/users/scopes/user-scope-workspace.tsx', import.meta.url), 'utf8');
const route = await readFile(new URL('../app/api/access/users/[id]/scopes/route.ts', import.meta.url), 'utf8');
const accessTypes = await readFile(new URL('../lib/access-types.ts', import.meta.url), 'utf8');
const appShell = await readFile(new URL('../app/components/app-shell.tsx', import.meta.url), 'utf8');
const coreShell = await readFile(new URL('../app/components/app-shell-core.tsx', import.meta.url), 'utf8');

test('warehouse scope UI keeps full-company owner and regular-user empty-scope behavior visible', () => {
  assert.match(workspace, /Tài khoản quản trị — toàn Công Ty/);
  assert.match(workspace, /Chưa cấp kho:/);
  assert.match(workspace, /ngừng sử dụng \/ lịch sử/);
  assert.match(workspace, /branchIds: sortedIds\(draftBranchIds\)/);
  assert.match(workspace, /warehouseIds: sortedIds\(draftWarehouseIds\)/);
  assert.match(accessTypes, /warehouse_ids: string\[\]/);
  assert.match(accessTypes, /owner_kind: 'PERMANENT' \| 'TEMPORARY' \| null/);
  assert.doesNotMatch(workspace, /Security Owner|Zero-scope|toàn installation|canonical|Core tự tính/);
});

test('Người dùng exposes Tài khoản and Phạm vi chi nhánh & kho as child tabs, not sidebar items', () => {
  assert.match(appShell, /props\.title === 'Người dùng'/);
  assert.match(appShell, /props\.title === 'Phạm vi chi nhánh & kho'/);
  assert.match(appShell, /href="\/access\/users"/);
  assert.match(appShell, /Tài khoản/);
  assert.match(appShell, /href="\/access\/users\/scopes"/);
  assert.match(appShell, /Phạm vi chi nhánh &amp; kho/);
  assert.match(appShell, /aria-current=/);
  assert.doesNotMatch(appShell, /usePathname/);
  assert.doesNotMatch(coreShell, /href: '\/access\/users\/scopes'/);
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
