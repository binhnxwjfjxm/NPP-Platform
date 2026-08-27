import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { openingBalanceInternals } from '../src/services/opening-balance.js';
import { inventoryLedgerInternals } from '../src/services/inventory-ledger-core.js';

const WAREHOUSE_ID = '11111111-1111-4111-8111-111111111111';

function variantId(index) {
  return `22222222-2222-4222-8222-${index.toString(16).padStart(12, '0')}`;
}

function openingRows(count) {
  return Array.from({ length: count }, (_, index) => ({
    warehouseId: WAREHOUSE_ID,
    sourceVariantId: variantId(index + 1),
    sourceQuantity: '1',
    metadata: {},
  }));
}

function openingPayload(count) {
  return {
    sourceKey: 'TONDAUKY-TEST',
    contentChecksum: 'a'.repeat(64),
    documentDate: '2026-08-27',
    metadata: {},
    rows: openingRows(count),
  };
}

function movementPayload(count) {
  return {
    movementType: 'OPENING_BALANCE',
    documentDate: '2026-08-27',
    metadata: {},
    lines: openingRows(count),
  };
}

test('tồn đầu kỳ nhận một tệp đến 1000 dòng và chặn vượt giới hạn', () => {
  const accepted = openingBalanceInternals.normalizeRequestBody(openingPayload(1000));
  assert.equal(accepted.ok, true);
  assert.equal(accepted.value.rows.length, 1000);

  const rejected = openingBalanceInternals.normalizeRequestBody(openingPayload(1001));
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'INVALID_ROWS');
});

test('sổ kho nhận movement tồn đầu kỳ đến 1000 dòng và chặn vượt giới hạn', () => {
  const accepted = inventoryLedgerInternals.normalizePostingPayload(movementPayload(1000));
  assert.equal(accepted.ok, true);
  assert.equal(accepted.value.lines.length, 1000);

  const rejected = inventoryLedgerInternals.normalizePostingPayload(movementPayload(1001));
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'INVALID_LINES');
});

test('giao diện tồn kho tải đủ các trang dữ liệu và chỉ phân trang phần hiển thị', async () => {
  const snapshotPath = fileURLToPath(new URL('../../web/lib/inventory-scoped-snapshot.ts', import.meta.url));
  const balancesPath = fileURLToPath(new URL('../../web/app/inventory/balances/inventory-balances-workspace.tsx', import.meta.url));
  const [snapshot, balances] = await Promise.all([
    readFile(snapshotPath, 'utf8'),
    readFile(balancesPath, 'utf8'),
  ]);

  assert.match(snapshot, /INVENTORY_BALANCE_BATCH_SIZE = 1000/);
  assert.match(snapshot, /offset: String\(offset\)/);
  assert.match(snapshot, /listAllInventoryBalances/);
  assert.match(balances, /loadAllBalances/);
  assert.match(balances, /INVENTORY_TABLE_PAGE_SIZE = 100/);
  assert.match(balances, /limit=\$\{INVENTORY_BALANCE_BATCH_SIZE\}&offset=\$\{offset\}/);
  assert.match(balances, /filteredBalances\.slice\(pageStart, pageStart \+ INVENTORY_TABLE_PAGE_SIZE\)/);
});

test('preview tồn đầu kỳ phân trang toàn bộ file thay vì cắt cố định 100 dòng', async () => {
  const workspacePath = fileURLToPath(new URL('../../web/app/inventory/opening-balances/opening-balance-csv-workspace.tsx', import.meta.url));
  const operatorPath = fileURLToPath(new URL('../src/routes/opening-balance-operator.js', import.meta.url));
  const [workspace, operator] = await Promise.all([
    readFile(workspacePath, 'utf8'),
    readFile(operatorPath, 'utf8'),
  ]);

  assert.match(workspace, /OPENING_BALANCE_PREVIEW_PAGE_SIZE = 100/);
  assert.match(workspace, /const index = previewStart \+ pageIndex/);
  assert.match(workspace, /Đang xem \{previewStart \+ 1\}–\{previewEnd\} \/ \{rows\.length\}/);
  assert.doesNotMatch(workspace, /effectiveRows\.slice\(0, 100\)/);
  assert.match(operator, /OPENING_BALANCE_MAX_ROWS = 1000/);
  assert.match(operator, /payload\.rows\.length > OPENING_BALANCE_MAX_ROWS/);
});

test('Xuất kho giữ cùng khóa chống ghi trùng khi retry và movement OUT trừ tồn đúng một lần', async () => {
  const workspacePath = fileURLToPath(new URL('../../web/app/sales/sales-orders/SalesOrderWorkspace.tsx', import.meta.url));
  const routePath = fileURLToPath(new URL('../src/routes/sales-orders.js', import.meta.url));
  const issuePath = fileURLToPath(new URL('../src/services/sales-direct-stock-issue.js', import.meta.url));
  const projectorPath = fileURLToPath(new URL('../../../database/migrations/inventory/018_inventory_balance_read_model.sql', import.meta.url));
  const [workspace, route, issue, projector] = await Promise.all([
    readFile(workspacePath, 'utf8'),
    readFile(routePath, 'utf8'),
    readFile(issuePath, 'utf8'),
    readFile(projectorPath, 'utf8'),
  ]);

  assert.match(workspace, /stockIssueKeyRef\.current/);
  assert.match(workspace, /existing\?\.orderId === selected\.id && existing\.stateKey === actionStateKey/);
  assert.match(workspace, /\? existing\.key\s*:\s*mutationKey\('sales-manual-stock-issue'\)/);
  assert.match(route, /action === 'issue-stock' && method === 'POST'/);
  assert.match(route, /executeIdempotentMutation\(req, res, options/);
  assert.match(issue, /movementType: 'SALES_DELIVERY_ISSUE'/);
  assert.match(issue, /direction: 'OUT'/);
  assert.match(projector, /on_hand_quantity = inventory\.inventory_balances\.on_hand_quantity \+ EXCLUDED\.on_hand_quantity/);
});
