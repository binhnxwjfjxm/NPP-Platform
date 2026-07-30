import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  activeDependentsConflict,
  domainConflict,
  staleVersionConflict,
} from '../src/services/deactivate-conflict-contract.js';

test('deactivate conflict contract preserves legacy codes and adds stable discriminators', () => {
  const dependency = activeDependentsConflict({
    message: 'Không thể ngưng hoạt động sản phẩm vì còn SKU đang hoạt động.',
    reason: 'PRODUCT_HAS_ACTIVE_SKUS',
    dependentType: 'product_variant',
    dependentLabel: 'SKU đang hoạt động',
    count: 3,
    managementPath: '/products',
    action: 'deactivate_skus_first',
  });
  assert.equal(dependency.code, 'CANNOT_DEACTIVATE');
  assert.equal(dependency.details.conflictCode, 'ACTIVE_DEPENDENTS');
  assert.equal(dependency.details.conflictType, 'active_dependents');
  assert.equal(dependency.details.dependency.count, 3);
  assert.equal(dependency.details.dependency.managementPath, '/products');

  const stale = staleVersionConflict({ entityLabel: 'Chi nhánh', managementPath: '/organization/branches' });
  assert.equal(stale.code, 'CONFLICT');
  assert.equal(stale.details.conflictCode, 'STALE_VERSION');
  assert.equal(stale.details.conflictType, 'stale_version');
  assert.equal(stale.details.action, 'refresh_and_retry');
});

test('domain conflict keeps parent-inactive codes and sanitized machine-readable details', () => {
  const result = domainConflict({
    message: 'Không thể kích hoạt kho khi chi nhánh cha đang ngưng hoạt động.',
    reason: 'PARENT_BRANCH_INACTIVE',
    managementPath: '/organization/branches',
  });
  assert.equal(result.code, 'BRANCH_INACTIVE');
  assert.equal(result.details.conflictCode, 'DOMAIN_CONFLICT');
  assert.equal(result.details.reason, 'PARENT_BRANCH_INACTIVE');
  assert.equal(result.details.managementPath, '/organization/branches');
  assert.equal(Object.keys(result.details).some((key) => /sql|password|token/i.test(key)), false);
});
