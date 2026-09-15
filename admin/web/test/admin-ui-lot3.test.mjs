import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Lô 3 migrates the report center to shared toolbar, KPI and state primitives', async () => {
  const [page, css] = await Promise.all([
    read('app/reports/ReportsLocal.tsx'),
    read('app/reports/report-center.module.css'),
  ]);

  for (const name of ['AdminToolbar', 'AdminFilterChip', 'AdminKpiGrid', 'AdminKpiCard', 'AdminStatePanel']) {
    assert.match(page, new RegExp(`<${name}`));
  }
  assert.match(page, /actions=\{<a className=\{styles\.toolbarAction\} href=\{exportHref\}>Xuất báo cáo Excel<\/a>\}/);
  assert.doesNotMatch(page, /styles\.periodTabs|styles\.periodTab|styles\.periodActive|styles\.kpiGrid|styles\.kpi/);
  assert.match(css, /\.reportState\{max-width:1120px/);
  assert.match(css, /@media\(min-width:761px\)[\s\S]*max-width:1120px/);
  assert.doesNotMatch(css, /\.hero\{[^}]*max-width:760px|\.reportState\{max-width:760px|\.reportKpis\{max-width:760px/);
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

test('Lô 3 keeps alerts, rules and history on shared filters, KPI, badges and states after local-first split', async () => {
  const [wrapper, page] = await Promise.all([
    read('app/alerts/page.tsx'),
    read('app/alerts/alerts-local.tsx'),
  ]);

  assert.match(wrapper, /AlertsLocal/);
  for (const name of ['AdminToolbar', 'AdminFilterChip', 'AdminKpiGrid', 'AdminKpiCard', 'AdminStatusBadge', 'AdminStatePanel']) {
    assert.match(page, new RegExp(`<${name}`));
  }
  assert.match(page, /reportPeriods\.map/);
  assert.match(page, /alertHref\(activeTab, candidate\)/);
  assert.match(page, /aria-label="Lịch sử cảnh báo"/);
  assert.match(page, /aria-label="Quy tắc cảnh báo"/);
  assert.match(page, /useAdminLocalRead<AlertCenterData>\("alerts", period\)/);
  assert.doesNotMatch(page, /alertSummaryStrip|alertSeverity|alertStatus|alertEmpty|compactWarning/);
});

test('shared mobile toolbar rails no longer need report or overview route-specific patches', async () => {
  const interaction = await read('app/admin-mobile-interaction.css');

  assert.match(interaction, /\.adminToolbarControls,[\s\S]*overflow-x:\s*auto/);
  assert.doesNotMatch(interaction, /Kỳ tổng quan|Kỳ báo cáo|Lọc theo kho/);
});
