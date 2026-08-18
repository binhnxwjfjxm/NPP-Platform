import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const confirmation = await readFile(new URL('../src/services/manual-inbound-confirmation.js', import.meta.url), 'utf8');
const historyService = await readFile(new URL('../src/services/manual-inbound-history.js', import.meta.url), 'utf8');
const historyRepository = await readFile(new URL('../src/db/repositories/manual-inbound-history.js', import.meta.url), 'utf8');
const route = await readFile(new URL('../src/routes/manual-inbound.js', import.meta.url), 'utf8');

test('Lô 3 xác nhận luôn kiểm tra lại dữ liệu server-side trước khi gọi ghi sổ canonical', () => {
  const confirmStart = confirmation.indexOf('export async function confirmManualInbound');
  const body = confirmation.slice(confirmStart);
  const preview = body.indexOf('await previewManualInbound(');
  const readiness = body.indexOf('if (!prepared.preview.ready)');
  const policy = body.indexOf('await validateManualInboundPostInventoryPolicy(');
  const posting = body.indexOf('return postManualInbound({');
  assert.ok(confirmStart >= 0 && preview > 0 && readiness > preview && policy > readiness && posting > policy);
  assert.match(confirmation, /manualInboundCostSource: row\.costSource/);
  assert.match(confirmation, /unitCost: row\.unitCost/);
  assert.doesNotMatch(confirmation, /\bINSERT\s+INTO\b/i);
  assert.doesNotMatch(confirmation, /\bUPDATE\s+inventory\./i);
  assert.match(confirmation, /postManualInbound/);
});

test('API Lô 3 có confirm và history nhưng vẫn giữ canonical POST/reverse hiện hữu', () => {
  assert.match(route, /operator\/confirm/);
  assert.match(route, /confirmManualInbound/);
  assert.match(route, /operator\/history/);
  assert.match(route, /searchManualInboundHistory/);
  assert.match(route, /validateManualInboundPostInventoryPolicy/);
  assert.match(route, /reverseManualInbound/);
});

test('lịch sử chỉ đọc trong phạm vi kho và lọc theo loại nhập hoặc số tham chiếu', () => {
  assert.match(historyService, /coreInventoryManualInboundRead/);
  assert.match(historyService, /allowedWarehouseIds/);
  assert.match(historyRepository, /document\.warehouse_id = ANY\(\$2::uuid\[\]\)/);
  assert.match(historyRepository, /document\.inbound_type = \$3/);
  assert.match(historyRepository, /document\.reference_number ILIKE/);
  assert.match(historyRepository, /to_char\(document\.document_date, 'YYYY-MM-DD'\)/);
  assert.doesNotMatch(historyRepository, /\bINSERT\s+INTO\b/i);
  assert.doesNotMatch(historyRepository, /\bUPDATE\b/i);
  assert.doesNotMatch(historyRepository, /\bDELETE\b/i);
});
