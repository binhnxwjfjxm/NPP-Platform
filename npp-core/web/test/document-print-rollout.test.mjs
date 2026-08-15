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
const printModules = [businessPrint, poPrint, grPrint, paymentPrint, deliveryPrint, transferPrint, stocktakePrint, tripPrint, reconciliationPrint];
const contextualModules = [grPrint, paymentPrint, deliveryPrint, transferPrint, stocktakePrint, tripPrint, reconciliationPrint];

test('shared print foundation targets one document and supports A4/A5', () => {
  assert.match(printSource, /targetId/); assert.match(printSource, /data-print-active/); assert.match(printSource, /data-printing/);
  assert.match(printSource, /PrintPageSize = 'A4' \| 'A5'/); assert.match(printCss, /document-a4/); assert.match(printCss, /document-a5/);
  assert.match(globalCss, /body\[data-printing='true'\]/); assert.doesNotMatch(globalCss, /body:has\(\[data-print-surface\]\)/);
});

test('rollout stays read-only and uses the shared business template', () => {
  assert.match(businessPrint, /BusinessDocumentPrint/); assert.match(businessPrint, /Bản in từ NPP Operations/);
  for (const source of printModules) { assert.doesNotMatch(source, /method:\s*['"]POST['"]/); assert.doesNotMatch(source, /method:\s*['"]PATCH['"]/); assert.doesNotMatch(source, /Idempotency-Key/); }
});

test('canonical print surfaces remain available', () => {
  assert.match(poPrint, /ĐƠN ĐẶT HÀNG/); assert.match(grPrint, /PHIẾU NHẬN HÀNG/); assert.match(paymentPrint, /PHIẾU THU/); assert.match(paymentPrint, /size="A5"/);
  assert.match(deliveryPrint, /PHIẾU GIAO HÀNG/); assert.match(deliveryPrint, /PHIẾU ĐÓNG GÓI/); assert.match(transferPrint, /PHIẾU CHUYỂN KHO/); assert.match(stocktakePrint, /PHIẾU KIỂM KÊ/); assert.match(tripPrint, /PHIẾU CHUYẾN GIAO HÀNG/); assert.match(reconciliationPrint, /BIÊN BẢN ĐỐI SOÁT CHUYẾN/);
});

test('detail-based print controls do not maintain a second selector/fetch state', () => {
  for (const source of contextualModules) { assert.doesNotMatch(source, /DocumentPrintDock/); assert.doesNotMatch(source, /fetch\(/); assert.doesNotMatch(source, /selectedId/); }
});

test('every workspace with a detail surface mounts print on the opened canonical detail', () => {
  assert.match(read('app/purchasing/goods-receipts/GoodsReceiptWorkspace.tsx'), /GoodsReceiptPrintDock receipt=\{selectedGoodsReceipt\}/);
  assert.match(read('app/accounting/customer-payments/customer-payment-workspace.tsx'), /CustomerPaymentPrintDock payment=\{selected\}/);
  assert.match(read('app/inventory/delivery-orders/delivery-order-workspace.tsx'), /DeliveryOrderPrintDock order=\{selectedOrder\}/);
  assert.match(read('app/inventory/transfers/transfer-workspace.tsx'), /TransferPrintDock transfer=\{selected\}/);
  assert.match(read('app/inventory/stocktakes/stocktake-workspace.tsx'), /StocktakePrintDock stocktake=\{detail\}/);
  assert.match(read('app/logistics/dispatch/trip-dispatch-workspace.tsx'), /TripSheetPrintDock trip=\{selectedTrip\}/);
  assert.match(read('app/logistics/trip-reconciliation/trip-reconciliation-workspace.tsx'), /TripReconciliationPrintDock reconciliation=\{detail\}/);
});

test('list pages no longer mount document-selector print docks below their workspaces', () => {
  const pages = ['app/purchasing/goods-receipts/page.tsx','app/accounting/customer-payments/page.tsx','app/inventory/delivery-orders/page.tsx','app/inventory/transfers/page.tsx','app/inventory/stocktakes/page.tsx','app/logistics/dispatch/page.tsx','app/logistics/trip-reconciliation/page.tsx'];
  for (const path of pages) assert.doesNotMatch(read(path), /PrintDock/);
});
