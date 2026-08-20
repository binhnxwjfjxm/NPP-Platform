import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  directSalesCompletionInternals,
} from '../src/services/sales-manual-completion.js';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Lô 2 dùng một completion engine cho Giao thủ công và Giao tại quầy', () => {
  const service = source('../src/services/sales-manual-completion.js');
  const pickup = source('../src/services/sales-pickup-completion.js');
  assert.match(service, /key: 'MANUAL'/);
  assert.match(service, /key: 'PICKUP'/);
  assert.match(service, /sourceDocumentType: 'DIRECT_PICKUP_SALES_ORDER'/);
  assert.match(service, /documentType: 'SALE_PICKUP'/);
  assert.match(service, /paymentNamespace: 'pickup-sales-payment'/);
  assert.match(service, /deriveIdempotencyKey\(contract\.paymentNamespace, idempotencyKey\)/);
  assert.match(pickup, /mode: 'PICKUP'/);
  assert.match(service, /\['issued', 'fulfilled'\]/);
});

test('Giao tại quầy chỉ hoàn thành sau Xuất kho hoặc khi đơn không quản lý tồn đã fulfilled', () => {
  const contract = directSalesCompletionInternals.directCompletionMode('PICKUP');
  const context = { scopes: { warehouseIds: ['warehouse-1'] } };
  const base = {
    delivery_mode: 'PICKUP',
    delivery_execution_mode: null,
    warehouse_id: 'warehouse-1',
  };
  assert.equal(directSalesCompletionInternals.validateDirectIssued({ ...base, fulfillment_status: 'issued' }, context, contract).ok, true);
  assert.equal(directSalesCompletionInternals.validateDirectIssued({ ...base, fulfillment_status: 'fulfilled' }, context, contract).ok, true);
  assert.equal(directSalesCompletionInternals.validateDirectIssued({ ...base, fulfillment_status: 'reserved' }, context, contract).code, 'PICKUP_ORDER_NOT_ISSUED');
});

test('Giao tại quầy có endpoint và migration accounting riêng nhưng giữ contract Giao thủ công', () => {
  const route = source('../src/routes/manual-sales-orders.js');
  const migration = source('../../../database/migrations/accounting/100_direct_pickup_sales_order_receivable.sql');
  const migrations = source('../src/migrations/index.js');
  assert.match(route, /pickup-sales-orders/);
  assert.match(route, /\/api\/\$\{routeBase\}\/\$\{id\}\/\$\{action\}/);
  assert.match(route, /manual-sales-orders/);
  assert.match(migration, /DIRECT_PICKUP_SALES_ORDER/);
  assert.match(migration, /document_type = 'SALE_PICKUP'/);
  assert.match(migration, /MANUAL_SALES_ORDER', 'DIRECT_PICKUP_SALES_ORDER/);
  assert.match(migrations, /100_direct_pickup_sales_order_receivable/);
});

test('báo cáo lãi gộp nối cả movement line của direct sale, không bịa Delivery Order', () => {
  const finance = source('../src/routes/reporting-finance.js');
  assert.match(finance, /direct_sales_events/);
  assert.match(finance, /inventory\.inventory_movements movement/);
  assert.match(finance, /direct_line\.metadata ->> 'salesOrderLineId'/);
  assert.match(finance, /DIRECT_PICKUP_SALES_ORDER/);
  assert.match(finance, /abs\(movement_line\.base_quantity_delta\)/);
  assert.match(finance, /LEFT JOIN LATERAL/);
});
