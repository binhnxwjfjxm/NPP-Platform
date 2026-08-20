import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Lô 5 có vầng sáng filter trượt, timeline và chuyển cảnh thống nhất', async () => {
  const [page, styles] = await Promise.all([read('app/page.tsx'), read('app/globals.css')]);
  assert.match(page, /filterMarker/);
  assert.match(page, /className="filter-highlight"/);
  assert.match(page, /order-timeline/);
  assert.match(page, /order\.status !== 'cancelled'/);
  assert.doesNotMatch(page, /vẫn có thể sửa đơn/);
  assert.match(page, /Lên đơn', 'Đã chốt', 'Xuất kho', 'Hoàn thành/);
  assert.match(styles, /\.filter-highlight[\s\S]*?transition: transform var\(--motion-page\)/);
  assert.match(styles, /\.sheet-enter[\s\S]*?sheet-in/);
  assert.match(styles, /prefers-reduced-motion/);
});

test('Lô 5 chỉ cache static shell, không cache API hoặc mutation nghiệp vụ', async () => {
  const serviceWorker = await read('public/sw.js');
  assert.match(serviceWorker, /request\.method !== 'GET'/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(serviceWorker, /\['script', 'style', 'image', 'font'\]/);
  assert.doesNotMatch(serviceWorker, /POST|Idempotency-Key|settlement/);
});

test('Lô 5 đăng ký PWA và dùng icon Retail đã được cung cấp', async () => {
  const [registration, manifest] = await Promise.all([read('app/pwa-registration.tsx'), read('app/manifest.ts')]);
  assert.match(registration, /navigator\.serviceWorker\.register\('\/sw\.js'\)/);
  assert.match(manifest, /pwa-icon-retail\.png/);
  assert.match(manifest, /maskable/);
});
