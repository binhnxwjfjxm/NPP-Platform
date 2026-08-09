import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../app/management/customer-onboarding/customer-onboarding-review.tsx', import.meta.url), 'utf8');

test('customer onboarding review renders deterministic Vietnam time to avoid hydration recovery', () => {
  assert.match(source, /timeZone:\s*'Asia\/Ho_Chi_Minh'/);
  assert.doesNotMatch(source, /toLocaleString\('vi-VN'\)/);
  assert.match(source, /formatUpdatedAt\(request\.updatedAt\)/);
});

test('customer onboarding review clearly separates new-customer and existing-customer paths', () => {
  assert.match(source, /Tạo khách mới từ đăng ký/);
  assert.match(source, /Tên khách sẽ tạo/);
  assert.match(source, /Tên quán \/ điểm bán/);
  assert.match(source, /Liên kết khách đã có/);
  assert.match(source, /Mô hình quán/);
});
