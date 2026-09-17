import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeSalesReportingExportSelection,
  salesReportingExportInternals,
} from '../src/services/reporting-sales-export.js';

const readApi = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function selection(quantityDisplay) {
  return normalizeSalesReportingExportSelection({
    dimension: 'analysis.products.customerGroups.both',
    format: 'xlsx',
    columns: [],
    quantityDisplay,
  });
}

function facts() {
  return [
    {
      currencyCode: 'VND', productId: 'p1', productCode: 'SP1', productName: 'Trà A', variantId: 'v-carton',
      unitId: 'u-carton', unitCode: 'THUNG', unitName: 'Thùng', orderedQuantity: '2', conversionToBase: '24', baseQuantity: '48',
      baseUnitId: 'u-bottle', baseUnitCode: 'CHAI', baseUnitName: 'Chai',
      cartonUnitId: 'u-carton', cartonUnitCode: 'THUNG', cartonUnitName: 'Thùng', cartonConversionToBase: '24',
      customerGroupId: 'g1', customerGroupCode: 'DL', customerGroupName: 'Đại lý', revenue: '100',
    },
    {
      currencyCode: 'VND', productId: 'p1', productCode: 'SP1', productName: 'Trà A', variantId: 'v-bottle',
      unitId: 'u-bottle', unitCode: 'CHAI', unitName: 'Chai', orderedQuantity: '6', conversionToBase: '1', baseQuantity: '6',
      baseUnitId: 'u-bottle', baseUnitCode: 'CHAI', baseUnitName: 'Chai',
      cartonUnitId: 'u-carton', cartonUnitCode: 'THUNG', cartonUnitName: 'Thùng', cartonConversionToBase: '24',
      customerGroupId: 'g2', customerGroupCode: 'QUAN', customerGroupName: 'Quán', revenue: '50',
    },
  ];
}

function quantityText(sheet) {
  const bucket = [...sheet.rows[0].totals.quantityByUnit.values()][0];
  return sheet.decimalText(bucket.value);
}

test('Phân tích sản phẩm dùng product_id làm identity và cộng doanh thu mọi SKU của cùng sản phẩm', () => {
  const normalized = selection('base');
  assert.equal(normalized.ok, true);
  assert.equal(normalized.quantityDisplay, 'base');

  const sheet = salesReportingExportInternals.buildAnalysisSheet(facts(), normalized, { from: '2026-09-01', to: '2026-09-17' });
  assert.equal(sheet.rows.length, 1);
  assert.equal(sheet.rows[0].code, 'SP1');
  assert.equal(sheet.rows[0].name, 'Trà A');
  assert.equal(sheet.rows[0].unitName, 'Chai');
  assert.equal(quantityText(sheet), '54');
  assert.equal(sheet.decimalText(sheet.rows[0].totals.revenueByCurrency.get('VND')), '150');
});

test('Ưu tiên Thùng quy 2 Thùng + 6 Chai thành 2.25 Thùng bằng base_quantity snapshot', () => {
  const rows = facts();
  rows[0].conversionToBase = '30';
  const normalized = selection('carton');
  const sheet = salesReportingExportInternals.buildAnalysisSheet(rows, normalized, { from: '2026-09-01', to: '2026-09-17' });

  assert.equal(sheet.rows.length, 1);
  assert.equal(sheet.rows[0].unitName, 'Thùng');
  assert.equal(quantityText(sheet), '2.25');
});

test('Ưu tiên Thùng không làm mất sản phẩm không có SKU Thùng', () => {
  const row = {
    ...facts()[1],
    productId: 'p2', productCode: 'SP2', productName: 'Xốt A',
    unitId: 'u-pack', unitCode: 'BICH', unitName: 'Bịch', orderedQuantity: '5', baseQuantity: '5',
    baseUnitId: 'u-pack', baseUnitCode: 'BICH', baseUnitName: 'Bịch',
    cartonUnitId: null, cartonUnitCode: null, cartonUnitName: null, cartonConversionToBase: null,
  };
  const normalized = selection('carton');
  const sheet = salesReportingExportInternals.buildAnalysisSheet([row], normalized, { from: '2026-09-01', to: '2026-09-17' });

  assert.equal(sheet.rows.length, 1);
  assert.equal(sheet.rows[0].name, 'Xốt A');
  assert.equal(sheet.rows[0].unitName, 'Bịch');
  assert.equal(quantityText(sheet), '5');
});

test('Theo ĐVT bán giữ nhiều ĐVT trong cùng dòng sản phẩm và không tạo tổng sản lượng giả', () => {
  const normalized = selection('sold');
  const sheet = salesReportingExportInternals.buildAnalysisSheet(facts(), normalized, { from: '2026-09-01', to: '2026-09-17' });

  assert.equal(sheet.rows.length, 1);
  assert.equal(sheet.rows[0].totals.quantityByUnit.size, 2);
  assert.match(sheet.rows[0].unitName, /Chai/);
  assert.match(sheet.rows[0].unitName, /Thùng/);
  assert.equal(sheet.quantityGrandValid, false);
});

test('Cách hiển thị sản lượng được validate rõ và doanh thu không phụ thuộc lựa chọn này', () => {
  const invalid = selection('khong-hop-le');
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, 'INVALID_SALES_ANALYSIS_QUANTITY_DISPLAY');

  const revenueOnly = normalizeSalesReportingExportSelection({
    dimension: 'analysis.products.customerGroups.revenue',
    format: 'xlsx',
    columns: [],
    quantityDisplay: 'carton',
  });
  assert.equal(revenueOnly.ok, true);
  assert.equal(revenueOnly.quantityDisplay, 'sold');
});

test('Nguồn phân tích lấy Product cha, snapshot lượng lịch sử và Loại sản phẩm hiện tại', async () => {
  const source = await readApi('src/services/reporting-sales-export.js');
  const route = await readApi('src/routes/reporting-sales-purchasing.js');

  assert.match(source, /product\.id AS "productId"/);
  assert.match(source, /product\.code AS "productCode"/);
  assert.match(source, /line\.base_quantity::text AS "baseQuantity"/);
  assert.match(source, /line\.conversion_to_base::text AS "conversionToBase"/);
  assert.match(source, /pv\.is_inventory_base = true/);
  assert.match(source, /pv\.variant_kind = 'CARTON'/);
  assert.doesNotMatch(source, /line\.variant_id AS "productId"/);
  assert.match(source, /product\.category_id AS "productGroupId"/);
  assert.match(source, /product_category\.code AS "productGroupCode"/);
  assert.match(source, /product_category\.name AS "productGroupName"/);
  assert.match(source, /\(\$6::uuid IS NULL OR product\.category_id = \$6::uuid\)/);
  assert.doesNotMatch(source, /CASE WHEN line\.reporting_dimension_snapshot_captured THEN line\.product_category_id_snapshot ELSE product\.category_id END AS "productGroupId"/);
  assert.match(route, /quantityDisplay: url\.searchParams\.get\('quantityDisplay'\)/);
});

test('Excel phân tích có một sheet và header hai tầng khi chọn cả Doanh thu + Sản lượng', async () => {
  const source = await readApi('src/services/reporting-sales-export.js');
  assert.match(source, /sheet\.metrics\.length === 2/);
  assert.match(source, /groupLabel/);
  assert.match(source, /metricLabel/);
  assert.match(source, /mergeCells count=/);
  assert.match(source, /A2:A3/);
  assert.match(source, /sheet1\.xml/);
  assert.doesNotMatch(source, /sheet2\.xml/);
});
