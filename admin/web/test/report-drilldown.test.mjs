import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const detailPath = new URL('../app/reports/[reportId]/page.tsx', import.meta.url);
const drilldownPath = new URL('../app/reports/report-drilldown.ts', import.meta.url);
const supervisionPath = new URL('../app/reports/mcp-supervision.tsx', import.meta.url);

test('Admin report detail exposes management drill-down from existing reporting families', async () => {
  const [detail, drilldown] = await Promise.all([
    readFile(detailPath, 'utf8'),
    readFile(drilldownPath, 'utf8'),
  ]);

  assert.match(detail, /loadReportDrilldown/);
  assert.match(detail, /DrilldownNodeView/);
  assert.match(drilldown, /Khách hàng → đơn bán/);
  assert.match(drilldown, /Đối tượng → chứng từ công nợ/);
  assert.match(drilldown, /Nhân viên → tuyến → khách → phiên → check-in/);
  assert.match(drilldown, /Tài xế → chuyến → lần giao/);

  for (const endpoint of [
    '/api/reporting/sales',
    '/api/reporting/aging',
    '/api/reporting/mcp-supervision',
    '/api/reporting/logistics',
  ]) {
    assert.match(drilldown, new RegExp(endpoint.replaceAll('/', '\\/')));
  }
});

test('Admin MCP drill-down stays read-only, fails cleanly without permission, and displays server-approved GPS evidence', async () => {
  const [drilldown, supervision] = await Promise.all([
    readFile(drilldownPath, 'utf8'),
    readFile(supervisionPath, 'utf8'),
  ]);

  assert.match(drilldown, /requestCore/);
  assert.doesNotMatch(drilldown, /method:\s*['"]POST['"]|Idempotency-Key|executeRequestWithIdempotency/);
  assert.match(drilldown, /statusCode === 403/);
  assert.match(drilldown, /không có quyền xem phần chi tiết này/);
  assert.match(supervision, /statusCode === 403/);
  assert.match(supervision, /không có quyền xem giám sát MCP/);
  assert.match(drilldown, /Phù hợp vùng sai số GPS/);
  assert.match(drilldown, /Cần kiểm tra vị trí/);
  assert.match(drilldown, /Chưa đủ bằng chứng vị trí/);
  assert.match(drilldown, /Chưa check-in/);
  for (const field of [
    'outletLat',
    'outletLng',
    'outletAccuracy',
    'outletGeoSource',
    'checkinLat',
    'checkinLng',
    'checkinAccuracy',
    'checkinSource',
    'distanceMeters',
    'uncertaintyMeters',
  ]) {
    assert.match(drilldown, new RegExp(field));
  }
  assert.doesNotMatch(drilldown, /gian lận|vi phạm|giả mạo|geofence/i);
});

test('Admin MCP anomaly supervision links to canonical alert detail', async () => {
  const supervision = await readFile(supervisionPath, 'utf8');

  assert.match(supervision, /\/alerts\/\$\{encodeURIComponent\(alertId\)\}/);
  assert.match(supervision, />Mở cảnh báo</);
  assert.match(supervision, /locationLabel/);
});

test('Admin debt drill-down keeps current-snapshot semantics', async () => {
  const drilldown = await readFile(drilldownPath, 'utf8');

  assert.match(drilldown, /source\('\/api\/reporting\/aging'\)/);
  assert.doesNotMatch(drilldown, /withRange\('\/api\/reporting\/aging'/);
});
