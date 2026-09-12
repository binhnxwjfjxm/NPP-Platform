import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../app/customers/page.tsx', import.meta.url), 'utf8');
const tabs = readFileSync(new URL('../app/customers/customer-bulk-tabs-launcher.tsx', import.meta.url), 'utf8');
const quick = readFileSync(new URL('../app/customers/customer-quick-setup-workspace.tsx', import.meta.url), 'utf8');

test('Ảnh khách được chuyển khỏi thanh thao tác vào Thiết lập nhanh', () => {
  assert.doesNotMatch(page, /CustomerMediaLauncher/);
  assert.match(tabs, /customers-quick-setup-tab/);
  assert.match(tabs, />Thiết lập nhanh<\/button>/);
  assert.match(quick, /<h3>Ảnh khách hàng<\/h3>/);
  assert.match(quick, /bấm vào ảnh để xem lớn/);
  assert.match(quick, /role="dialog" aria-modal="true" aria-label="Xem ảnh khách hàng"/);
});
