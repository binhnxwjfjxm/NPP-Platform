import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parseTabularXlsx } from '../lib/tabular-xlsx.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const officeLikeWorkbook = Buffer.from('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', 'base64');

test('XLSX compatibility selects the data sheet and decodes numeric XML entities', () => {
  assert.deepEqual(
    parseTabularXlsx(officeLikeWorkbook, undefined, ['SKU', 'Giá bán (VND)']),
    [['SKU', 'Giá bán (VND)'], ['ABC', '10000']],
  );
});

test('price import exposes a real template and keeps current-price export separate', () => {
  const actions = read('app/operations/data-exchange/data-exchange-import-actions.ts');
  const view = read('app/operations/data-exchange/data-exchange-view.tsx');
  assert.match(actions, /mau-cap-nhat-gia\.xlsx/);
  assert.match(actions, /'Mẫu cập nhật giá', \[\.\.\.PRICE_UPDATE_COLUMNS\], \[\], format/);
  assert.match(view, /Tải mẫu Excel/);
  assert.match(view, /Tải mẫu CSV/);
  assert.match(view, /Xuất giá hiện tại Excel/);
  assert.match(view, /Xuất giá hiện tại CSV/);
  assert.doesNotMatch(view, /Tải\/Xuất Excel 2 cột|Tải\/Xuất CSV 2 cột/);
});

test('XLSX reader receives required headers and rejects unsupported spreadsheet formats explicitly', () => {
  const fileUtils = read('app/operations/data-exchange/data-exchange-file-utils.ts');
  const route = read('app/api/data-exchange/xlsx/route.ts');
  assert.match(fileUtils, /query\.append\('header', column\)/);
  assert.match(fileUtils, /query\.append\('header', label\)/);
  assert.match(route, /searchParams\.getAll\('header'\)/);
  assert.match(fileUtils, /Chỉ hỗ trợ tệp Excel \.xlsx hoặc CSV \.csv/);
});

test('file imports use the shared canonical idempotency generator and reuse the same key on retry', () => {
  const fileUtils = read('app/operations/data-exchange/data-exchange-file-utils.ts');
  const actions = read('app/operations/data-exchange/data-exchange-import-actions.ts');
  assert.match(fileUtils, /import \{[\s\S]*?\bcreateIdempotencyKey\b[\s\S]*?\} from '@npp\/contracts'/);
  assert.match(fileUtils, /return createIdempotencyKey\(prefix\)/);
  assert.match(actions, /const operationKey = currentImportKey\(pendingImport\.kind\)/);
  assert.match(actions, /'Idempotency-Key': operationKey/);
  assert.match(actions, /const sourceBatchId = operationKey/);
  assert.doesNotMatch(actions, /price-file-\$\{crypto\.randomUUID\(\)\}/);
});
