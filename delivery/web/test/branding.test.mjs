import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pageSource = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const styleSource = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

test('Delivery displays the Hưng Phát logo in setup, authentication and active-driver states', () => {
  assert.match(pageSource, /NEXT_PUBLIC_APP_LOGO_URL/);
  assert.match(pageSource, /office\.nguyenlieuhungphat\.com\/logo-transparent\.png/);
  assert.match(pageSource, /function DeliveryHeader/);
  assert.match(pageSource, /alt="Logo Hưng Phát Company"/);
  assert.match(pageSource, /title="Ứng dụng Giao hàng"/);
  assert.match(pageSource, /title="Chuyến của tôi"/);
  assert.match(styleSource, /\.brandLogoFrame/);
  assert.match(styleSource, /\.brandLogo/);
  assert.doesNotMatch(pageSource, />HP<\/div>/);
});
