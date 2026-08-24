import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Lô 3 migrates the report center to shared toolbar, KPI and state primitives', async () => {
  const [page, css] = await Promise.all([
    read('app/reports/page.tsx'),
    read('app/reports/report-center.module.css'),
  ]);

  for (const name of ['AdminToolbar', 'AdminFilterChip', 'AdminKpiGrid', 'AdminKpiCard', 'AdminStatePanel']) {
    assert.match(page, new RegExp(`<${name}`));
  }
  assert.match(page, /actions=\{<a className=\{styles\.toolbarAction\} href=\{exportHref\}>Xuất Excel<\/a>\}/);
  assert.doesNotMatch(page, /styles\.periodTabs|styles\.periodTab|styles\.periodActive|styles\.kpiGrid|styles\.kpi/);
  assert.match(css, /\.reportState\{max-width:1120px/);
  assert.match(css, /@media\(min-width:761px\)[\s\S]*max-width:1120px/);
  assert.doesNotMatch(css, /max-width:760px/);
});

test('Lô 3 keeps report drill-down facts but uses shared state and KPI chrome', async () => {
  const page = await read('app/reports/[reportId]/page.tsx');

  assert.match(page, /contentWidth="special"/);
  assert.match(page, /<AdminStatusBadge tone="info">\{item\.source\}<\/AdminStatusBadge>/);
  assert.match(page, /<AdminStatePanel[\s\S]*title=\{item\.stateLabel\}[\s\S]*tone=\{stateTone\(item\.state\)\}/);
  assert.match(page, /<AdminKpiGrid label="Chỉ số quản trị"/);
  assert.match(page, /<DrilldownNodeView/);
  assert.match(page, /<McpSupervision/);
  assert.doesNotMatch(page, /styles\.detailMetrics|styles\.detailMetric|styles\.sourceBadge/);
});

test('Lô 3 migrates alerts, rules and history to shared filters, KPI, badges and states', async () => {
  const page = await read('app/alerts/page.tsx');

  for (const name of ['AdminToolbar', 'AdminFilterChip', 'AdminKpiGrid', 'AdminKpiCard', 'AdminStatusBadge', 'AdminStatePanel']) {
    assert.match(page, new RegExp(`<${name}`));
  }
  assert.match(page, /reportPeriods\.map/);
  assert.match(page, /alertHref\(activeTab, candidate\)/);
  assert.match(page, /aria-label="Lịch sử cảnh báo"/);
  assert.match(page, /aria-label="Quy tắc cảnh báo"/);
  assert.doesNotMatch(page, /alertSummaryStrip|alertSeverity|alertStatus|alertEmpty|compactWarning/);
});

test('Lô 3 removes report-specific mobile rail patches after moving filters into AdminToolbar', async () => {
  const interaction = await read('app/admin-mobile-interaction.css');

  assert.match(interaction, /\.adminToolbarControls,[\s\S]*overflow-x:\s*auto/);
  assert.match(interaction, /aria-label="Kỳ tổng quan"/);
  assert.doesNotMatch(interaction, /Kỳ báo cáo|Lọc theo kho/);
});
