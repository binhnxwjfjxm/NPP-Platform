import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('MCP supervision is the Lô 2 reference implementation for shared Admin layout', async () => {
  const [supervision, css] = await Promise.all([
    read('app/reports/mcp-supervision.tsx'),
    read('app/reports/mcp-supervision.module.css'),
  ]);

  for (const primitive of [
    'AdminIconTabs',
    'AdminToolbar',
    'AdminFilterChip',
    'AdminKpiGrid',
    'AdminKpiCard',
    'AdminStatusBadge',
    'AdminStatePanel',
  ]) {
    assert.match(supervision, new RegExp(`<${primitive}|${primitive},`));
  }

  for (const icon of ["icon: 'overview'", "icon: 'user'", "icon: 'truck'", "icon: 'branch'", "icon: 'exception'"]) {
    assert.match(supervision, new RegExp(icon.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(supervision, /label="Báo cáo MCP"/);
  assert.match(supervision, /label="Kỳ xem báo cáo MCP"/);
  assert.match(supervision, /label="Lọc trạng thái điểm bán"/);
  assert.match(supervision, /label="Lọc loại bất thường"/);
  assert.match(supervision, /className=\{`adminToolbar \$\{styles\.searchBar\}`\}/);

  assert.doesNotMatch(supervision, /styles\.tabBar|styles\.tabActive|styles\.periodBar|styles\.periodChoice|styles\.filterChip|styles\.badge|styles\.kpiCard|styles\.kpiGrid/);
  assert.doesNotMatch(css, /\.tabBar|\.tabActive|\.periodBar|\.periodChoice|\.filterChip|\.badgeOk|\.badgeDanger|\.kpiCard|\.kpiGrid/);
  assert.match(css, /\.experience\{width:100%/);
});

test('MCP reference keeps large-data, drill-down, GPS and read-only behavior intact', async () => {
  const supervision = await read('app/reports/mcp-supervision.tsx');

  assert.match(supervision, /const PAGE_SIZE = 25/);
  assert.match(supervision, /const ANOMALY_PAGE_SIZE = 20/);
  assert.match(supervision, /name="q"/);
  assert.match(supervision, /name="status"/);
  assert.match(supervision, /view: 'person'/);
  assert.match(supervision, /view: 'outlet'/);
  assert.match(supervision, /view: 'checkin'/);
  assert.match(supervision, /view: 'map'/);
  assert.match(supervision, /Hệ thống hiện chưa có định vị nhân viên theo thời gian thực/);
  assert.match(supervision, /Dữ liệu giám sát · chỉ xem/);
  assert.doesNotMatch(supervision, /method:\s*['"]POST['"]|Idempotency-Key|executeRequestWithIdempotency/);
});
