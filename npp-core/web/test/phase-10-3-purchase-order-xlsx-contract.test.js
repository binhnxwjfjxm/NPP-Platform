import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const editor = source('../app/purchasing/purchase-orders/components/PurchaseOrderEditorV4.tsx');
const skuEntry = source('../lib/purchase-order-sku-entry.js');
const templateRoute = source('../app/api/purchase-orders/bulk-template/route.ts');
const uploadRoute = source('../app/api/purchase-orders/bulk-xlsx/route.ts');

 test('10.3 PO editor downloads and uploads XLSX through server-owned routes while keeping text formats', () => {
  assert.match(editor, /\/api\/purchase-orders\/bulk-template/);
  assert.match(editor, /\/api\/purchase-orders\/bulk-xlsx/);
  assert.match(editor, /Tải mẫu XLSX/);
  assert.match(editor, /\.xlsx,\.csv,\.tsv,\.txt/);
  assert.match(editor, /await file\.text\(\)/);
  assert.doesNotMatch(editor, /Tải mẫu CSV cho Excel/);
  assert.doesNotMatch(editor, /purchaseOrderBulkTemplate/);
});

test('10.3 XLSX upload rejoins the existing canonical parser and SKU resolution flow', () => {
  assert.match(editor, /parsePurchaseOrderPasteGrid\(text\)/);
  assert.match(editor, /\/api\/purchase-orders\/sku-resolve/);
  assert.match(editor, /payload\.data\.text/);
  assert.match(uploadRoute, /parsePurchaseOrderXlsx/);
  assert.match(uploadRoute, /Response\.json\(\{ data: \{ text \} \}/);
});

test('10.3 template contract is XLSX-only and generated server-side', () => {
  assert.match(skuEntry, /mau-nhap-don-dat-hang\.xlsx/);
  assert.match(skuEntry, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
  assert.doesNotMatch(skuEntry, /text\/csv|purchaseOrderBulkTemplate|SKU;Số lượng/);
  assert.match(templateRoute, /createPurchaseOrderXlsxTemplate/);
  assert.match(templateRoute, /Content-Disposition/);
  assert.match(templateRoute, /Cache-Control.*no-store/s);
});
