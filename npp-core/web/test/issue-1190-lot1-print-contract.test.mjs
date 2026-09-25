import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('Issue #1190 Lô 1 registers all missing operational print templates', async () => {
  const catalog = await readFile(new URL('../../api/src/services/document-print-templates.js', import.meta.url), 'utf8');
  for (const type of ['MANUAL_INBOUND', 'SUPPLIER_RETURN', 'CUSTOMER_RETURN', 'FULFILLMENT_PICKING', 'SUPPLIER_PAYMENT', 'CUSTOMER_REFUND', 'COD_RECONCILIATION']) {
    assert.match(catalog, new RegExp(`template\\('${type}'`));
  }
});

test('Issue #1190 Lô 1 exposes In / PDF from each business document workspace', async () => {
  const files = await Promise.all([
    source('app/inventory/manual-inbounds/ManualInboundPrintDock.tsx'),
    source('app/purchasing/supplier-returns/SupplierReturnPrintDock.tsx'),
    source('app/inventory/customer-returns/CustomerReturnPrintDock.tsx'),
    source('app/inventory/fulfillment/FulfillmentPickingPrintDock.tsx'),
    source('app/accounting/supplier-payments/SupplierPaymentPrintDock.tsx'),
    source('app/accounting/customer-return-credits/CustomerRefundPrintDock.tsx'),
    source('app/accounting/cod-reconciliation/CodReconciliationPrintDock.tsx'),
  ]);
  for (const file of files) {
    assert.match(file, /BusinessDocumentPrint/);
    assert.match(file, /actionLabel="In \/ PDF"/);
    assert.doesNotMatch(file, /window\.print\(|document\.body\.innerHTML/);
  }
  assert.doesNotMatch(files[3], /\bNumber\(/);
  assert.doesNotMatch(files[3], /status=\{order\.fulfillmentStatus\}/);
});

test('Issue #1190 Lô 1 wires prints into real detail/action surfaces without new business mutation APIs', async () => {
  const [manual, supplierReturn, customerReturn, fulfillment, supplierPayment, customerCredit, cod] = await Promise.all([
    source('app/inventory/manual-inbounds/manual-inbound-workspace.tsx'),
    source('app/purchasing/supplier-returns/SupplierReturnWorkspace.tsx'),
    source('app/inventory/customer-returns/customer-return-workspace.tsx'),
    source('app/inventory/fulfillment/fulfillment-workspace.tsx'),
    source('app/accounting/supplier-payments/supplier-payment-workspace.tsx'),
    source('app/accounting/customer-return-credits/customer-return-credit-workspace.tsx'),
    source('app/accounting/cod-reconciliation/cod-reconciliation-workspace.tsx'),
  ]);
  assert.match(manual, /ManualInboundPrintDock/);
  assert.match(supplierReturn, /SupplierReturnPrintDock/);
  assert.match(customerReturn, /CustomerReturnPrintDock/);
  assert.match(fulfillment, /FulfillmentPickingPrintDock/);
  assert.match(supplierPayment, /SupplierPaymentPrintDock/);
  assert.match(customerCredit, /CustomerRefundPrintDock/);
  assert.match(cod, /CodReconciliationPrintDock/);
});
