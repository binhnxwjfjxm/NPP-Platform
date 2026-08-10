import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  MOVEMENT_FILE_COLUMNS,
  PRICING_FILE_COLUMNS,
  PRODUCT_FILE_COLUMNS,
  STOCKTAKE_FILE_COLUMNS,
} from '../src/services/file-operations.js';

const serviceSource = await readFile(new URL('../src/services/file-operations.js', import.meta.url), 'utf8');
const routeSource = await readFile(new URL('../src/routes/file-operations.js', import.meta.url), 'utf8');
const wrapperSource = await readFile(new URL('../src/routes/product-units.js', import.meta.url), 'utf8');

test('Phase 10.4 exposes stable flat-file column contracts', () => {
  assert.deepEqual(PRODUCT_FILE_COLUMNS.slice(0, 3), ['productCode', 'productName', 'catalogName']);
  assert.ok(PRODUCT_FILE_COLUMNS.includes('sku'));
  assert.ok(PRICING_FILE_COLUMNS.includes('priceListCode'));
  assert.ok(PRICING_FILE_COLUMNS.includes('sourceKey'));
  assert.deepEqual(STOCKTAKE_FILE_COLUMNS, [
    'warehouseCode', 'locationCode', 'sku', 'lotCode', 'systemQuantity', 'actualCount',
  ]);
  assert.ok(MOVEMENT_FILE_COLUMNS.includes('quantityDelta'));
  assert.ok(MOVEMENT_FILE_COLUMNS.includes('sourceDocumentId'));
});

test('product and pricing file imports reuse canonical import services', () => {
  assert.match(serviceSource, /productService\.importProducts\(/);
  assert.match(serviceSource, /pricingService\.importPricing\(/);
  assert.match(serviceSource, /pricingService\.resolvePrice\(/);
});

test('stocktake file import stops at create and count', () => {
  assert.match(serviceSource, /stocktakeService\.createStocktake\(/);
  assert.match(serviceSource, /stocktakeService\.countStocktake\(/);
  assert.doesNotMatch(serviceSource, /stocktakeService\.(?:submitStocktake|approveStocktake|postStocktake)\(/);
  assert.doesNotMatch(serviceSource, /UPDATE\s+inventory\.inventory_balances/i);
  assert.doesNotMatch(serviceSource, /INSERT\s+INTO\s+inventory\.inventory_balances/i);
});

test('official operations write canonical import export history', () => {
  assert.match(serviceSource, /INSERT INTO reporting\.import_export_jobs/);
  assert.match(serviceSource, /definitionKey: 'products'/);
  assert.match(serviceSource, /definitionKey: 'pricing-items'/);
  assert.match(serviceSource, /definitionKey: 'stocktake-count'/);
  assert.match(serviceSource, /definitionKey: 'inventory-movements'/);
  assert.match(serviceSource, /definitionKey: 'sales-quotation'/);
});

test('file operation routes are deny-by-default and idempotent for official operations', () => {
  assert.match(routeSource, /requiredPermissions/);
  assert.match(routeSource, /normalizeIdempotencyKey/);
  assert.match(routeSource, /executeRequestWithIdempotency/);
  assert.match(routeSource, /\/api\/file-operations\/products\/import/);
  assert.match(routeSource, /\/api\/file-operations\/stocktake\/import/);
  assert.match(routeSource, /\/api\/file-operations\/quotation/);
  assert.match(wrapperSource, /handleFileOperationRoutes/);
});
