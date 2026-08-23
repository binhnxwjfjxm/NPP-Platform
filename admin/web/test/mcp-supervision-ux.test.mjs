import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('MCP supervision uses flat large-data navigation instead of nested cards', async () => {
  const [supervision, detail, css] = await Promise.all([
    read('app/reports/mcp-supervision.tsx'),
    read('app/reports/[reportId]/page.tsx'),
    read('app/reports/mcp-supervision.module.css'),
  ]);

  assert.match(detail, /if \(domain === 'mcp'\)/);
  assert.match(detail, /title="Giám sát MCP"/);
  assert.match(detail, /<McpSupervision/);
  assert.ok(detail.indexOf("if (domain === 'mcp')") < detail.indexOf('loadLotCDrilldown(domain, period, warehouseId)'), 'MCP must bypass the generic nested drill-down');

  assert.match(supervision, /const PAGE_SIZE = 25/);
  for (const label of ['Tổng quan', 'Nhân viên', 'Tuyến', 'Điểm bán', 'Bất thường']) assert.match(supervision, new RegExp(label));
  assert.match(supervision, /Xem chi tiết/);
  assert.match(supervision, /Xem điểm bán/);
  assert.match(supervision, /Xem chi tiết check-in/);
  assert.match(supervision, /Bản đồ tuyến/);
  assert.match(supervision, /GPS.*đã ghi nhận/s);
  assert.match(supervision, /chưa có định vị nhân viên theo thời gian thực/);
  assert.match(supervision, /name="q"/);
  assert.match(supervision, /name="status"/);
  assert.match(supervision, /paginate\(filtered, requestedPage, PAGE_SIZE\)/);
  assert.doesNotMatch(supervision, /<details|drilldownChildren|drilldownNode/);

  assert.match(css, /\.listRow\{/);
  assert.match(css, /\.rowActions/);
  assert.match(css, /\.pagination\{/);
  assert.match(css, /\.mapCanvas\{/);
});

test('MCP supervision remains read-only and does not invent unsupported realtime facts', async () => {
  const supervision = await read('app/reports/mcp-supervision.tsx');

  assert.match(supervision, /requestCore<unknown>/);
  assert.match(supervision, /\/api\/reporting\/mcp-supervision/);
  assert.doesNotMatch(supervision, /method:\s*['"]POST['"]|Idempotency-Key|executeRequestWithIdempotency/);
  assert.match(supervision, /Kết luận vị trí dựa trên tọa độ và độ chính xác GPS do hệ thống ghi nhận/);
  assert.match(supervision, /Hệ thống hiện chưa có định vị nhân viên theo thời gian thực/);
  assert.doesNotMatch(supervision, /vị trí hiện tại của nhân viên|đang đứng tại/i);
});
