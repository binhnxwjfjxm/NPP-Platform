import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../app/inventory/opening-balances/page.tsx', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('../app/inventory/opening-balances/opening-balance-csv-workspace.tsx', import.meta.url), 'utf8');

test('opening balance page uses CSV workspace instead of the legacy JSON form', () => {
  assert.match(page, /OpeningBalanceCsvWorkspace/);
  assert.match(page, /initialError/);
  assert.doesNotMatch(page, /InventoryWorkspace/);
  assert.doesNotMatch(page, /InventoryLot3Boundary/);
  assert.doesNotMatch(workspace, /inventory-opening-metadata-input/);
  assert.doesNotMatch(workspace, /inventory-opening-rows-input/);
  assert.doesNotMatch(workspace, /textarea/);
});

test('CSV flow has template, file selection, preview, validation and posting gates', () => {
  assert.match(workspace, /Tải mẫu Excel\/CSV/);
  assert.match(workspace, /inventory-opening-file-input/);
  assert.match(workspace, /Xem trước dữ liệu/);
  assert.match(workspace, /Kiểm tra tệp/);
  assert.match(workspace, /Xác nhận nhập tồn/);
  assert.match(workspace, /validation\.rowErrors\.length\s*>\s*0/);
  assert.match(workspace, /!validationChecksum/);
});

test('CSV validation is bound to the current draft and ignores stale responses', () => {
  assert.match(workspace, /draftRevision/);
  assert.match(workspace, /revision !== draftRevision\.current/);
  assert.match(workspace, /contentChecksum !== validationChecksum/);
  assert.match(workspace, /invalidateDraft\(\)/);
});

test('CSV errors and history remain actionable', () => {
  assert.match(workspace, /localErrors\.map/);
  assert.match(workspace, /item\.lineNumber \+ 1/);
  assert.match(workspace, /\/api\/inventory\/opening-balances\?limit=200/);
  assert.match(workspace, /Không tải được lịch sử nhập tồn đầu kỳ/);
});
