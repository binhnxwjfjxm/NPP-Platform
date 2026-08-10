import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PURCHASE_ORDER_XLSX_FILENAME,
  PURCHASE_ORDER_XLSX_HEADERS,
  PURCHASE_ORDER_XLSX_LIMITS,
  PURCHASE_ORDER_XLSX_MIME,
  PURCHASE_ORDER_XLSX_SHEET,
  createPurchaseOrderXlsxTemplate,
  parsePurchaseOrderXlsx,
  purchaseOrderXlsxErrorMessage,
} from '../lib/purchase-order-xlsx.js';
import { parsePurchaseOrderPasteGrid } from '../lib/purchase-order-line-entry.js';

test('10.3 creates a real PO XLSX workbook and round-trips into the canonical bulk parser', () => {
  const workbook = createPurchaseOrderXlsxTemplate();
  assert.equal(workbook.subarray(0, 2).toString('hex'), '504b');
  assert.equal(PURCHASE_ORDER_XLSX_FILENAME, 'mau-nhap-don-dat-hang.xlsx');
  assert.equal(PURCHASE_ORDER_XLSX_MIME, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(PURCHASE_ORDER_XLSX_SHEET, 'Nhập đơn hàng');
  assert.equal(PURCHASE_ORDER_XLSX_HEADERS.length, 7);

  const text = parsePurchaseOrderXlsx(workbook);
  const parsed = parsePurchaseOrderPasteGrid(text);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].sku, 'SKU-MAU');
  assert.equal(parsed[0].quantity, '10');
  assert.equal(parsed[0].unitPrice, '25000');
  assert.equal(parsed[0].discountMode, 'TOTAL_AMOUNT');
  assert.equal(parsed[0].taxRate, '8');
});

test('10.3 workbook contract has frozen header, widths, filter/table, formats and discount validation', () => {
  const source = createPurchaseOrderXlsxTemplate().toString('utf8');
  assert.match(source, /ySplit="1"/);
  assert.match(source, /<autoFilter ref="A1:G2"\/>/);
  assert.match(source, /<tableParts count="1">/);
  assert.match(source, /D2:D501/);
  assert.match(source, /Giảm tổng dòng,% tiền hàng,Giảm mỗi đơn vị/);
  assert.match(source, /width="34"/);
  assert.match(source, /numFmtId="4"/);
});

test('10.3 XLSX parser fails closed on malformed and unsafe workbook limits', () => {
  assert.throws(() => parsePurchaseOrderXlsx(Buffer.from('not-a-zip')), /XLSX_/);
  assert.equal(purchaseOrderXlsxErrorMessage(new Error('XLSX_ZIP_INVALID')), 'Tệp XLSX không hợp lệ hoặc không đọc được worksheet đầu tiên.');

  const workbook = createPurchaseOrderXlsxTemplate();
  assert.throws(() => parsePurchaseOrderXlsx(workbook, { ...PURCHASE_ORDER_XLSX_LIMITS, maxRows: 1 }), /XLSX_ROW_LIMIT_EXCEEDED/);
  assert.throws(() => parsePurchaseOrderXlsx(workbook, { ...PURCHASE_ORDER_XLSX_LIMITS, maxColumns: 6 }), /XLSX_COLUMN_LIMIT_EXCEEDED/);
  assert.throws(() => parsePurchaseOrderXlsx(workbook, { ...PURCHASE_ORDER_XLSX_LIMITS, maxUncompressedBytes: 100 }), /XLSX_UNCOMPRESSED_SIZE_INVALID/);
  assert.throws(() => parsePurchaseOrderXlsx(Buffer.alloc(PURCHASE_ORDER_XLSX_LIMITS.maxFileBytes + 1)), /XLSX_FILE_SIZE_INVALID/);
});
