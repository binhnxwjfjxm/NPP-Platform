import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const printSource = read('app/components/print-document.tsx');
const printCss = read('app/components/print-document.module.css');
const globalCss = read('app/globals.css');
const businessPrint = read('app/components/business-document-print.tsx');
const poPrint = read('app/purchasing/purchase-orders/PurchaseOrderPrintSheet.tsx');
const salesPrint = read('app/sales/sales-orders/SalesOrderPrintSheet.tsx');
const grPrint = read('app/purchasing/goods-receipts/GoodsReceiptPrintDock.tsx');
const paymentPrint = read('app/accounting/customer-payments/CustomerPaymentPrintDock.tsx');
const deliveryPrint = read('app/inventory/delivery-orders/DeliveryOrderPrintDock.tsx');
const transferPrint = read('app/inventory/transfers/TransferPrintDock.tsx');
const stocktakePrint = read('app/inventory/stocktakes/StocktakePrintDock.tsx');
const tripPrint = read('app/logistics/dispatch/TripSheetPrintDock.tsx');
const reconciliationPrint = read('app/logistics/trip-reconciliation/TripReconciliationPrintDock.tsx');
const printModules = [businessPrint, poPrint, salesPrint, grPrint, paymentPrint, deliveryPrint, transferPrint, stocktakePrint, tripPrint, reconciliationPrint];
const contextualModules = [grPrint, paymentPrint, deliveryPrint, transferPrint, stocktakePrint, tripPrint, reconciliationPrint];

test('shared print foundation isolates only the selected A4/A5 document from application layout', () => {
  assert.match(printSource, /targetId/); assert.match(printSource, /cloneNode\(true\)/); assert.match(printSource, /data-print-root/); assert.match(printSource, /data-print-active/); assert.match(printSource, /data-printing/); assert.match(printSource, /PrintPageSize = 'A4' \| 'A5'/); assert.match(printCss, /document-a4/); assert.match(printCss, /document-a5/); assert.match(globalCss, /body\[data-printing='true'\] > \*:not\(\[data-print-root='true'\]\)/); assert.match(globalCss, /display:\s*none !important/); assert.doesNotMatch(globalCss, /body\[data-printing='true'\] \*\s*\{\s*visibility:\s*hidden/); assert.doesNotMatch(globalCss, /body:has\(\[data-print-surface\]\)/);
});

test('shared print action uses the light bronze-gold operation tone', () => { assert.match(printCss, /#f3e6cf/); assert.match(printCss, /#754706/); assert.match(printCss, /#98600f/); });

test('shared business print reads installation template, has no hard-coded company name and no extra footer', () => {
  assert.match(businessPrint, /BusinessDocumentPrint/);
  assert.match(businessPrint, /template\?\.heading/);
  assert.match(businessPrint, /template\?\.title/);
  assert.match(businessPrint, /template\?\.subtitle/);
  assert.doesNotMatch(businessPrint, /HƯNG PHÁT/);
  assert.doesNotMatch(businessPrint, /Bản in từ Hệ thống Công Ty/);
  assert.doesNotMatch(businessPrint, /NPP Operations|chứng từ canonical/);
  for (const source of printModules) { assert.doesNotMatch(source, /method:\s*['"]POST['"]/); assert.doesNotMatch(source, /method:\s*['"]PATCH['"]/); assert.doesNotMatch(source, /Idempotency-Key/); }
  assert.match(businessPrint, /\/api\/document-print-templates/);
});

test('purchase and sales documents omit zero discount and tax sections', () => {
  for (const source of [poPrint, salesPrint]) { assert.match(source, /isZeroAmount/); assert.match(source, /showDiscount/); assert.match(source, /showTax/); }
  assert.match(poPrint, /showDiscount \? \[\{ key: 'discount'/); assert.match(poPrint, /showTax \? \[\{ key: 'tax'/); assert.match(salesPrint, /showDiscount \? \[\{ key: 'discount'/); assert.match(salesPrint, /showTax \? \[\{ key: 'tax'/); assert.match(salesPrint, /documentType="SALES_ORDER"/);
});

test('canonical print surfaces remain available', () => {
  assert.match(poPrint, /ĐƠN MUA HÀNG/); assert.match(salesPrint, /ĐƠN BÁN HÀNG/); assert.match(grPrint, /PHIẾU NHẬN HÀNG/); assert.match(paymentPrint, /PHIẾU THU/); assert.match(paymentPrint, /size="A5"/); assert.match(deliveryPrint, /PHIẾU GIAO HÀNG/); assert.match(deliveryPrint, /PHIẾU ĐÓNG GÓI/); assert.match(transferPrint, /PHIẾU CHUYỂN KHO/); assert.match(stocktakePrint, /PHIẾU KIỂM KÊ/); assert.match(tripPrint, /PHIẾU CHUYẾN GIAO HÀNG/); assert.match(reconciliationPrint, /BIÊN BẢN ĐỐI SOÁT CHUYẾN/);
  for (const source of [poPrint, salesPrint, grPrint, paymentPrint, deliveryPrint, transferPrint, stocktakePrint, tripPrint, reconciliationPrint]) assert.match(source, /documentType=/);
});

test('detail-based print controls do not maintain a second selector/fetch state', () => { for (const source of contextualModules) { assert.doesNotMatch(source, /DocumentPrintDock/); assert.doesNotMatch(source, /fetch\(/); assert.doesNotMatch(source, /selectedId/); } });

test('every workspace with a detail surface mounts print on the opened canonical detail', () => {
  assert.match(read('app/purchasing/goods-receipts/GoodsReceiptWorkspace.tsx'), /GoodsReceiptPrintDock receipt=\{selectedGoodsReceipt\}/); assert.match(read('app/accounting/customer-payments/customer-payment-workspace.tsx'), /CustomerPaymentPrintDock payment=\{selected\}/); assert.match(read('app/inventory/delivery-orders/delivery-order-workspace.tsx'), /DeliveryOrderPrintDock order=\{selectedOrder\}/); assert.match(read('app/inventory/transfers/transfer-workspace.tsx'), /TransferPrintDock transfer=\{selected\}/); assert.match(read('app/inventory/stocktakes/stocktake-workspace.tsx'), /StocktakePrintDock stocktake=\{detail\}/); assert.match(read('app/logistics/dispatch/trip-dispatch-workspace.tsx'), /TripSheetPrintDock trip=\{selectedTrip\}/); assert.match(read('app/logistics/trip-reconciliation/trip-reconciliation-workspace.tsx'), /TripReconciliationPrintDock reconciliation=\{detail\}/);
});

test('list pages no longer mount document-selector print docks below their workspaces', () => {
  const pages = ['app/purchasing/goods-receipts/page.tsx','app/accounting/customer-payments/page.tsx','app/inventory/delivery-orders/page.tsx','app/inventory/transfers/page.tsx','app/inventory/stocktakes/page.tsx','app/logistics/dispatch/page.tsx','app/logistics/trip-reconciliation/page.tsx'];
  for (const path of pages) assert.doesNotMatch(read(path), /PrintDock/);
});
