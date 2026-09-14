import test from 'node:test';
import assert from 'node:assert/strict';
import { updateBranch, updateBranchActiveStatus } from '../src/db/repositories/branch.js';
import { updateWarehouse, updateWarehouseActiveStatus } from '../src/db/repositories/warehouse.js';
import { updateWarehouseLocation, updateWarehouseLocationActiveStatus } from '../src/db/repositories/location.js';

const CANONICAL_VERSION_WRITE = "updated_at = date_trunc('milliseconds', GREATEST(clock_timestamp(), updated_at + interval '1 millisecond'))";
const expectedUpdatedAt = '2026-09-14T18:50:11.123Z';

function captureClient() {
  const calls = [];
  return {
    calls,
    async query(query, params) {
      calls.push({ query, params });
      return { rows: [{ id: 'row-1' }] };
    },
  };
}

async function assertCanonicalConcurrency(run, expectedParam) {
  const client = captureClient();
  await run(client);
  assert.equal(client.calls.length, 1);
  const { query, params } = client.calls[0];
  assert.ok(query.includes(CANONICAL_VERSION_WRITE), 'updated_at write must stay millisecond-canonical');
  assert.ok(
    query.includes(`date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $${expectedParam}::timestamptz)`),
    'expectedUpdatedAt must be compared at the same precision exposed through JSON',
  );
  assert.equal(params.at(-1), expectedUpdatedAt);
}

test('Organization optimistic concurrency uses one canonical millisecond timestamp contract', async () => {
  await assertCanonicalConcurrency(
    (client) => updateWarehouse(client, {
      id: 'warehouse-1', installationId: 'installation-1', name: 'Kho A', warehouseType: 'main',
      allowNegativeStock: false, updatedBy: 'user-1', expectedUpdatedAt,
    }),
    7,
  );
  await assertCanonicalConcurrency(
    (client) => updateWarehouseActiveStatus(client, {
      id: 'warehouse-1', installationId: 'installation-1', isActive: false,
      updatedBy: 'user-1', expectedUpdatedAt,
    }),
    5,
  );
  await assertCanonicalConcurrency(
    (client) => updateWarehouseLocation(client, {
      id: 'location-1', installationId: 'installation-1', name: 'Khu A', locationType: 'storage',
      updatedBy: 'user-1', expectedUpdatedAt,
    }),
    6,
  );
  await assertCanonicalConcurrency(
    (client) => updateWarehouseLocationActiveStatus(client, {
      id: 'location-1', installationId: 'installation-1', isActive: false,
      updatedBy: 'user-1', expectedUpdatedAt,
    }),
    5,
  );
  await assertCanonicalConcurrency(
    (client) => updateBranch(client, {
      id: 'branch-1', installationId: 'installation-1', name: 'Chi nhánh A', address: '', phone: '', email: '',
      updatedBy: 'user-1', expectedUpdatedAt,
    }),
    8,
  );
  await assertCanonicalConcurrency(
    (client) => updateBranchActiveStatus(client, {
      id: 'branch-1', installationId: 'installation-1', isActive: false,
      updatedBy: 'user-1', expectedUpdatedAt,
    }),
    5,
  );
});
