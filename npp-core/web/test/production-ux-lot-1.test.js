import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');

test('pricing creation requests receive stable idempotency keys', async () => {
  const [boundary, page] = await Promise.all([
    readSource('../app/pricing/pricing-idempotency-boundary.tsx'),
    readSource('../app/pricing/page.tsx'),
  ]);

  assert.match(boundary, /Idempotency-Key/);
  assert.match(boundary, /pendingKeys\.get\(fingerprint\)/);
  assert.match(boundary, /pendingKeys\.delete\(fingerprint\)/);
  assert.match(boundary, /\/api\\\/sales-channels/);
  assert.match(boundary, /\/api\\\/price-lists/);
  assert.match(page, /PricingIdempotencyBoundary/);
});

test('favicon route returns the official application logo with HTTP 200', async () => {
  const route = await readSource('../app/favicon.ico/route.ts');
  assert.match(route, /logo-transparent\.png/);
  assert.match(route, /status: 200/);
  assert.match(route, /preserveAspectRatio="xMidYMid meet"/);
});

test('Vietnam administrative selector is shared outside the customer module', async () => {
  const [shared, customerWrapper] = await Promise.all([
    readSource('../app/components/vietnam-administrative-fields.tsx'),
    readSource('../app/customers/vietnam-administrative-fields.tsx'),
  ]);

  assert.match(shared, /provinceCode=/);
  assert.match(shared, /Xã\/phường\/đặc khu/);
  assert.match(shared, /Quận\/huyện \(dữ liệu cũ\)/);
  assert.match(customerWrapper, /SharedVietnamAdministrativeFields/);
});
