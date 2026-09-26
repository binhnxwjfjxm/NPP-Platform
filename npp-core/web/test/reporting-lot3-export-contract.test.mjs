import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), 'utf8');

test('Issue #1190 Lô 3 exports exactly the five locked report groups through the shared export foundation', () => {
  const source = read('app/components/reporting-lot3-export-actions.tsx');
  assert.match(source, /OperationalExportActions/);
  assert.match(source, /bao-cao-mua-hang\.xlsx/);
  assert.match(source, /bao-cao-tuoi-no\.xlsx/);
  assert.match(source, /bao-cao-cod\.xlsx/);
  assert.match(source, /bao-cao-giao-van\.xlsx/);
  assert.match(source, /bao-cao-nhan-vien-mcp\.xlsx/);
  assert.doesNotMatch(source, /bao-cao-ban-hang|bao-cao-ton-kho|bao-cao-lai-gop/);
  assert.doesNotMatch(source, /sourceDocumentId|deliveryOrderId|tripId|sessionId|driverProfileId/);
});

test('all five Lô 3 workspaces expose the matching export action', () => {
  const expectations = [
    ['app/components/reporting-dashboard-workspace.tsx', 'PurchasingReportingExportActions'],
    ['app/components/aging-reporting-workspace.tsx', 'AgingReportingExportActions'],
    ['app/components/cod-reporting-workspace.tsx', 'CodReportingExportActions'],
    ['app/components/logistics-reporting-workspace.tsx', 'LogisticsReportingExportActions'],
    ['app/components/employee-mcp-reporting-workspace.tsx', 'EmployeeMcpReportingExportActions'],
  ];
  for (const [path, symbol] of expectations) {
    const source = read(path);
    assert.match(source, new RegExp(symbol));
  }
});


test('Lô 3 report UI keeps office wording on the touched logistics screen', () => {
  const source = read('app/components/logistics-reporting-workspace.tsx');
  assert.doesNotMatch(source, /canonical|Coverage SLA|Partial \/ failed|Return receipt POSTED|Generated at|source ID|reason code/);
  assert.match(source, /Giao một phần \/ thất bại \/ hẹn lại/);
  assert.match(source, /Phiếu nhận hàng trả đã ghi sổ/);
});
