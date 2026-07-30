import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProductStatusError } from '../lib/product-status-error.js';

test('translates unit dependency conflict', () => {
  assert.match(
    normalizeProductStatusError({ message: 'Cannot deactivate a unit used by active product variants' }),
    /Không thể ngừng đơn vị tính/,
  );
});

test('includes structured dependency count', () => {
  const message = normalizeProductStatusError({
    message: 'Không thể ngừng sử dụng.',
    details: {
      conflictType: 'active_dependents',
      dependency: { label: 'SKU đang hoạt động', count: 3 },
    },
  });
  assert.match(message, /SKU đang hoạt động: 3/);
});

test('turns stale conflict into refresh guidance', () => {
  assert.match(
    normalizeProductStatusError({ details: { conflictType: 'stale_version' } }),
    /làm mới/i,
  );
});
