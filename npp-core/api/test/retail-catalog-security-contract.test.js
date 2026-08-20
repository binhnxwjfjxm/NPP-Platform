import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  getRetailOrderAvailability,
  retailCatalogInternals,
} from '../src/services/retail-catalog.js';
import * as salesOrderRepository from '../src/db/repositories/sales-order.js';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Retail catalog tái sử dụng SKU search chuẩn nhưng không trả dữ liệu tồn', () => {
  const service = source('../src/services/retail-catalog.js');
  const productResponse = service.slice(
    service.indexOf('products: Object.freeze'),
    service.indexOf('export async function getRetailOrderAvailability'),
  );
  assert.match(service, /salesOrderEntryService\.searchSalesOrderSkuOptions/);
  assert.match(productResponse, /productCode/);
  assert.match(productResponse, /unitCode/);
  assert.doesNotMatch(productResponse, /availableQuantity|inventory|onHand|held|baseQuantity/i);
});

test('Retail product search có lọc nhóm và ưu tiên SKU chính xác/prefix', () => {
  const repository = source('../src/db/repositories/sales-order.js');
  assert.match(repository, /categoryId = null/);
  assert.match(repository, /p\.category_id = \$4::uuid/);
  assert.match(repository, /retailSearch = false/);
  assert.match(repository, /\$5::boolean AND upper\(pv\.sku\) LIKE \$2 \|\| '%'/);
  assert.match(repository, /WHEN upper\(pv\.sku\) = \$2 THEN 0/);
  assert.match(repository, /WHEN \$5::boolean AND upper\(pv\.sku\) LIKE \$2 \|\| '%' THEN 3/);
});

test('Tìm SKU cũ giữ nguyên thứ tự, chỉ Retail mới bật thứ tự prefix', async () => {
  const calls = [];
  const client = {
    async query(statement, params) {
      calls.push({ statement, params });
      return { rows: [] };
    },
  };
  await salesOrderRepository.searchSalesOrderSkuOptions(client, {
    installationId: '66666666-6666-4666-8666-666666666666',
    search: 'SKU',
  });
  await salesOrderRepository.searchSalesOrderSkuOptions(client, {
    installationId: '66666666-6666-4666-8666-666666666666',
    search: 'SKU',
    retailSearch: true,
  });
  assert.equal(calls[0].params[4], false);
  assert.equal(calls[1].params[4], true);
  assert.match(calls[0].statement, /ELSE 3/);
});

test('Khả dụng Retail chỉ được tính theo đúng đơn, scope kho và đơn vị bán', () => {
  const service = source('../src/services/retail-catalog.js');
  const route = source('../src/routes/retail-catalog.js');
  assert.match(service, /WHERE orders\.installation_id = \$1\s+AND orders\.id = \$2::uuid/);
  assert.match(service, /warehouseAllowed\(requestContext, lines\[0\]\.warehouse_id\)/);
  assert.match(service, /loadDemandHoldAvailability/);
  assert.match(service, /excludingSalesOrderId: salesOrderId/);
  assert.match(service, /convertBaseToSalesQuantity/);
  assert.match(route, /url\.pathname\.match\(\/\^\\\/api\\\/retail\\\/sales-orders/);
  assert.match(route, /coreSalesOrderRead/);
  assert.doesNotMatch(service, /listInventory|inventory_balances.*products/i);
});

test('quy đổi Khả dụng luôn làm tròn xuống để không báo thừa hàng', () => {
  assert.equal(retailCatalogInternals.convertBaseToSalesQuantity('5.000000000000', '2.000000000000'), '2.5');
  assert.equal(retailCatalogInternals.convertBaseToSalesQuantity('5.000000000000', '3.000000000000'), '1.666666666666');
  assert.equal(retailCatalogInternals.convertBaseToSalesQuantity('bad', '1.000000000000'), null);
});

test('Khả dụng chỉ trả một cột nghiệp vụ của các dòng thuộc đúng đơn', async () => {
  const queries = [];
  const client = {
    async query(statement, params) {
      queries.push({ statement, params });
      if (statement.includes('FROM sales.sales_orders orders')) {
        return {
          rows: [{
            sales_order_id: '11111111-1111-4111-8111-111111111111',
            sales_order_status: 'draft',
            warehouse_id: '22222222-2222-4222-8222-222222222222',
            sales_order_line_id: '33333333-3333-4333-8333-333333333333',
            line_number: 1,
            variant_id: '44444444-4444-4444-8444-444444444444',
            sku_snapshot: 'SKU-01',
            item_name_snapshot: 'Sản phẩm kiểm tra',
            unit_code_snapshot: 'HOP',
            conversion_to_base: '2.000000000000',
            is_inventory_managed: true,
            fulfillment_demand_id: null,
            base_variant_ids: ['55555555-5555-4555-8555-555555555555'],
          }],
        };
      }
      if (statement.includes('AS available_quantity')) {
        return { rows: [{ available_quantity: '5.000000000000' }] };
      }
      throw new Error('Truy vấn ngoài phạm vi kiểm thử');
    },
  };
  const result = await getRetailOrderAvailability(client, {
    requestContext: {
      installationId: '66666666-6666-4666-8666-666666666666',
      scopes: { warehouseIds: ['22222222-2222-4222-8222-222222222222'] },
    },
    salesOrderId: '11111111-1111-4111-8111-111111111111',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.availability, [{
    salesOrderLineId: '33333333-3333-4333-8333-333333333333',
    lineNumber: 1,
    variantId: '44444444-4444-4444-8444-444444444444',
    sku: 'SKU-01',
    itemName: 'Sản phẩm kiểm tra',
    unitCode: 'HOP',
    availabilityStatus: 'AVAILABLE',
    availableQuantity: '2.5',
  }]);
  assert.equal(queries.length, 2);
  assert.match(queries[1].statement, /demand\.sales_order_id <> \$4/);
});

test('Khả dụng chặn scope kho trước khi truy vấn tồn', async () => {
  const queries = [];
  const client = {
    async query(statement) {
      queries.push(statement);
      return {
        rows: [{
          sales_order_status: 'draft',
          warehouse_id: '22222222-2222-4222-8222-222222222222',
        }],
      };
    },
  };
  const result = await getRetailOrderAvailability(client, {
    requestContext: {
      installationId: '66666666-6666-4666-8666-666666666666',
      scopes: { warehouseIds: ['77777777-7777-4777-8777-777777777777'] },
    },
    salesOrderId: '11111111-1111-4111-8111-111111111111',
  });
  assert.deepEqual(result, {
    ok: false,
    code: 'WAREHOUSE_SCOPE_DENIED',
    message: 'Đơn nằm ngoài phạm vi kho được cấp quyền',
    retryable: false,
    details: {},
  });
  assert.equal(queries.length, 1);
});
