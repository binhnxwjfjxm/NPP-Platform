import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  NEGATIVE_STOCK_PERMISSION,
  authorizeControlledNegativeStock,
  controlledNegativeStockEvidence,
  negativeStockScopeSupported,
  readControlledNegativeStockEvidence,
} from '../src/services/inventory-negative-stock-policy.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const WAREHOUSE_ID = '11111111-1111-4111-8111-111111111111';

function requestContext({ permission = false } = {}) {
  return {
    installationId: 'company-demo',
    permissions: permission ? [NEGATIVE_STOCK_PERMISSION] : [],
    scopes: { warehouseIds: [WAREHOUSE_ID] },
  };
}

function warehouseClient({ allowNegativeStock = false, active = true } = {}) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      return { rows: [{ allow_negative_stock: allowNegativeStock, is_active: active }] };
    },
  };
}

test('mặc định chặn: thiếu quyền hoặc kho chưa bật chính sách đều không được xuất vượt tồn', async () => {
  const noPermissionClient = warehouseClient({ allowNegativeStock: true });
  const noPermission = await authorizeControlledNegativeStock(noPermissionClient, {
    requestContext: requestContext({ permission: false }),
    warehouseId: WAREHOUSE_ID,
  });
  assert.equal(noPermission.ok, false);
  assert.equal(noPermission.code, 'NEGATIVE_STOCK_PERMISSION_DENIED');
  assert.equal(noPermissionClient.queries.length, 0);

  const policyOffClient = warehouseClient({ allowNegativeStock: false });
  const policyOff = await authorizeControlledNegativeStock(policyOffClient, {
    requestContext: requestContext({ permission: true }),
    warehouseId: WAREHOUSE_ID,
  });
  assert.equal(policyOff.ok, false);
  assert.equal(policyOff.code, 'NEGATIVE_STOCK_POLICY_DISABLED');
});

