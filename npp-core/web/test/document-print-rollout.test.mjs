import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const printSource = read('app/components/print-document.tsx');
const printCss = read('app/components/print-document.module.css');
const globalCss = read('app/globals.css');
const businessPrint = read('app/components/business-document-print.tsx');
const poPrint = read('app/purchasing/purchase-orders/PurchaseOrderPrintSheet.tsx');
const grPrint = read('app/purchasing/goods-receipts/GoodsReceiptPrintDock.tsx');
const paymentPrint = read('app/accounting/customer-payments/CustomerPaymentPrintDock.tsx');
const deliveryPrint = read('app/inventory/delivery-orders/DeliveryOrderPrintDock.tsx');
const transferPrint = read('app/inventory/transfers/TransferPrintDock.tsx');
const stocktakePrint = read('app/inventory/stocktakes/StocktakePrintDock.tsx');
const tripPrint = read('app/logistics/dispatch/TripSheetPrintDock.tsx');
const reconciliationPrint = read('app/logistics/trip-reconciliation/TripReconciliationPrintDock.tsx');

const printModules = [
  businessPrint,
  poPrint,
  grPrint,
  paymentPrint,
  deliveryPrint,
  transferPrint,
  stocktakePrint,
  tripPrint,
  reconciliationPrint,
];

test('shared print foundation targets one document and supports A4/A5', () => {
  assert.match(printSource, /targetId/);
  assert.match(printSource, /data-print-active/);
  assert.match(printSource, /data-printing/);
  assert.match(printSource, /PrintPageSize = 'A4' \| 'A5'/);
  assert.match(printCss, /document-a4/);
  assert.match(printCss, /document-a5/);
  assert.match(globalCss, /body\[data-printing='true'\]/);
  assert.doesNotMatch(globalCss, /body:has\(\[data-print-surface\]\)/);
});

test('rollout uses one shared business template and print stays read-only', () => {
  assert.match(businessPrint, /BusinessDocumentPrint/);
  assert.match(businessPrint, /Bản in từ NPP Operations/);
  for (const source of printModules) {
    assert.doesNotMatch(source, /method:\s*['"]POST['"]/);
    assert.doesNotMatch(source, /method:\s*['"]PATCH['"]/);
    assert.doesNotMatch(source, /Idempotency-Key/);
    assert.doesNotMatch(source, /window\.print\(/);
  }
});

test('P0 canonical print surfaces are mounted without a top-level print module', () => {
  assert.match(poPrint, /ĐƠN ĐẶT HÀNG/);
  assert.match(grPrint, /PHIẾU NHẬN HÀNG/);
  assert.match(paymentPrint, /PHIẾU THU/);
  assert.match(paymentPrint, /size="A5"/);
  assert.match(deliveryPrint, /PHIẾU GIAO HÀNG/);
  assert.match(deliveryPrint, /PACKING LIST/);
  assert.match(transferPrint, /PHIẾU CHUYỂN KHO/);
  assert.match(stocktakePrint, /PHIẾU KIỂM KÊ/);
  assert.match(tripPrint, /PHIẾU CHUYẾN GIAO HÀNG/);
  assert.match(reconciliationPrint, /BIÊN BẢN ĐỐI SOÁT CHUYẾN/);
});

test('large workspaces print from canonical GET detail rather than editable form state', () => {
  assert.match(grPrint, /\/api\/goods-receipts\/\$\{selectedId\}/);
  assert.match(paymentPrint, /\/api\/customer-payments\/\$\{selectedId\}/);
  assert.match(deliveryPrint, /\/api\/delivery-orders\/\$\{selectedId\}/);
  assert.match(transferPrint, /\/api\/inventory\/transfers\/\$\{selectedId\}/);
  assert.match(stocktakePrint, /\/api\/inventory\/stocktakes\/\$\{selectedId\}/);
  assert.match(tripPrint, /\/api\/logistics\/trips\/\$\{selectedId\}\/dispatch/);
  assert.match(reconciliationPrint, /\/api\/logistics\/trips\/\$\{selectedId\}\/reconciliation/);
});
