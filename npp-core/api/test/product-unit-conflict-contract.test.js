import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUnitConflictResult } from '../src/services/product-unit.js';
import { enrichUnitErrorPayload } from '../src/routes/product-units.js';

test('unit deactivation keeps the legacy top-level code and adds active-dependent details', () => {
  const result = normalizeUnitConflictResult({
    ok: false,
    code: 'CONFLICT',
    message: 'Cannot deactivate a unit used by active product variants',
    retryable: false,
  }, 3);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'CONFLICT');
  assert.match(result.message, /3 SKU hoạt động/);
  assert.equal(result.details.conflictCode, 'ACTIVE_DEPENDENTS');
  assert.equal(result.details.conflictType, 'active_dependents');
  assert.equal(result.details.dependency.count, 3);
  assert.equal(result.details.dependency.entityType, 'product_variant');
});

test('unit optimistic-concurrency conflict becomes a stale-version contract', () => {
  const result = normalizeUnitConflictResult({
    ok: false,
    code: 'CONFLICT',
    message: 'Unit update conflict',
    retryable: false,
  });

  assert.equal(result.code, 'CONFLICT');
  assert.equal(result.details.conflictCode, 'STALE_VERSION');
  assert.equal(result.details.conflictType, 'stale_version');
  assert.equal(result.details.action, 'refresh_and_retry');
  assert.match(result.message, /tải lại dữ liệu/i);
});

test('route response preserves structured active-dependent details', () => {
  const payload = enrichUnitErrorPayload({
    error: {
      code: 'CONFLICT',
      message: 'Không thể ngừng đơn vị tính vì đang có 4 SKU hoạt động sử dụng đơn vị này. Hãy chuyển đơn vị hoặc ngừng các SKU liên quan trước rồi thử lại.',
      retryable: false,
      details: {},
    },
    requestId: 'req-test',
  });

  assert.equal(payload.error.details.conflictCode, 'ACTIVE_DEPENDENTS');
  assert.equal(payload.error.details.dependency.count, 4);
});

test('route response preserves structured stale-version details', () => {
  const payload = enrichUnitErrorPayload({
    error: {
      code: 'CONFLICT',
      message: 'Đơn vị tính đã được cập nhật bởi phiên khác. Vui lòng tải lại dữ liệu rồi thử lại.',
      retryable: false,
      details: {},
    },
  });

  assert.equal(payload.error.details.conflictCode, 'STALE_VERSION');
  assert.equal(payload.error.details.action, 'refresh_and_retry');
});
