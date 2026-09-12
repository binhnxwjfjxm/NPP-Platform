import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const detailSource = readFileSync(
  new URL('../app/sales/sales-orders/SalesOrderDetail.tsx', import.meta.url),
  'utf8',
);
const workspaceSource = readFileSync(
  new URL('../app/sales/sales-orders/SalesOrderWorkspace.tsx', import.meta.url),
  'utf8',
);
const formEntrySource = readFileSync(
  new URL('../app/sales/sales-orders/SalesOrderForm.tsx', import.meta.url),
  'utf8',
);
const formSource = readFileSync(
  new URL('../app/sales/sales-orders/SalesOrderCommercialForm.tsx', import.meta.url),
  'utf8',
);
const stockIssueConfirmSource = readFileSync(
  new URL('../app/sales/sales-orders/sales-order-stock-issue-confirm.ts', import.meta.url),
  'utf8',
);

test('mọi Sales Order đều có liên kết sao chép an toàn mở màn tạo đơn hiện tại ở tab mới khi có quyền tạo', () => {
  assert.doesNotMatch(detailSource, /\{order\.status === 'cancelled' \? \(/);
  assert.match(detailSource, /canCreate: boolean/);
  assert.match(detailSource, /\{props\.canCreate \? \(/);
  assert.match(workspaceSource, /canCreate=\{canCreate\}/);
  assert.match(detailSource, /quickAction: 'create'/);
  assert.match(detailSource, /copyFrom: orderId/);
  assert.match(detailSource, /href=\{salesOrderCopyHref\(order\.id\)\}/);
  assert.match(detailSource, /target="_blank"/);
  assert.match(detailSource, /rel="noopener noreferrer"/);
  assert.match(detailSource, /data-testid="sales-order-copy"/);
  assert.match(detailSource, /Sao chép đơn/);
});

test('copy prefill đọc đơn nguồn ở mọi trạng thái mà không mutate nguồn và xóa dữ liệu chỉ dành cho lần tạo cũ', () => {
  assert.match(
    formEntrySource,
    /apiRequest<SalesOrder>\(`\/api\/sales-orders\/\$\{encodeURIComponent\(copyFrom\)\}`\)/,
  );
  assert.doesNotMatch(formEntrySource, /source\.status !== 'cancelled'/);
  assert.match(formEntrySource, /activeVersion\(source\)/);
  assert.match(formEntrySource, /Đơn nguồn không còn dữ liệu phiên bản để sao chép/);
  assert.match(formEntrySource, /prepareSalesOrderCopyVersion\(sourceVersion\)/);
  assert.match(formEntrySource, /requestedDeliveryDate: null/);
  assert.match(formEntrySource, /priceSource: 'PRICE_ENGINE' as const/);
  assert.match(formEntrySource, /manualOverrideReason: null/);
  assert.match(formEntrySource, /pricingTrace: \[\]/);
  assert.doesNotMatch(formEntrySource, /localStorage|sessionStorage/);
  assert.doesNotMatch(formEntrySource, /\/clone|clone\(/i);
});

test('Xuất kho Giao thủ công ở chi tiết đơn phải xác nhận trước khi gọi action', () => {
  assert.match(detailSource, /confirmSingleStockIssue\(order\.number\)/);
  assert.match(stockIssueConfirmSource, /Xác nhận xuất kho \$\{target\}\?/);
  assert.match(stockIssueConfirmSource, /return window\.confirm/);
});

test('copied Sales Order vẫn lưu qua canonical create contract để nhận id và số đơn mới', () => {
  assert.match(formSource, /let path = '\/api\/sales-orders';\s*let method = 'POST';/);
  assert.match(
    formSource,
    /\.\.\.\(props\.mode === 'create' \? \{\} : \{ expectedRevision: version\?\.revision \}\)/,
  );
  assert.match(formSource, /sourceType: 'MANUAL'/);
});
