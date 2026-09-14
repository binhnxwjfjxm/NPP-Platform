import test from 'node:test';
import assert from 'node:assert/strict';

import {
  serviceResultError,
  statusForServiceResult,
} from '../src/routes/organization.js';

test('organization routes map service validation, not-found, and conflict results without throwing', () => {
  assert.equal(statusForServiceResult({ code: 'INVALID_ACTIVE_STATUS' }), 400);
  assert.equal(statusForServiceResult({ code: 'NOT_FOUND' }), 404);
  assert.equal(statusForServiceResult({ code: 'WAREHOUSE_NOT_FOUND' }), 404);
  assert.equal(statusForServiceResult({ code: 'DUPLICATE_CODE' }), 409);
  assert.equal(statusForServiceResult({ code: 'BRANCH_INACTIVE' }), 409);
  assert.equal(statusForServiceResult({ code: 'WAREHOUSE_INACTIVE' }), 409);
  assert.equal(statusForServiceResult({ code: 'CANNOT_DEACTIVATE' }), 409);
  assert.equal(statusForServiceResult({ code: 'CONFLICT' }), 409);
});

test('organization routes honor canonical conflict detail codes and preserve details', () => {
  const serviceResult = {
    ok: false,
    code: 'CANNOT_DEACTIVATE',
    message: 'Không thể ngưng hoạt động kho vì còn vị trí kho đang hoạt động.',
    retryable: false,
    details: {
      conflictCode: 'ACTIVE_DEPENDENTS',
      conflictType: 'active_dependents',
      dependency: {
        entityType: 'warehouse_location',
        count: 2,
      },
    },
  };

  assert.equal(statusForServiceResult(serviceResult), 409);
  assert.deepEqual(serviceResultError(serviceResult, 409), {
    code: 'CANNOT_DEACTIVATE',
    message: serviceResult.message,
    details: serviceResult.details,
    retryable: false,
    statusCode: 409,
  });
});
