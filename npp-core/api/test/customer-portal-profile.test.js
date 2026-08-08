import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routeSource = readFileSync(new URL('../src/routes/customer-portal.js', import.meta.url), 'utf8');
const profileSource = readFileSync(new URL('../src/services/customer-portal-profile.js', import.meta.url), 'utf8');

test('customer portal profile edit stays membership scoped and idempotent', () => {
  assert.match(routeSource, /req\.method === 'PATCH' && url\.pathname === '\/api\/customer-portal\/me'/);
  assert.match(routeSource, /route: '\/api\/customer-portal\/me'/);
  assert.match(routeSource, /executeRequestWithIdempotency/);
  assert.match(routeSource, /withAuditOutboxTransaction/);
  assert.match(routeSource, /auditProfileMutation/);
  assert.match(profileSource, /id: membership\.customer_id/);
  assert.match(profileSource, /customerId: membership\.customer_id/);
  assert.match(profileSource, /addressId !== before\.profile\.address\.id/);
  assert.match(profileSource, /updatedBy: requestContext\.actorId/);
});

test('customer portal profile edit exposes optimistic versions and cannot mutate authority fields', () => {
  assert.match(profileSource, /customerUpdatedAt: customer\.updated_at/);
  assert.match(profileSource, /updatedAt: row\.updated_at/);
  assert.match(profileSource, /expectedUpdatedAt: expectedCustomerUpdatedAt/);
  assert.match(profileSource, /expectedUpdatedAt: expectedAddressUpdatedAt/);
  assert.doesNotMatch(profileSource, /groupId\s*:/);
  assert.doesNotMatch(profileSource, /responsibleEmployeeId\s*:/);
  assert.doesNotMatch(profileSource, /defaultWarehouseId\s*:/);
  assert.doesNotMatch(profileSource, /salesChannelId\s*:/);
  assert.doesNotMatch(profileSource, /isActive\s*:/);
});
