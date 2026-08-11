import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createTabularXlsx, parseTabularXlsx } from '../lib/tabular-xlsx.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const workspace = read('app/operations/data-exchange/workspace.tsx');
const model = read('app/operations/data-exchange/data-exchange-model.ts');
const fileUtils = read('app/operations/data-exchange/data-exchange-file-utils.ts');
const actions = read('app/operations/data-exchange/data-exchange-import-actions.ts');
const preview = read('app/operations/data-exchange/data-exchange-preview.tsx');
const view = read('app/operations/data-exchange/data-exchange-view.tsx');
const dataExchange = [workspace, model, fileUtils, actions, preview, view].join('\n');

test('Phase 10.4 generic XLSX round-trips a tabular workbook', () => {
  const workbook = createTabularXlsx({ sheetName: 'Kiểm kê', headers: ['Mã kho', 'SKU', 'Số đếm thực tế'], rows: [['KHO-A', 'SKU-001', '12.5'], ['KHO-A', 'SKU-002', '0']] });
  assert.equal(workbook.subarray(0, 2).toString('utf8'), 'PK');
  assert.deepEqual(parseTabularXlsx(workbook), [['Mã kho', 'SKU', 'Số đếm thực tế'], ['KHO-A', 'SKU-001', '12.5'], ['KHO-A', 'SKU-002', '0']]);
});

test('Phase 10.4 workspace uses official file-operation APIs and canonical inventory drill-down', () => {
  for (const endpoint of ['products/export', 'products/import', 'pricing/export', 'pricing/import', 'stocktake/export', 'stocktake/import', 'quotation']) assert.match(dataExchange, new RegExp(`/api/file-operations/${endpoint}`));
  assert.match(workspace, /\/api\/inventory\/balances\/drill-down/);
  assert.doesNotMatch(dataExchange, /\/api\/inventory\/balances[^'"`]*['"`][\s\S]{0,80}method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/);
  assert.doesNotMatch(dataExchange, /baseQuantityDelta\s*:/);
  assert.doesNotMatch(dataExchange, /signedDelta\s*:/);
});

test('Phase 10.4 stocktake export stays blind and creates only draft count data', () => {
  const route = read('app/api/file-operations/[...segments]/route.ts');
  assert.match(route, /sanitizeStocktakeExport/);
  assert.match(route, /systemQuantity:\s*_hidden/);
  assert.match(route, /path !== 'stocktake\/export'/);
  assert.match(model, /const STOCKTAKE_COLUMNS = \['warehouseCode', 'locationCode', 'sku', 'lotCode', 'actualCount'\]/);
  assert.doesNotMatch(model.match(/const STOCKTAKE_COLUMNS = \[[^\]]+\]/)?.[0] ?? '', /systemQuantity/);
  assert.match(view, /Chưa gửi duyệt, chưa ghi sổ tồn/);
});

test('Phase 10.4 pricing keeps legacy blank-sourceKey rows on optimistic canonical PATCH', () => {
  assert.match(actions, /blankSource/);
  assert.match(actions, /expectedUpdatedAt: match\.item\.updated_at/);
  assert.match(actions, /\/api\/price-lists\/\$\{list\.id\}\/items\/\$\{match\.item\.id\}/);
});

test('Phase 10.4 rejects ambiguous legacy price matches and preserves quotation lineage', () => {
  assert.match(actions, /const matches = existingRows\.filter/);
  assert.match(actions, /matches\.length !== 1/);
  assert.match(actions, /effective_from/);
  assert.match(workspace, /lineTotal: String\(row\.lineTotalMinor/);
  assert.match(workspace, /priceListCode: String\(row\.priceListCode/);
  assert.match(workspace, /row\.lineTotal, row\.priceListCode/);
});

test('product import is operator-facing: Vietnamese headers, preview and explicit choices', () => {
  assert.match(model, /unitCode: 'Đơn vị tính'/);
  assert.match(model, /conversionToBase: 'Hệ số quy đổi về đơn vị tồn chuẩn'/);
  assert.match(model, /lotTrackingMode: 'Quản lý theo lô'/);
  assert.match(model, /expiryTrackingMode: 'Quản lý hạn sử dụng'/);
  assert.match(preview, /data-testid="product-import-preview"/);
  assert.match(preview, /Xác nhận nhập \{rows\.length\} dòng/);
  assert.match(preview, /không cần nhập TRUE\/FALSE trong file/);
  assert.match(preview, /Chọn đơn vị/);
  assert.match(actions, /Đơn vị tính “\$\{unitCode\}” chưa có hoặc đã ngừng sử dụng/);
  assert.doesNotMatch(view, /Logic onboarding SKU/);
  assert.doesNotMatch(view, /unitCode \+ conversionToBase/);
});

test('Vietnamese file headers remain compatible with backend field names', () => {
  assert.match(model, /LABEL_TO_COLUMN/);
  assert.match(model, /normalizeHeader/);
  assert.match(fileUtils, /headers\.map\(labelFor\)/);
  assert.match(model, /true[^\n]*Có|return 'Có'/);
  assert.match(model, /false[^\n]*Không|return 'Không'/);
});

test('data exchange uses inventory balance API within supported limit', () => {
  const stocktakes = read('app/inventory/stocktakes/page.tsx');
  const transfers = read('app/inventory/transfers/page.tsx');
  assert.match(workspace, /\/api\/inventory\/balances\?limit=1000/);
  assert.doesNotMatch(workspace, /\/api\/inventory\/balances\?limit=2000/);
  assert.match(stocktakes, /listInventoryBalances[\s\S]*limit: '1000'/);
  assert.match(transfers, /listInventoryBalances[\s\S]*limit: '1000'/);
});

test('central data exchange is persistent navigation and preserves direct tab deep links', () => {
  const shell = read('app/components/app-shell-core.tsx');
  const wrapper = read('app/components/app-shell.tsx');
  assert.match(shell, /href="\/operations\/data-exchange"/);
  assert.match(shell, /data-testid="nav-data-exchange"/);
  assert.match(shell, /Nhập \/ xuất dữ liệu/);
  assert.doesNotMatch(wrapper, /usePathname/);
  assert.match(workspace, /useSearchParams/);
  assert.match(workspace, /searchParams\.get\('tab'\)/);
  assert.match(view, /title="Nhập \/ xuất dữ liệu & báo giá"/);
});

test('Phase 10.4 page is reachable from Vietnamese import/export history', () => {
  const history = read('app/operations/import-export-history/page.tsx');
  assert.match(history, /href="\/operations\/data-exchange"/);
  assert.match(history, /Nhập \/ xuất dữ liệu & báo giá/);
  assert.match(history, /Lịch sử nhập \/ xuất dữ liệu/);
});
