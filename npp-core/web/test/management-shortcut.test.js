import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const coreShellSource = readFileSync(new URL('../app/components/app-shell-core.tsx', import.meta.url), 'utf8');
const wrapperSource = readFileSync(new URL('../app/components/app-shell.tsx', import.meta.url), 'utf8');
const managementSource = readFileSync(new URL('../app/management/page.tsx', import.meta.url), 'utf8');

test('NPP keeps all daily sales work inside the Sales navigation group', () => {
  assert.match(coreShellSource, /href: '\/management', label: 'Điều hành bán hàng'/);
  assert.match(coreShellSource, /href: '\/sales\/sales-orders', label: 'Đơn bán hàng'/);
  assert.match(coreShellSource, /href: '\/management\/customer-onboarding', label: 'Mở \/ liên kết mã khách'/);
  assert.match(coreShellSource, /testId: 'nav-sales-operations'/);
  assert.match(coreShellSource, /testId: 'nav-customer-onboarding'/);
  assert.match(coreShellSource, /pathname\.startsWith\('\/management'\)/);
  assert.match(coreShellSource, /Đơn nhiều nguồn, mã khách và vòng đời thương mại/);
});

test('customer context surfaces the canonical onboarding workspace without creating another lifecycle', () => {
  assert.match(coreShellSource, /href: '\/customers', label: 'Khách hàng'/);
  assert.match(coreShellSource, /href: '\/management\/customer-onboarding', label: 'Yêu cầu mở mã khách hàng', icon: 'user', testId: 'nav-customer-onboarding-from-customers'/);
  assert.equal((coreShellSource.match(/href: '\/management\/customer-onboarding'/g) || []).length, 2);
  assert.doesNotMatch(coreShellSource, /\/customers\/customer-onboarding/);
});

test('the Sales group stays active without marking both management links active', () => {
  assert.match(coreShellSource, /href === '\/organization' \|\| href === '\/management'/);
});

test('NPP does not expose sales operations as a global shortcut', () => {
  assert.doesNotMatch(wrapperSource, /nav-management-shortcut/);
  assert.doesNotMatch(wrapperSource, /Công việc hằng ngày/);
});

test('sales operations explains multi-source intake and official customer-code handling', () => {
  assert.match(managementSource, /Điều hành bán hàng/);
  assert.match(managementSource, /các nguồn/);
  assert.match(managementSource, /xử lý mã khách/);
  assert.match(managementSource, /đơn bán hàng chính thức/);
  assert.match(managementSource, /Đề nghị mở hoặc liên kết mã khách/);
});