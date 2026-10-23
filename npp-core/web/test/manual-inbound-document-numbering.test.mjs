import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ui = read('app/inventory/manual-inbounds/manual-inbound-workspace.tsx');
test('history loads twenty records at a time with stable cursor and no twelve-row truncation', () => {
  assert.doesNotMatch(ui, /history\.slice\(0,\s*12\)/);
  assert.match(ui, /limit: '21'/);
  assert.match(ui, /setHistoryHasMore\(data\.length > 20\)/);
  assert.match(ui, /Xem thêm 20 phiếu/);
  assert.match(ui, /beforeDocumentDate/);
  assert.match(ui, /beforeCreatedAt/);
  assert.match(ui, /beforeId/);
});
test('one canonical number is visible in history, print, reverse and Excel', () => {
  assert.match(ui, /document\.documentNumber \|\| inboundTypeLabel/);
  assert.match(ui, /Số phiếu hoặc tham chiếu/);
  assert.match(ui, /label: document\.documentNumber/);
  const p = read('app/inventory/manual-inbounds/ManualInboundPrintDock.tsx');
  assert.match(p, /number=\{document\.documentNumber \|\| '—'\}/);
  assert.match(p, /document\.referenceNumber \|\| '—'/);
  const x = read('lib/manual-inbound-export-model.ts');
  assert.match(x, /documentNumber: 'Số phiếu'/);
  assert.match(x, /key === 'documentNumber'/);
});
