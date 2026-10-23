import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appShell = readFileSync(new URL('../app/components/app-shell-core.tsx', import.meta.url), 'utf8');

test('Thanh điều hướng Công Ty không tự gọi trang nghiệp vụ khi chưa chọn', () => {
  const links = [...appShell.matchAll(/<Link\b[^>]*>/g)].map((match) => match[0]);
  assert.ok(links.length >= 6, 'Phải kiểm cả menu con và điều hướng chính');
  for (const link of links) {
    assert.match(link, /\bprefetch=\{false\}/, 'Tự tải trước không cần thiết: ' + link);
    assert.doesNotMatch(link, /\bprefetch(?:\s|>)/, 'Không bật lại chế độ tự tải trước');
  }
  assert.match(appShell, /groupChildren\.map\(\(item\) => <Link\b/);
});

test('Giữ nguyên lối vào các trang nghiệp vụ và điều hướng khi bấm', () => {
  for (const route of [
    '/sales/reporting',
    '/management/proposals',
    '/sales/quotations',
    '/sales/sales-orders',
    '/sales/order-management',
    '/management/customer-onboarding',
    '/purchasing/reporting',
    '/accounting/aging',
  ]) {
    assert.ok(appShell.includes("href: '" + route + "'"), 'Thiếu đường dẫn: ' + route);
  }
  assert.match(appShell, /key=\{item\.href\} href=\{item\.href\} prefetch=\{false\}/);
});
