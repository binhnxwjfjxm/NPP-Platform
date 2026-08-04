import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const coreShellSource = readFileSync(new URL('../app/components/app-shell-core.tsx', import.meta.url), 'utf8');
const wrapperSource = readFileSync(new URL('../app/components/app-shell.tsx', import.meta.url), 'utf8');
const managementSource = readFileSync(new URL('../app/management/page.tsx', import.meta.url), 'utf8');

test('NPP keeps sales operations inside the Sales navigation group', () => {
  assert.match(coreShellSource, /href: '\/management'/);
  assert.match(coreShellSource, /label: 'Điều hành bán hàng'/);
  assert.match(coreShellSource, /testId: 'nav-sales-operations'/);
  assert.match(coreShellSource, /pathname\.startsWith\('\/management'\)/);
  assert.match(coreShellSource, /Tiếp nhận, duyệt và quản lý đơn bán hàng/);
});

test('NPP does not expose sales operations as a global shortcut', () => {
  assert.doesNotMatch(wrapperSource, /nav-management-shortcut/);
  assert.doesNotMatch(wrapperSource, /Công việc hằng ngày/);
});

test('sales operations explains the multi-source order intake role', () => {
  assert.match(managementSource, /Điều hành bán hàng/);
  assert.match(managementSource, /các nguồn/);
  assert.match(managementSource, /đơn bán hàng chính thức/);
});
