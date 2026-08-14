import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

test('Core customers expose one compact customer-media manager backed by the shared browser contract', () => {
  const page = read('../app/customers/page.tsx');
  const launcher = read('../app/customers/customer-media-launcher.tsx');
  const dialog = read('../app/customers/customer-media-dialog.tsx');
  assert.match(page, /CustomerMediaLauncher/);
  assert.match(launcher, />\s*Ảnh khách\s*</);
  assert.match(dialog, /@npp\/contracts\/customer-media-browser/);
  assert.match(dialog, /createIdempotencyKey\('web-customer-media-prepare'\)/);
  assert.match(dialog, /createIdempotencyKey\('web-customer-media-finalize'\)/);
  assert.match(dialog, /method: 'PUT'/);
  assert.match(dialog, /maxPhotos/);
});

test('Core customer-media gateway keeps R2 credentials and durable object keys out of the browser route', () => {
  const gateway = read('../lib/customer-media-gateway.ts');
  const route = read('../app/api/customers/[id]/media/route.ts');
  assert.match(gateway, /server-only/);
  assert.match(gateway, /requireNppWorkforceSessionToken/);
  assert.match(gateway, /isValidIdempotencyKey/);
  assert.doesNotMatch(route, /R2_ACCESS_KEY|R2_SECRET|objectKey/);
});
