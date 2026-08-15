import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const frameSource = readFileSync(new URL('../app/DeliveryAppFrame.tsx', import.meta.url), 'utf8');
const loginSource = readFileSync(new URL('../app/login/page.tsx', import.meta.url), 'utf8');
const iconSource = readFileSync(new URL('../app/DeliveryIcon.tsx', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');

test('Delivery keeps one approved Hưng Phát logo source across login, shell and PWA source artwork', () => {
  assert.match(frameSource, /NEXT_PUBLIC_APP_LOGO_URL/);
  assert.match(frameSource, /\/logo-transparent\.png/);
  assert.match(frameSource, /className="deliveryAppLogo"/);
  assert.match(loginSource, /NEXT_PUBLIC_APP_LOGO_URL/);
  assert.match(loginSource, /\/logo-transparent\.png/);
  assert.doesNotMatch(frameSource, /DeliveryIcon name="truck"/);

  const shellLogo = readFileSync(new URL('../public/logo-transparent.png', import.meta.url));
  const approvedSource = readFileSync(new URL('../../../pwa-icon-deliveri.png', import.meta.url));
  assert.equal(shellLogo.equals(approvedSource), true);
});

test('Delivery keeps Hưng Phát identity and route copy inside the native-like app shell', () => {
  assert.match(frameSource, /Hưng Phát Delivery/);
  assert.match(frameSource, /Chuyến hôm nay/);
  assert.match(iconSource, /truck:/);
  assert.match(pageSource, /title="Ứng dụng Giao hàng"/);
  assert.match(pageSource, /title="Chuyến của tôi"/);
  assert.doesNotMatch(pageSource, /office\.nguyenlieuhungphat\.com/);
});
