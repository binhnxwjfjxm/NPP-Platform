import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = async (path) => readFile(new URL(path, root), 'utf8');

test('MCP report uses a dedicated scalable management experience instead of the nested drill-down tree', async () => {
  const [detail, supervision] = await Promise.all([
    read('app/reports/[reportId]/page.tsx'),
    read('app/reports/mcp-supervision.tsx'),
  ]);

  assert.match(detail, /if \(domain === 'mcp'\)/);
  assert.match(detail, /title="Giám sát MCP"/);
  assert.match(detail, /<McpSupervision/);
  assert.ok(detail.indexOf("if (domain === 'mcp')") < detail.indexOf('loadReportDrilldown(domain, period)'), 'MCP must bypass the generic nested drill-down');

  for (const view of ['overview', 'people', 'person', 'routes', 'outlets', 'outlet', 'checkin', 'map', 'anomalies']) {
    assert.match(supervision, new RegExp(`'${view}'`));
  }

  assert.doesNotMatch(supervision, /drilldownNode|drilldownChildren|<details/);
  assert.match(supervision, /PAGE_SIZE = 25/);
  assert.match(supervision, /paginate\(/);
  assert.match(supervision, /latestOutletRows/);
  assert.match(supervision, /Tìm tên hoặc địa chỉ điểm bán/);
});

test('MCP report makes every interactive affordance explicit in office language', async () => {
  const supervision = await read('app/reports/mcp-supervision.tsx');

  for (const action of [
    'Xem nhân viên',
    'Xem tuyến',
    'Xem điểm bán',
    'Xem chi tiết',
    'Xem chi tiết check-in',
    'Bản đồ tuyến',
    'Mở cảnh báo',
    'Tìm kiếm',
  ]) {
    assert.match(supervision, new RegExp(action));
  }

  assert.doesNotMatch(supervision, /aria-label="[^"]*(icon|biểu tượng)/i);
  assert.doesNotMatch(supervision, /NPP Core|backend|endpoint|payload|contract/i);
});

test('MCP route map uses recorded GPS only and never pretends to be realtime tracking', async () => {
  const supervision = await read('app/reports/mcp-supervision.tsx');

  for (const field of [
    'outletLat',
    'outletLng',
    'checkinLat',
    'checkinLng',
    'outletAccuracy',
    'checkinAccuracy',
    'distanceMeters',
    'uncertaintyMeters',
  ]) {
    assert.match(supervision, new RegExp(field));
  }

  assert.match(supervision, /Hệ thống hiện chưa có định vị nhân viên theo thời gian thực/);
  assert.match(supervision, /Sơ đồ tương đối các vị trí GPS trên tuyến/);
  assert.match(supervision, /google\.com\/maps\/search/);
  assert.doesNotMatch(supervision, /vị trí hiện tại|đang đứng tại|live tracking/i);
});

test('MCP report mobile layout is flat, readable and keeps actions visible', async () => {
  const css = await read('app/reports/mcp-supervision.module.css');

  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /\.listRow\{display:grid;grid-template-columns:minmax\(0,1fr\) auto auto/);
  assert.match(css, /@media\(max-width:760px\)\{[\s\S]*?\.listRow\{grid-template-columns:1fr/);
  assert.match(css, /\.rowActions \.primaryAction,\.rowActions \.secondaryAction\{flex:1 1 140px\}/);
  assert.match(css, /\.detailGrid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:760px\)\{[\s\S]*?\.detailGrid\{grid-template-columns:1fr\}/);
  assert.doesNotMatch(css, /drilldownChildren|margin-left:\.45rem|padding-left:\.55rem/);
});

test('MCP report remains read-only and preserves permission/error handling', async () => {
  const supervision = await read('app/reports/mcp-supervision.tsx');

  assert.match(supervision, /\/api\/reporting\/mcp-supervision/);
  assert.match(supervision, /statusCode === 403/);
  assert.match(supervision, /không có quyền xem giám sát MCP/);
  assert.doesNotMatch(supervision, /method:\s*['"]POST['"]|Idempotency-Key|executeRequestWithIdempotency/);
  assert.match(supervision, /Phù hợp vùng sai số GPS|Vị trí phù hợp/);
  assert.match(supervision, /Cần kiểm tra vị trí/);
  assert.match(supervision, /Chưa đủ bằng chứng vị trí/);
  assert.match(supervision, /Chưa check-in/);
});
