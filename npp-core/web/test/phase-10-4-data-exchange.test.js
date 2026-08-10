import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createTabularXlsx, parseTabularXlsx } from '../lib/tabular-xlsx.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('Phase 10.4 generic XLSX round-trips a tabular workbook', () => {
  const workbook = createTabularXlsx({ sheetName: 'Kiểm kê', headers: ['warehouseCode', 'sku', 'actualCount'], rows: [['KHO-A', 'SKU-001', '12.5'], ['KHO-A', 'SKU-002', '0']] });
  assert.equal(workbook.subarray(0, 2).toString('utf8'), 'PK');
  assert.deepEqual(parseTabularXlsx(workbook), [['warehouseCode', 'sku', 'actualCount'], ['KHO-A', 'SKU-001', '12.5'], ['KHO-A', 'SKU-002', '0']]);
});

test('Phase 10.4 workspace uses official file-operation APIs and canonical inventory drill-down', () => {
  const source = read('app/operations/data-exchange/workspace.tsx');
  for (const route of ['products/export', 'products/import', 'pricing/export', 'pricing/import', 'stocktake/export', 'stocktake/import', 'quotation']) assert.match(source, new RegExp(`/api/file-operations/${route}`));
  assert.match(source, /\/api\/inventory\/balances\/drill-down/);
  assert.doesNotMatch(source, /\/api\/inventory\/balances[^'"`]*['"`][\s\S]{0,80}method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/);
  assert.doesNotMatch(source, /baseQuantityDelta\s*:/);
  assert.doesNotMatch(source, /signedDelta\s*:/);
});

test('Phase 10.4 stocktake export strips system quantity before the browser receives the file payload', () => {
  const route = read('app/api/file-operations/[...segments]/route.ts');
  assert.match(route, /sanitizeStocktakeExport/);
  assert.match(route, /systemQuantity:\s*_hidden/);
  assert.match(route, /path !== 'stocktake\/export'/);
  const workspace = read('app/operations/data-exchange/workspace.tsx');
  assert.deepEqual([...workspace.matchAll(/const STOCKTAKE_COLUMNS = \[([^\]]+)\]/g)].length, 1);
  assert.doesNotMatch(workspace.match(/const STOCKTAKE_COLUMNS = \[[^\]]+\]/)?.[0] ?? '', /systemQuantity/);
  assert.match(workspace, /Chưa gửi duyệt, chưa ghi sổ tồn/);
});

test('Phase 10.4 pricing keeps legacy blank-sourceKey rows on optimistic canonical PATCH', () => {
  const source = read('app/operations/data-exchange/workspace.tsx');
  assert.match(source, /blankSource/);
  assert.match(source, /expectedUpdatedAt: match\.item\.updated_at/);
  assert.match(source, /\/api\/price-lists\/\$\{list\.id\}\/items\/\$\{match\.item\.id\}/);
});

test('Phase 10.4 page is reachable from canonical import/export history', () => {
  const history = read('app/operations/import-export-history/page.tsx');
  assert.match(history, /href="\/operations\/data-exchange"/);
  assert.match(history, /Import \/ Export & Báo giá/);
});
