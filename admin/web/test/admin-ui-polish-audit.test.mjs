import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('UI polish maps report state to semantic badge tones instead of hard-coded success color', async () => {
  const [page, css] = await Promise.all([
    read('app/reports/page.tsx'),
    read('app/reports/report-center.module.css'),
  ]);

  assert.match(page, /function reportStatusTone\(state: ReportState\): AdminStatusTone/);
  assert.match(page, /state === 'ready'\) return 'success'/);
  assert.match(page, /state === 'partial'\) return 'attention'/);
  assert.match(page, /state === 'forbidden' \|\| state === 'error'\) return 'danger'/);
  assert.match(page, /<AdminStatusBadge tone=\{reportStatusTone\(item\.state\)\} className=\{styles\.reportStatusBadge\}>\{item\.stateLabel\}<\/AdminStatusBadge>/);
  assert.doesNotMatch(css, /\.delta\{/);
  assert.match(css, /\.reportStatusBadge\{grid-column:2;grid-row:1\/span 2;align-self:center\}/);
  assert.doesNotMatch(css, /\.reportStatusBadge\{[^}]*background:/);
});

test('UI polish removes fake period controls from alert rules and duplicate overview navigation', async () => {
  const [alerts, overview] = await Promise.all([
    read('app/alerts/page.tsx'),
    read('app/page.tsx'),
  ]);

  assert.match(alerts, /\{activeTab !== 'rules' \? \(\s*<AdminToolbar label="Kỳ cảnh báo">/);
  assert.match(alerts, /\{activeTab === 'rules' \? \(\s*<AdminKpiGrid label="Tóm tắt quy tắc cảnh báo">/);
  assert.match(alerts, /label="Quy tắc mức cao"/);
  assert.match(alerts, /label="Nhóm dữ liệu"/);
  assert.doesNotMatch(overview, /Trung tâm quản trị|adminOverviewActions|adminOverviewAction/);
  assert.match(overview, /<AdminKpiCard[\s\S]*href="\/approvals"/);
  assert.match(overview, /<AdminKpiCard[\s\S]*href="\/alerts"/);
  assert.match(overview, /<AdminKpiCard[\s\S]*href="\/reports"/);
});

test('UI polish keeps mobile controls readable while preserving the locked viewport contract', async () => {
  const [foundation, layout, interaction] = await Promise.all([
    read('app/admin-foundation.css'),
    read('app/layout.tsx'),
    read('app/admin-mobile-interaction.css'),
  ]);

  assert.match(foundation, /@media \(max-width: 760px\)[\s\S]*\.adminIconTab \{[\s\S]*min-height: 44px/);
  assert.match(foundation, /\.adminFilterChip \{ min-height: 44px; font-size: \.72rem; \}/);
  assert.match(foundation, /\.adminStatusBadge \{ min-height: 26px; font-size: \.68rem; \}/);
  assert.match(foundation, /\.adminKpiCopy > small \{ font-size: \.68rem; \}/);
  assert.match(foundation, /\.adminBottomItem span \{ font-size: \.68rem; \}/);
  assert.match(layout, /maximumScale:\s*1/);
  assert.match(layout, /userScalable:\s*false/);
  assert.match(interaction, /touch-action:\s*pan-x pan-y/);
});

test('UI polish uses local Admin branding and removes proven dead shared CSS owners', async () => {
  const [shell, login, managementCss, closeoutCss] = await Promise.all([
    read('app/admin-shell.tsx'),
    read('app/login/page.tsx'),
    read('app/admin-management-shell.css'),
    read('app/admin-closeout.css'),
  ]);

  assert.match(shell, /NEXT_PUBLIC_APP_LOGO_URL\?\.trim\(\) \|\| '\/icons\/admin-192\.png'/);
  assert.match(login, /\|\| '\/icons\/admin-192\.png'/);
  assert.doesNotMatch(shell, /office\.nguyenlieuhungphat\.com\/logo-transparent\.png/);
  assert.doesNotMatch(login, /office\.nguyenlieuhungphat\.com\/logo-transparent\.png/);

  for (const deadSelector of [
    'adminIconTabs',
    'adminIconTab',
    'approvalSummaryStrip',
    'alertSummaryStrip',
    'approvalDecisionBar',
    'overviewDecisionStrip',
    'adminOverviewActions',
    'adminOverviewAction',
    'adminModulePlaceholder',
    'adminPreviewNotice',
    'overviewPreviewNotice',
  ]) {
    assert.doesNotMatch(managementCss, new RegExp(`\\.${deadSelector}(?:\\b|\\{|,)`));
  }

  for (const deadSelector of ['approvalDecisionBar', 'approvalSummaryStrip', 'alertSummaryStrip', 'overviewDecisionStrip', 'adminIconTabs']) {
    assert.doesNotMatch(closeoutCss, new RegExp(`\\.${deadSelector}(?:\\b|\\{|,)`));
  }

  for (const liveSelector of ['overviewFocusList', 'approvalList', 'approvalDetailSection', 'alertList', 'alertComparison']) {
    assert.match(managementCss, new RegExp(`\\.${liveSelector}`));
  }
});
