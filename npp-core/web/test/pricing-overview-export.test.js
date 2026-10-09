import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createTabularWorkbookXlsx } from '../lib/tabular-workbook-xlsx.js';
import { parseTabularXlsx, TABULAR_XLSX_LIMITS } from '../lib/tabular-xlsx.js';

const root = path.resolve(process.cwd());
function read(relativePath) { return fs.readFileSync(path.join(root, relativePath), 'utf8'); }

test('pricing workbook keeps summary and detailed conditions in separate sheets', () => {
  const workbook = createTabularWorkbookXlsx([
    {
      sheetName: 'Bảng giá tổng hợp',
      headers: ['Mã SP', 'Tên SP', 'SKU', 'Quy cách', 'ĐVT', 'Giá nền', 'SỈ · Giá sỉ'],
      rows: [['SP01', 'Trà đào', 'SP01-THUNG', 'Thùng 24 chai', 'Thùng', '120.000 ₫', 'Nhiều mức giá']],
    },
    {
      sheetName: 'Điều kiện áp dụng',
      headers: ['Mã bảng giá', 'Tên bảng giá', 'SKU', 'Cách áp dụng', 'Giá trị', 'SL từ', 'SL đến'],
      rows: [['SỈ', 'Giá sỉ', 'SP01-THUNG', 'Giảm phần trăm', '5%', '10', '49']],
    },
  ]);
  const limits = { ...TABULAR_XLSX_LIMITS, maxRows: 12001, maxColumns: 200 };
  const summary = parseTabularXlsx(workbook, limits, ['Mã SP', 'Giá nền']);
  const details = parseTabularXlsx(workbook, limits, ['Mã bảng giá', 'Cách áp dụng']);
  assert.deepEqual(summary[0], ['Mã SP', 'Tên SP', 'SKU', 'Quy cách', 'ĐVT', 'Giá nền', 'SỈ · Giá sỉ']);
  assert.equal(summary[1][6], 'Nhiều mức giá');
  assert.deepEqual(details[0].slice(0, 3), ['Mã bảng giá', 'Tên bảng giá', 'SKU']);
  assert.equal(details[1][4], '5%');
});

test('pricing export writes money, quantities and percentages as numeric Excel cells', () => {
  const workbook = createTabularWorkbookXlsx([
    { sheetName: 'Bảng giá tổng hợp', headers: ['SKU', 'Giá nền', 'Giá bán', 'Ghi chú'],
      rows: [
        ['000123', { value: 32000, format: 'currency' }, { value: 31000, format: 'currency' }, ''],
        ['000124', { value: 0, format: 'currency' }, 'Nhiều mức giá', ''],
      ] },
    { sheetName: 'Điều kiện áp dụng', headers: ['SKU', 'Giá trị', 'SL từ', 'SL đến'],
      rows: [
        ['000123', { value: 0.05, format: 'percent' }, 10, 49],
        ['000124', { value: 600000, format: 'currency' }, 0, ''],
      ] },
  ]);
  const xml = workbook.toString('utf8');
  assert.ok(xml.includes('<c r="B2" s="2"><v>32000</v></c>'));
  assert.ok(xml.includes('<c r="C2" s="2"><v>31000</v></c>'));
  assert.ok(xml.includes('<c r="B3" s="2"><v>0</v></c>'));
  assert.ok(xml.includes('<c r="B2" s="3"><v>0.05</v></c>'));
  assert.ok(xml.includes('<c r="C2"><v>10</v></c>'));
  assert.ok(xml.includes('numFmtId="164"'));
  assert.ok(xml.includes('numFmtId="165"'));
  const limits = { ...TABULAR_XLSX_LIMITS, maxRows: 12001, maxColumns: 200 };
  const summary = parseTabularXlsx(workbook, limits, ['SKU', 'Giá nền']);
  const details = parseTabularXlsx(workbook, limits, ['SKU', 'Giá trị']);
  assert.deepEqual(summary[1], ['000123', '32000', '31000', '']);
  assert.equal(summary[2][2], 'Nhiều mức giá');
  assert.deepEqual(details[1], ['000123', '0.05', '10', '49']);
  assert.throws(() => createTabularWorkbookXlsx([
    { headers: ['Giá'], rows: [[{ value: Infinity, format: 'currency' }]] },
  ]), /WORKBOOK_CELL_INVALID/);
});

