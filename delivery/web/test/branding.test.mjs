import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const frameSource = readFileSync(new URL('../app/DeliveryAppFrame.tsx', import.meta.url), 'utf8');
const iconSource = readFileSync(new URL('../app/DeliveryIcon.tsx', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');

test('Delivery keeps Hưng Phát identity inside the native-like app shell', () => {
  assert.match(frameSource, /Hưng Phát Delivery/);
  assert.match(frameSource, /DeliveryIcon name="truck"/);
  assert.match(frameSource, /Chuyến hôm nay/);
  assert.match(iconSource, /truck:/);
  assert.match(pageSource, /title="Ứng dụng Giao hàng"/);
  assert.match(pageSource, /title="Chuyến của tôi"/);
  assert.doesNotMatch(pageSource, /office\.nguyenlieuhungphat\.com/);
});
