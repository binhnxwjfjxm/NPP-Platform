import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

test('Công Ty manages customer photos inside Thiết lập nhanh and no longer renders the separate photo button', () => {
  const page = read('../app/customers/page.tsx');
  const tabs = read('../app/customers/customer-bulk-tabs-launcher.tsx');
  const quick = read('../app/customers/customer-quick-setup-workspace.tsx');
  assert.doesNotMatch(page, /CustomerMediaLauncher/);
  assert.match(tabs, /customers-quick-setup-tab/);
  assert.match(tabs, />\s*Thiết lập nhanh<\/button>/);
  assert.match(quick, /@npp\/contracts\/customer-media-browser/);
  assert.match(quick, /createIdempotencyKey\('web-customer-media-prepare'\)/);
  assert.match(quick, /createIdempotencyKey\('web-customer-media-finalize'\)/);
  assert.match(quick, /method: 'PUT'/);
  assert.match(quick, /bấm vào ảnh để xem lớn/);
  assert.match(quick, /setPreviewUrl\(item\.viewUrl\)/);
});

test('Công Ty customer-media gateway keeps R2 credentials and durable object keys out of the browser route', () => {
  const gateway = read('../lib/customer-media-gateway.ts');
  const route = read('../app/api/customers/[id]/media/route.ts');
  assert.match(gateway, /server-only/);
  assert.match(gateway, /requireNppWorkforceSessionToken/);
  assert.match(gateway, /isValidIdempotencyKey/);
  assert.doesNotMatch(route, /R2_ACCESS_KEY|R2_SECRET|objectKey/);
});
