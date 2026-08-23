import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('MCP supervision uses flat large-data navigation instead of nested cards', async () => {
  const [supervision, detail, css] = await Promise.all([
    read('app/reports/mcp-supervision.tsx'),
    read('app/reports/[reportId]/page.tsx'),
    read('app/reports/report-center.module.css'),
  ]);

  assert.match(detail, /domain === 'mcp' \? Promise\.resolve\(null\) : loadReportDrilldown/);
  assert.match(detail, /title="Giám sát MCP"/);
  assert.match(detail, /<McpSupervision period=\{period\} searchParams=\{searchParams\}/);

  assert.match(supervision, /const PAGE_SIZE = 25/);
  assert.match(supervision, /\['overview', 'people', 'routes', 'outlets', 'anomalies'\]/);
  assert.match(supervision, /Xem chi tiết/);
  assert.match(supervision, /Xem điểm bán/);
  assert.match(supervision, /Xem chi tiết check-in/);
  assert.match(supervision, /Vị trí đã ghi nhận/);
  assert.match(supervision, /không phải định vị trực tiếp/);
  assert.match(supervision, /name="q"/);
  assert.match(supervision, /name="status"/);
  assert.match(supervision, /filteredOutlets\.slice\(\(page - 1\) \* PAGE_SIZE, page \* PAGE_SIZE\)/);
  assert.doesNotMatch(supervision, /<details|drilldownChildren|drilldownNode/);

  assert.match(css, /\.mcpRows\{/);
  assert.match(css, /\.mcpRowActions a\{/);
  assert.match(css, /\.mcpPagination\{/);
  assert.match(css, /\.mcpMapPanel\{/);
});

test('MCP supervision remains read-only and does not invent unsupported realtime or media facts', async () => {
  const supervision = await read('app/reports/mcp-supervision.tsx');

  assert.match(supervision, /requestCore<unknown>/);
  assert.match(supervision, /\/api\/reporting\/mcp-supervision/);
  assert.doesNotMatch(supervision, /method:\s*['"]POST['"]|Idempotency-Key|executeRequestWithIdempotency/);
  assert.match(supervision, /Không có trong báo cáo hiện tại/);
  assert.match(supervision, /chưa cung cấp ảnh bằng chứng trong contract này/);
  assert.doesNotMatch(supervision, /định vị thời gian thực|vị trí hiện tại của nhân viên/i);
});
