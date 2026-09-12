import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const fileRoute = source('../src/routes/file-operations.js');
const stocktakeExchange = source('../src/services/file-operations-warehouse-location.js');
const productExchange = source('../src/services/product-onboarding-warehouse-location.js');
const policyPage = source('../../web/app/inventory/tracking-policies/page.tsx');
const policyWorkspace = source('../../web/app/inventory/tracking-policies/tracking-policy-workspace.tsx');
const dataExchangeModel = source('../../web/app/operations/data-exchange/data-exchange-model.ts');
const warehouseWorkspace = source('../../web/app/organization/warehouses/warehouse-workspace.tsx');
const warehouseTabs = source('../../web/app/organization/warehouses/warehouse-tabs.tsx');
const historyPage = source('../../web/app/organization/warehouses/location-mode-history/page.tsx');
const historyGateway = source('../../web/lib/warehouse-location-mode-history-gateway.ts');

test('Lô 3 removes SKU location authority from operator UI and product files', () => {
  assert.match(policyPage, /TrackingPolicyWorkspace/);
  assert.doesNotMatch(policyWorkspace, /locationRequired|Bắt buộc vị trí/);
  assert.match(policyWorkspace, /Quản lý vị trí được thiết lập tại Kho hàng/);
  assert.doesNotMatch(dataExchangeModel.match(/PRODUCT_COLUMNS = \[[\s\S]*?\] as const/)?.[0] ?? '', /locationRequired/);
  assert.match(productExchange, /filter\(\(column\) => column !== 'locationRequired'\)/);
  assert.match(productExchange, /locationRequired: false/);
  assert.match(fileRoute, /product-onboarding-warehouse-location\.js/);
});

test('Lô 3 stocktake Data Exchange follows warehouse mode and never auto-fills location', () => {
  assert.match(fileRoute, /file-operations-warehouse-location\.js/);
  assert.match(stocktakeExchange, /location_management_mode/);
  assert.match(stocktakeExchange, /warehouse\.location_management_mode === 'MANAGED'/);
  assert.match(stocktakeExchange, /LOCATION_REQUIRED/);
  assert.match(stocktakeExchange, /LOCATION_NOT_ALLOWED/);
  assert.match(stocktakeExchange, /location_type = 'storage'/);
  assert.doesNotMatch(stocktakeExchange, /locationAutoFilled|locations\[0\]/);
});

test('Lô 3 exposes warehouse location-mode history from the Warehouse screen', () => {
  assert.match(warehouseWorkspace, /WarehouseTabs active=\{initialTab\}/);
  assert.match(warehouseTabs, /label: 'Lịch sử'/);
  assert.match(warehouseTabs, /\/organization\/warehouses\/location-mode-history/);
  assert.match(historyGateway, /location-mode\/runs/);
  assert.match(historyGateway, /location-mode-runs/);
  assert.match(historyPage, /Chuyển sang tồn chung/);
  assert.match(historyPage, /Bắt đầu quản lý vị trí/);
  assert.match(historyPage, /Tồn chung/);
  assert.match(historyPage, /Không lô/);
  assert.match(historyPage, /completedBy/);
});