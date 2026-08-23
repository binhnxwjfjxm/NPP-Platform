import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const overviewPagePath = new URL('../app/page.tsx', import.meta.url);
const reportPagePath = new URL('../app/reports/page.tsx', import.meta.url);
const detailPagePath = new URL('../app/reports/[reportId]/page.tsx', import.meta.url);
const reportDataPath = new URL('../app/reports/report-data.ts', import.meta.url);

test('Admin reports use live Company reporting sources instead of preview fixtures', async () => {
  const [overview, page, detail, data] = await Promise.all([
    readFile(overviewPagePath, 'utf8'),
    readFile(reportPagePath, 'utf8'),
    readFile(detailPagePath, 'utf8'),
    readFile(reportDataPath, 'utf8'),
  ]);

  assert.doesNotMatch(overview, /reports\/report-preview-data/);
  assert.match(overview, /Số liệu Công Ty đã sẵn sàng/);
  assert.doesNotMatch(page, /report-preview-data|Dữ liệu minh họa/);
  assert.doesNotMatch(detail, /report-preview-data|Dữ liệu minh họa/);
  assert.doesNotMatch(data, /\b4,82 tỷ\b|\b902 triệu\b/);

  for (const endpoint of [
    '/api/reporting/control-tower',
    '/api/reporting/sales',
    '/api/reporting/gross-margin',
    '/api/reporting/aging',
    '/api/reporting/inventory',
    '/api/reporting/logistics',
    '/api/reporting/cod',
    '/api/reporting/employee-mcp',
    '/api/management-proposals',
    '/api/reporting/admin-alerts',
  ]) {
    assert.match(data, new RegExp(endpoint.replaceAll('/', '\\/')));
  }
});

test('Admin report periods follow Vietnam business time and debt stays a current snapshot', async () => {
  const data = await readFile(reportDataPath, 'utf8');

  assert.match(data, /timeZone: 'Asia\/Ho_Chi_Minh'/);
  assert.match(data, /loadSource\('\/api\/reporting\/aging'\)/);
  assert.doesNotMatch(data, /withRange\('\/api\/reporting\/aging'/);
  assert.match(data, /Số dư hiện tại/);
});

test('Admin reports preserve partial, forbidden and unavailable states without zero fallbacks', async () => {
  const data = await readFile(reportDataPath, 'utf8');

  assert.match(data, /Promise\.all\(/);
  assert.match(data, /statusCode === 403/);
  assert.match(data, /Dữ liệu chưa đầy đủ/);
  assert.match(data, /Không có quyền/);
  assert.match(data, /Đề xuất và cảnh báo quản trị của Công Ty/);
  assert.match(data, /proposalSource\.ok \? String\(pending\) : 'Chưa có dữ liệu'/);
  assert.match(data, /alertSource\.ok \? String\(openAlerts\) : 'Chưa có dữ liệu'/);
});
