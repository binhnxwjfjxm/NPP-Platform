import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createTabularWorkbookXlsx } from '../lib/tabular-workbook-xlsx.js';
import { parseTabularXlsx, TABULAR_XLSX_LIMITS } from '../lib/tabular-xlsx.js';

const root = path.resolve(process.cwd());
function read(relativePath) { return fs.readFileSync(path.join(root, relativePath), 'utf8'); }

test('pricing workbook keeps summary and detailed rules in separate sheets', () => {
  const workbook = createTabularWorkbookXlsx([
    {
      sheetName: 'Bảng giá tổng hợp',
      headers: ['Mã SP', 'Tên SP', 'SKU', 'Quy cách', 'ĐVT', 'Giá nền', 'SỈ · Giá sỉ'],
      rows: [['SP01', 'Trà đào', 'SP01-THUNG', 'Thùng 24 chai', 'Thùng', '120.000 ₫', 'Nhiều mức']],
    },
    {
      sheetName: 'Chi tiết chính sách giá',
      headers: ['Mã bảng giá', 'Tên bảng giá', 'SKU', 'Cách áp dụng', 'Giá trị', 'SL từ', 'SL đến'],
      rows: [['SỈ', 'Giá sỉ', 'SP01-THUNG', 'Giảm phần trăm', '5%', '10', '49']],
    },
  ]);
  const limits = { ...TABULAR_XLSX_LIMITS, maxRows: 12001, maxColumns: 200 };
  const summary = parseTabularXlsx(workbook, limits, ['Mã SP', 'Giá nền']);
  const details = parseTabularXlsx(workbook, limits, ['Mã bảng giá', 'Cách áp dụng']);
  assert.deepEqual(summary[0], ['Mã SP', 'Tên SP', 'SKU', 'Quy cách', 'ĐVT', 'Giá nền', 'SỈ · Giá sỉ']);
  assert.equal(summary[1][6], 'Nhiều mức');
  assert.deepEqual(details[0].slice(0, 3), ['Mã bảng giá', 'Tên bảng giá', 'SKU']);
  assert.equal(details[1][4], '5%');
});

test('pricing overview exposes the required office-language actions and columns', () => {
  const overview = read('app/pricing/pricing-overview.tsx');
  const nav = read('app/pricing/pricing-mode-nav.tsx');
  const page = read('app/pricing/page.tsx');
  assert.match(page, /PricingOverview/);
  assert.match(nav, /Toàn bộ bảng giá/);
  assert.match(overview, /Mã SP/);
  assert.match(overview, /Tên SP/);
  assert.match(overview, /Quy cách/);
  assert.match(overview, /ĐVT/);
  assert.match(overview, /Giá nền/);
  assert.match(overview, /Xuất bảng đang chọn/);
  assert.match(overview, /Xuất toàn bộ Excel/);
  assert.match(overview, /Chi tiết chính sách giá/);
  assert.match(overview, /Nhiều mức/);
  assert.doesNotMatch(overview, /sourceKey/);
});

test('pricing writes use the shared canonical idempotency generator', () => {
  const boundary = read('app/pricing/pricing-idempotency-boundary.tsx');
  assert.match(boundary, /createIdempotencyKey\('pricing_write'\)/);
  assert.doesNotMatch(boundary, /web-pricing-/);
});
