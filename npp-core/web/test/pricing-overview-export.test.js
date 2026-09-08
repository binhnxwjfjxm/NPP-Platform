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

test('pricing overview uses one business navigation level and filters price-list columns', () => {
  const overview = read('app/pricing/pricing-overview.tsx');
  const workspace = read('app/pricing/pricing-workspace.tsx');
  const page = read('app/pricing/page.tsx');
  assert.doesNotMatch(page, /PricingModeNav/);
  assert.match(page, /PricingWorkspaceTab/);
  assert.match(workspace, /Danh mục giá/);
  assert.match(workspace, /Giá sản phẩm/);
  assert.match(workspace, /Bảng giá tổng hợp/);
  assert.match(workspace, /Kiểm tra giá áp dụng/);
  assert.match(overview, /Bảng giá hiển thị/);
  assert.match(overview, /Tất cả bảng giá/);
  assert.match(overview, /visibleListColumns/);
  assert.match(overview, /Xuất bảng giá đang chọn/);
  assert.match(overview, /Xuất toàn bộ bảng giá/);
  assert.match(overview, /Cập nhật giá từ Excel/);
  assert.match(overview, /Lịch sử cập nhật giá/);
  assert.match(overview, /Điều kiện áp dụng/);
  assert.match(overview, /Nhiều mức giá/);
  assert.doesNotMatch(overview, /sourceKey/);
});

test('pricing writes use the shared canonical idempotency generator', () => {
  const boundary = read('app/pricing/pricing-idempotency-boundary.tsx');
  assert.match(boundary, /createIdempotencyKey\('pricing_write'\)/);
  assert.doesNotMatch(boundary, /web-pricing-/);
});
