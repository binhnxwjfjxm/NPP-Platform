import test from 'node:test';
import assert from 'node:assert/strict';

import {
  loadInstallationOwnerScopes,
  validateUserScopeIds,
} from '../src/db/repositories/internal-workforce-auth.js';
import { listPurchaseOrders } from '../src/db/repositories/purchase-order.js';
import { listGoodsReceipts } from '../src/db/repositories/goods-receipt.js';

const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ACTIVE = '22222222-2222-4222-8222-222222222222';
const BRANCH_INACTIVE = '33333333-3333-4333-8333-333333333333';
const WAREHOUSE_ACTIVE = '44444444-4444-4444-8444-444444444444';
const WAREHOUSE_INACTIVE = '55555555-5555-4555-8555-555555555555';

function documentRowsForScope(sql, params, prefix) {
  if (sql.includes('AND false')) return [];
  const warehouseIds = Array.isArray(params[1]) ? params[1] : [];
  return warehouseIds.map((warehouseId) => ({ id: `${prefix}-${warehouseId}`, warehouse_id: warehouseId }));
}

test('installation Security Owner scope includes active and inactive branches/warehouses', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM shared.branches')) {
        return { rows: [{ id: BRANCH_ACTIVE }, { id: BRANCH_INACTIVE }] };
      }
      if (sql.includes('FROM shared.warehouses')) {
        return { rows: [{ id: WAREHOUSE_ACTIVE }, { id: WAREHOUSE_INACTIVE }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const scopes = await loadInstallationOwnerScopes(client, { installationId: INSTALLATION_ID });

  assert.deepEqual(scopes.branchIds, [BRANCH_ACTIVE, BRANCH_INACTIVE]);
  assert.deepEqual(scopes.warehouseIds, [WAREHOUSE_ACTIVE, WAREHOUSE_INACTIVE]);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.match(call.sql, /WHERE installation_id = \$1/);
    assert.doesNotMatch(call.sql, /is_active\s*=\s*true/i);
    assert.deepEqual(call.params, [INSTALLATION_ID]);
  }
});

test('inactive branch/warehouse IDs remain valid authorization scopes for historical documents', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM shared.branches')) return { rows: [{ id: BRANCH_INACTIVE }] };
      if (sql.includes('FROM shared.warehouses')) return { rows: [{ id: WAREHOUSE_INACTIVE }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const validation = await validateUserScopeIds(client, {
    installationId: INSTALLATION_ID,
    scopes: {
      branchIds: [BRANCH_INACTIVE],
      warehouseIds: [WAREHOUSE_INACTIVE],
      territoryIds: [],
    },
  });

  assert.deepEqual(validation, { missingBranchIds: [], missingWarehouseIds: [] });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.doesNotMatch(call.sql, /is_active\s*=\s*true/i);
    assert.equal(call.params[0], INSTALLATION_ID);
  }
});

test('PO/GR lists keep deny-by-default zero scope and restrict scoped users to assigned warehouses', async () => {
  const purchaseCalls = [];
  const receiptCalls = [];
  const purchaseClient = {
    async query(sql, params) {
      purchaseCalls.push({ sql, params });
      return { rows: documentRowsForScope(sql, params, 'po') };
    },
  };
  const receiptClient = {
    async query(sql, params) {
      receiptCalls.push({ sql, params });
      return { rows: documentRowsForScope(sql, params, 'gr') };
    },
  };

  const scopedPurchaseOrders = await listPurchaseOrders(purchaseClient, {
    installationId: INSTALLATION_ID,
    warehouseIds: [WAREHOUSE_ACTIVE],
    limit: 1000,
    offset: 0,
  });
  const scopedReceipts = await listGoodsReceipts(receiptClient, {
    installationId: INSTALLATION_ID,
    warehouseIds: [WAREHOUSE_ACTIVE],
    limit: 1000,
    offset: 0,
  });

  assert.deepEqual(scopedPurchaseOrders.map((row) => row.warehouse_id), [WAREHOUSE_ACTIVE]);
  assert.deepEqual(scopedReceipts.map((row) => row.warehouse_id), [WAREHOUSE_ACTIVE]);
  assert.deepEqual(purchaseCalls[0].params[1], [WAREHOUSE_ACTIVE]);
  assert.deepEqual(receiptCalls[0].params[1], [WAREHOUSE_ACTIVE]);
  assert.match(purchaseCalls[0].sql, /po\.warehouse_id = ANY\(\$2::uuid\[\]\)/);
  assert.match(receiptCalls[0].sql, /gr\.warehouse_id = ANY\(\$2::uuid\[\]\)/);

  const zeroPurchaseOrders = await listPurchaseOrders(purchaseClient, {
    installationId: INSTALLATION_ID,
    warehouseIds: [],
    limit: 1000,
    offset: 0,
  });
  const zeroReceipts = await listGoodsReceipts(receiptClient, {
    installationId: INSTALLATION_ID,
    warehouseIds: [],
    limit: 1000,
    offset: 0,
  });

  assert.deepEqual(zeroPurchaseOrders, []);
  assert.deepEqual(zeroReceipts, []);
  assert.match(purchaseCalls[1].sql, /AND false/);
  assert.match(receiptCalls[1].sql, /AND false/);
});

test('full-installation scope makes PO/GR history across active and inactive warehouses visible', async () => {
  const warehouseIds = [WAREHOUSE_ACTIVE, WAREHOUSE_INACTIVE];
  const purchaseClient = {
    async query(sql, params) {
      return { rows: documentRowsForScope(sql, params, 'po') };
    },
  };
  const receiptClient = {
    async query(sql, params) {
      return { rows: documentRowsForScope(sql, params, 'gr') };
    },
  };

  const purchaseOrders = await listPurchaseOrders(purchaseClient, {
    installationId: INSTALLATION_ID,
    warehouseIds,
    limit: 1000,
    offset: 0,
  });
  const receipts = await listGoodsReceipts(receiptClient, {
    installationId: INSTALLATION_ID,
    warehouseIds,
    limit: 1000,
    offset: 0,
  });

  assert.deepEqual(purchaseOrders.map((row) => row.warehouse_id), warehouseIds);
  assert.deepEqual(receipts.map((row) => row.warehouse_id), warehouseIds);
});