test('multi-sheet operational workbook trims redundant decimal scale', () => {
  const workbook = createTabularWorkbookXlsx([
    {
      sheetName: 'Kho',
      headers: ['Số lượng', 'Tồn kho', 'Mã chứng từ'],
      rows: [['12.000000000000', '2799.000000000000', 'SO-001'], ['12.500000000000', '2811.500000000000', 'SO-002']],
    },
  ]);
  const limits = { ...TABULAR_XLSX_LIMITS, maxRows: 12001, maxColumns: 200 };
  assert.deepEqual(parseTabularXlsx(workbook, limits), [
    ['Số lượng', 'Tồn kho', 'Mã chứng từ'],
    ['12', '2799', 'SO-001'],
    ['12.5', '2811.5', 'SO-002'],
  ]);
});

test('pricing overview uses one business navigation level and filters price-list columns', () => {
  const overview = read('app/pricing/pricing-overview.tsx');
  const workspace = read('app/pricing/pricing-workspace.tsx');
  const page = read('app/pricing/page.tsx');
  assert.doesNotMatch(page, /PricingModeNav/);
  assert.match(page, /PricingWorkspaceTab/);
  assert.match(workspace, /Danh mục giá/);
  assert.match(workspace, /Giá sản phẩm/);
  assert.match(workspace, /Điều chỉnh giá/);
  assert.match(workspace, /Kiểm tra giá áp dụng/);
  assert.match(overview, /Bảng giá hiển thị/);
  assert.match(overview, /Giá nền/);
  assert.match(overview, /Tất cả bảng giá/);
  assert.match(overview, /visibleListColumns/);
  assert.match(overview, /Xuất bảng giá đang chọn/);
  assert.match(overview, /Xuất toàn bộ bảng giá/);
  assert.match(overview, /PricingBulkOverlay/);
  assert.match(overview, /PricingFileAdjustment/);
  assert.match(overview, /Điều chỉnh giá/);
  assert.doesNotMatch(overview, /\/operations\/data-exchange\?tab=pricing/);
  assert.match(overview, /Điều kiện áp dụng/);
  assert.match(overview, /Nhiều mức giá/);
  assert.match(overview, /refreshAdjustedPriceList/);
  assert.match(overview, /function exportSummaryValue/);
  assert.match(overview, /function exportRuleValue/);
  assert.match(overview, /exportMoney\(summary\.amountMinor\)/);
  assert.match(overview, /exportQuantity\(decimalKey\(rule\.minQuantity/);
  assert.doesNotMatch(overview, /sourceKey/);
});

test('pricing overview lazy-loads price lists and defaults to base price', () => {
  const overview = read('app/pricing/pricing-overview.tsx');
  assert.match(overview, /const BASE_ONLY = '__BASE__'/);
  assert.match(overview, /useState\(BASE_ONLY\)/);
  assert.match(overview, /nextLists\.filter\(\(list\) => list\.list_type === 'BASE'\)/);
  assert.match(overview, /listRulesForPriceLists\(baseLists\)/);
  assert.doesNotMatch(overview, /listRules\(nextLists\)/);
  assert.match(overview, /PRICE_LIST_LOAD_CONCURRENCY = 4/);
  assert.match(overview, /ensureRulesLoaded/);
  assert.match(overview, /loadedListCodesRef/);
  assert.match(overview, /Đang tải Giá nền/);
  assert.match(overview, /Đang tải \$\{loadProgress\.completed\}\/\$\{loadProgress\.total\} bảng giá/);
  assert.match(overview, /Điều kiện đã tải/);
});

test('pricing writes use the shared canonical idempotency generator', () => {
  const boundary = read('app/pricing/pricing-idempotency-boundary.tsx');
  assert.match(boundary, /createIdempotencyKey\('pricing_write'\)/);
  assert.doesNotMatch(boundary, /web-pricing-/);
});