test('chỉ khi có quyền và kho bật chính sách mới sinh bằng chứng server-owned', async () => {
  const client = warehouseClient({ allowNegativeStock: true });
  const result = await authorizeControlledNegativeStock(client, {
    requestContext: requestContext({ permission: true }),
    warehouseId: WAREHOUSE_ID,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.evidence, controlledNegativeStockEvidence(WAREHOUSE_ID));
  assert.deepEqual(readControlledNegativeStockEvidence({
    warehouseId: WAREHOUSE_ID,
    metadata: { negativeStockAuthorization: result.evidence },
  }), result.evidence);
  assert.equal(readControlledNegativeStockEvidence({
    warehouseId: WAREHOUSE_ID,
    metadata: { negativeStockAuthorization: { ...result.evidence, decision: 'DENY' } },
  }), null);
});


test('quyền xuất vượt tồn chỉ đọc từ permissions chuẩn của request context', async () => {
  const client = warehouseClient({ allowNegativeStock: true });
  const result = await authorizeControlledNegativeStock(client, {
    requestContext: {
      installationId: 'company-demo',
      permissions: [],
      grantedPermissions: [NEGATIVE_STOCK_PERMISSION],
    },
    warehouseId: WAREHOUSE_ID,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'NEGATIVE_STOCK_PERMISSION_DENIED');
  assert.equal(client.queries.length, 0);
});

test('direct issue chỉ cho scope không bắt vị trí/lô/hạn dùng chính xác', () => {
  assert.equal(negativeStockScopeSupported({}), true);
  assert.equal(negativeStockScopeSupported({ locationRequired: true }), false);
  assert.equal(negativeStockScopeSupported({ lotTrackingMode: 'REQUIRED' }), false);
  assert.equal(negativeStockScopeSupported({ lotTrackingMode: 'OPTIONAL' }), false);
  assert.equal(negativeStockScopeSupported({ expiryTrackingMode: 'REQUIRED' }), false);
});

test('ledger dùng shared idempotency, replay trước policy và set trusted context theo từng dòng', async () => {
  const source = await read('src/services/sales-inventory-ledger.js');
  assert.match(source, /IDEMPOTENCY_KEY_PATTERN/);
  assert.doesNotMatch(source, /\[A-Za-z0-9\._:-\]/);
  assert.ok(source.indexOf('const replay = await replayOrMismatch') < source.indexOf('const negativeValidation = await validateNegativeStockLines'));
  assert.match(source, /npp\.inventory_negative_stock_context/);
  assert.match(source, /evidenceByLine\.get\(line\.lineNumber\)/);
  assert.match(source, /evidence \? negativeStockContext[\s\S]*: ''/);
});

test('direct issue giữ reservation thật và chỉ tách phần thiếu thành dòng OUT có evidence', async () => {
  const source = await read('src/services/sales-direct-stock-issue.js');
  assert.match(source, /reserved \+ backordered !== ordered/);
  assert.match(source, /negative_issued_base_quantity = backordered_base_quantity/);
  assert.match(source, /negative_stock_issue_service/);
  assert.match(source, /negativeStockQuantity: formatQuantity\(negativeQuantity\)/);
  assert.match(source, /negativeStockAuthorization: evidence/);
  assert.match(source, /postServerOwnedSalesMovement/);
  assert.doesNotMatch(source, /UPDATE\s+inventory\.inventory_balances/i);
});

test('DB backstop cần cả line evidence + trusted context + warehouse policy, reversal giảm projection theo lineage', async () => {
  const migration = await read('../../database/migrations/inventory/116_controlled_negative_stock.sql');
  assert.match(migration, /allow_negative_stock boolean NOT NULL DEFAULT false/);
  assert.match(migration, /NEW\.metadata->'negativeStockAuthorization'/);
  assert.match(migration, /npp\.inventory_negative_stock_context/);
  assert.match(migration, /movement_type IS DISTINCT FROM 'SALES_DELIVERY_ISSUE'/);
  assert.match(migration, /reversal_of_movement_id/);
  assert.match(migration, /reversedFromLineId/);
  assert.match(migration, /negative_stock_issue_service/);
  assert.match(migration, /sales_negative_stock_issue_projection_invalid/);
  assert.match(migration, /negative_stock_reversal_projector/);
  assert.match(migration, /negative_issued_base_quantity = greatest\(demand\.negative_issued_base_quantity - negative_quantity, 0\)/);
});

test('tồn âm vẫn hiển thị từ read model/báo cáo chuẩn, không clamp thành 0', async () => {
  const [balanceRepo, reporting] = await Promise.all([
    read('src/db/repositories/inventory-balance.js'),
    read('src/routes/reporting-inventory.js'),
  ]);
  assert.match(balanceRepo, /balance\.on_hand_quantity/);
  assert.match(reporting, /stock\.on_hand_quantity::text/);
  assert.match(reporting, /WHERE stock\.on_hand_quantity <> 0 OR stock\.reserved_quantity <> 0/);
  assert.doesNotMatch(reporting, /greatest\(stock\.on_hand_quantity,\s*0\)/i);
});

test('permission registry nhận quyền xuất vượt tồn khả dụng bằng ngôn ngữ nghiệp vụ', async () => {
  const source = await read('src/access/permissions.js');
  assert.match(source, /coreInventoryNegativeStockIssue: 'core\.inventory\.negative-stock\.issue'/);
  assert.match(source, /label: 'Xuất vượt tồn khả dụng'/);
  assert.match(source, /NEGATIVE_STOCK_PERMISSION_CATALOG/);
});

test('warehouse repository/service đưa policy vào read + update và giữ mặc định tắt khi tạo mới', async () => {
  const [repository, service] = await Promise.all([
    read('src/db/repositories/warehouse.js'),
    read('src/services/warehouse.js'),
  ]);
  assert.match(repository, /allow_negative_stock/);
  assert.match(repository, /allow_negative_stock = \$3/);
  assert.match(service, /allowNegativeStock/);
  assert.match(service, /INVALID_NEGATIVE_STOCK_POLICY/);
  assert.match(service, /existing\.allow_negative_stock === true/);
});
