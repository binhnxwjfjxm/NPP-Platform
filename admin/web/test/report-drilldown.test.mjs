import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const detailPath = new URL('../app/reports/[reportId]/page.tsx', import.meta.url);
const drilldownPath = new URL('../app/reports/report-drilldown.ts', import.meta.url);

test('Admin report detail exposes management drill-down from existing reporting families', async () => {
  const [detail, drilldown] = await Promise.all([
    readFile(detailPath, 'utf8'),
    readFile(drilldownPath, 'utf8'),
  ]);

  assert.match(detail, /loadReportDrilldown/);
  assert.match(detail, /DrilldownNodeView/);
  assert.match(drilldown, /Khách hàng → đơn bán/);
  assert.match(drilldown, /Đối tượng → chứng từ công nợ/);
  assert.match(drilldown, /Nhân viên → tuyến → phiên → điểm bán/);
  assert.match(drilldown, /Tài xế → chuyến → lần giao/);

  for (const endpoint of [
    '/api/reporting/sales',
    '/api/reporting/aging',
    '/api/reporting/employee-mcp',
    '/api/reporting/logistics',
  ]) {
    assert.match(drilldown, new RegExp(endpoint.replaceAll('/', '\\/')));
  }
});

test('Admin drill-down remains read-only and does not infer MCP location compliance', async () => {
  const drilldown = await readFile(drilldownPath, 'utf8');

  assert.match(drilldown, /requestCore/);
  assert.doesNotMatch(drilldown, /method:\s*['"]POST['"]|Idempotency-Key|executeRequestWithIdempotency/);
  assert.doesNotMatch(drilldown, /Đúng vị trí|Cần kiểm tra vị trí|gian lận|geofence/i);
  assert.doesNotMatch(drilldown, /checkinLat|checkinLng|geoLat|geoLng|geoAccuracy/i);
});

test('Admin debt drill-down keeps current-snapshot semantics', async () => {
  const drilldown = await readFile(drilldownPath, 'utf8');

  assert.match(drilldown, /source\('\/api\/reporting\/aging'\)/);
  assert.doesNotMatch(drilldown, /withRange\('\/api\/reporting\/aging'/);
});
