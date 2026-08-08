import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');

test('Phase 9.2 keeps Customer Ordering on one canonical Sales Order lifecycle', async () => {
  const [migration, service, route, server, index] = await Promise.all([
    source('database/migrations/sales/071_customer_portal_order_intake.sql'),
    source('npp-core/api/src/services/customer-portal.js'),
    source('npp-core/api/src/routes/customer-portal.js'),
    source('npp-core/api/src/customer-portal-server.js'),
    source('npp-core/api/src/migrations/index.js'),
  ]);
  assert.match(migration, /shared\.portal_users/);
  assert.match(migration, /shared\.portal_identities/);
  assert.match(migration, /sales\.customer_portal_memberships/);
  assert.match(migration, /customer_portal_memberships_one_active_user_idx/);
  assert.doesNotMatch(migration, /CREATE TABLE[^;]+portal[^;]+orders/i);
  assert.match(service, /sourceType: 'API'/);
  assert.match(service, /CUSTOMER_PORTAL:/);
  assert.match(service, /customerId: membership\.customer_id/);
  assert.match(service, /warehouseId: membership\.default_warehouse_id/);
  assert.match(service, /salesChannelId: membership\.sales_channel_id/);
  assert.match(route, /executeRequestWithIdempotency/);
  assert.match(route, /withAuditOutboxTransaction/);
  assert.match(route, /customer_portal_mutation_error/);
  assert.match(server, /createCustomerPortalAuthenticator/);
  assert.match(index, /071_customer_portal_order_intake/);
});

test('Phase 9.2 portal reads are customer-isolated, source-filtered before limit, and fail closed', async () => {
  const [repository, service] = await Promise.all([
    source('npp-core/api/src/db/repositories/customer-portal.js'),
    source('npp-core/api/src/services/customer-portal.js'),
  ]);
  assert.match(repository, /result\.rows\.length !== 1/);
  assert.match(repository, /customer\.is_active = true/);
  assert.match(repository, /warehouse\.is_active = true/);
  assert.match(repository, /channel\.is_active = true/);
  assert.match(repository, /customer_id = \$2 AND id = \$3 AND is_active = true/);
  assert.match(repository, /so\.source_type = 'API'/);
  assert.match(repository, /so\.source_id LIKE 'CUSTOMER_PORTAL:%'/);
  assert.match(repository, /LIMIT \$4 OFFSET \$5/);
  assert.match(service, /listPortalOrderSnapshots/);
  assert.match(service, /loaded\.salesOrder\.customerId !== membership\.customer_id/);
  assert.match(service, /!portalSource\(loaded\.salesOrder\)/);
  assert.doesNotMatch(service, /payload\?\.customerId|payload\?\.warehouseId|payload\?\.salesChannelId/);
});

test('Phase 9.2 catalog pricing uses bounded concurrency and covers later fulfillment states', async () => {
  const service = await source('npp-core/api/src/services/customer-portal.js');
  assert.match(service, /CATALOG_PRICE_CONCURRENCY = 4/);
  assert.match(service, /mapWithConcurrency/);
  for (const state of ['partially_picked', 'picked', 'partially_packed', 'packed', 'partially_issued', 'issued']) {
    assert.match(service, new RegExp(state));
  }
});

test('Customer Portal server modules are loadable', async () => {
  await import('../src/customer-portal-auth.js');
  await import('../src/db/repositories/customer-portal.js');
  await import('../src/services/customer-portal.js');
  await import('../src/routes/customer-portal.js');
  await import('../src/customer-portal-server.js');
});
