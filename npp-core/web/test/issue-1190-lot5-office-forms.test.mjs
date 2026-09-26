import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), 'utf8');

test('Issue #1190 Lô 5 exposes the locked office-form library as a separate tab', () => {
  const model = read('app/operations/data-exchange/data-exchange-model.ts');
  const view = read('app/operations/data-exchange/data-exchange-view.tsx');
  assert.match(model, /'office-forms'/);
  assert.match(view, /Biểu mẫu văn phòng/);
  assert.match(view, /OfficeFormsLibrary/);
});

test('Lô 5 catalog contains exactly the 35 locked forms with 13 XLSX and 29 PDF outputs', () => {
  const source = read('app/operations/data-exchange/office-forms-library.tsx');
  const ids = [...source.matchAll(/\n\s*id: '([^']+)'/g)].map((match) => match[1]);
  assert.equal(ids.length, 35);
  assert.equal(new Set(ids).size, 35);
  assert.equal((source.match(/\n\s*xlsx: /g) ?? []).length, 13);
  assert.equal((source.match(/\n\s*pdf: /g) ?? []).length, 29);
  for (const expected of [
    'sales-order-blank','quotation-blank','customer-debt-reconciliation-blank','customer-information-blank',
    'purchase-order-blank','supplier-debt-reconciliation-blank','supplier-information-blank',
    'warehouse-receipt-blank','inventory-issue-blank','inventory-transfer-blank','stocktake-blank','inventory-adjustment-blank','picking-blank',
    'delivery-trip-blank','driver-handover-blank','cod-handover-blank','trip-reconciliation-blank','cod-reconciliation-blank',
    'leave-request-blank','overtime-request-blank','attendance-adjustment-blank','blank-timesheet-month','blank-work-schedule-month',
    'attendance-violation-explanation-blank','attendance-violation-record-blank','payroll-adjustments-blank',
  ]) assert.ok(ids.includes(expected), expected);
  assert.doesNotMatch(source, /Phiếu lương trống/);
  assert.doesNotMatch(source, /CSV/);
});

test('office forms do not fetch production master data and use static blank XLSX plus print-to-PDF surfaces', () => {
  const library = read('app/operations/data-exchange/office-forms-library.tsx');
  const workspace = read('app/operations/data-exchange/workspace.tsx');
  assert.doesNotMatch(library, /fetch\(|requestJson|\/api\/(customers|suppliers|products|inventory\/balances|employees)/);
  assert.match(library, /exportTable\(/);
  assert.match(library, /BusinessDocumentPrint/);
  assert.match(library, /PrintAction/);
  assert.match(workspace, /tab === 'office-forms'/);
  assert.match(workspace, /referenceLoadedRef/);
});

test('office forms have search and group filtering with office-language purpose text', () => {
  const source = read('app/operations/data-exchange/office-forms-library.tsx');
  assert.match(source, /Tìm biểu mẫu/);
  assert.match(source, /Nhóm nghiệp vụ/);
  assert.match(source, /Xuất dữ liệu:/);
  assert.match(source, /File mẫu nhập liệu:/);
  assert.match(source, /Biểu mẫu văn phòng:/);
  assert.doesNotMatch(source, /UUID|endpoint|schema|enum/i);
});
