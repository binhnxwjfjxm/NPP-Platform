import test from 'node:test';
import assert from 'node:assert/strict';
import * as branchService from '../src/services/branch.js';
import * as warehouseService from '../src/services/warehouse.js';
import * as locationService from '../src/services/location.js';

const installationId = 'test-installation';
const actorId = 'actor:test';
const branchId = '11111111-1111-4111-8111-111111111111';
const warehouseId = '22222222-2222-4222-8222-222222222222';
const locationId = '33333333-3333-4333-8333-333333333333';
const updatedAt = '2026-07-25T16:00:00.000Z';

function row(overrides = {}) {
  return {
    id: branchId,
    installation_id: installationId,
    code: 'CODE',
    name: 'Name',
    is_active: true,
    created_at: updatedAt,
    updated_at: updatedAt,
    created_by: actorId,
    updated_by: actorId,
    ...overrides,
  };
}

test('malformed organization IDs are rejected before querying PostgreSQL', async () => {
  const client = {
    async query() {
      throw new Error('database must not be called for malformed IDs');
    },
  };

  assert.equal((await branchService.getBranch(client, { installationId, id: 'not-a-uuid' })).code, 'NOT_FOUND');
  assert.equal((await warehouseService.getWarehouse(client, { installationId, id: 'not-a-uuid' })).code, 'NOT_FOUND');
  assert.equal((await locationService.getWarehouseLocation(client, { installationId, id: 'not-a-uuid' })).code, 'NOT_FOUND');
});

test('warehouse creation locks its branch against concurrent deactivation', async () => {
  const queries = [];
  const client = {
    async query(text) {
      queries.push(text);
      if (text.includes('FROM shared.branches')) {
        assert.match(text, /FOR SHARE/);
        return { rows: [row()] };
      }
      if (text.includes('FROM shared.warehouses') && text.includes('code = $2')) return { rows: [] };
      if (text.includes('INSERT INTO shared.warehouses')) {
        return { rows: [row({ id: warehouseId, branch_id: branchId, warehouse_type: 'main' })] };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const result = await warehouseService.createWarehouse(client, {
    installationId,
    payload: { branchId, code: 'WH-LOCK', name: 'Locked warehouse', warehouseType: 'main' },
    createdBy: actorId,
  });

  assert.equal(result.ok, true);
  assert.ok(queries.some((query) => /FROM shared\.branches[\s\S]*FOR SHARE/.test(query)));
});

test('branch deactivation locks the branch before checking active warehouses', async () => {
  const queries = [];
  const client = {
    async query(text) {
      queries.push(text);
      if (text.includes('FROM shared.branches') && text.includes('FOR UPDATE')) return { rows: [row()] };
      if (text.includes('COUNT(*)') && text.includes('shared.warehouses')) return { rows: [{ count: '0' }] };
      if (text.includes('UPDATE shared.branches')) return { rows: [row({ is_active: false })] };
      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const result = await branchService.updateBranchStatus(client, {
    id: branchId,
    installationId,
    isActive: false,
    updatedBy: actorId,
    expectedUpdatedAt: updatedAt,
  });

  assert.equal(result.ok, true);
  assert.match(queries[0], /FOR UPDATE/);
});

test('location creation locks its warehouse against concurrent deactivation', async () => {
  const queries = [];
  const client = {
    async query(text) {
      queries.push(text);
      if (text.includes('FROM shared.warehouses')) {
        assert.match(text, /FOR SHARE/);
        return { rows: [row({ id: warehouseId, branch_id: branchId, warehouse_type: 'main' })] };
      }
      if (text.includes('FROM shared.warehouse_locations') && text.includes('code = $2')) return { rows: [] };
      if (text.includes('INSERT INTO shared.warehouse_locations')) {
        return { rows: [row({ id: locationId, warehouse_id: warehouseId, location_type: 'storage' })] };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const result = await locationService.createWarehouseLocation(client, {
    installationId,
    payload: { warehouseId, code: 'LOC-LOCK', name: 'Locked location', locationType: 'storage' },
    createdBy: actorId,
  });

  assert.equal(result.ok, true);
  assert.ok(queries.some((query) => /FROM shared\.warehouses[\s\S]*FOR SHARE/.test(query)));
});

test('warehouse reactivation is denied while its branch is inactive', async () => {
  const client = {
    async query(text) {
      if (text.includes('FROM shared.warehouses') && text.includes('FOR UPDATE')) {
        return { rows: [row({ id: warehouseId, branch_id: branchId, warehouse_type: 'main', is_active: false })] };
      }
      if (text.includes('FROM shared.branches') && text.includes('FOR SHARE')) {
        return { rows: [row({ is_active: false })] };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const result = await warehouseService.updateWarehouseStatus(client, {
    id: warehouseId,
    installationId,
    isActive: true,
    updatedBy: actorId,
    expectedUpdatedAt: updatedAt,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'BRANCH_INACTIVE');
});

test('location reactivation is denied while its warehouse is inactive', async () => {
  const client = {
    async query(text) {
      if (text.includes('FROM shared.warehouse_locations')) {
        return { rows: [row({ id: locationId, warehouse_id: warehouseId, location_type: 'storage', is_active: false })] };
      }
      if (text.includes('FROM shared.warehouses') && text.includes('FOR SHARE')) {
        return { rows: [row({ id: warehouseId, branch_id: branchId, warehouse_type: 'main', is_active: false })] };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };

  const result = await locationService.updateWarehouseLocationStatus(client, {
    id: locationId,
    installationId,
    isActive: true,
    updatedBy: actorId,
    expectedUpdatedAt: updatedAt,
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'WAREHOUSE_INACTIVE');
});
