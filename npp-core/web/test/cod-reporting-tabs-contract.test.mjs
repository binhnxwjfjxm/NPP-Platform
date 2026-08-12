import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('COD reporting keeps operational context above five business tabs', () => {
  const workspace = source('../app/components/cod-reporting-workspace.tsx');

  assert.match(workspace, /type CodReportTab =[\s\S]*'custody'[\s\S]*'collections'[\s\S]*'handover'[\s\S]*'promises'[\s\S]*'exceptions'/);
  assert.match(workspace, /\{ id: 'custody', label: 'Tài xế giữ tiền' \}/);
  assert.match(workspace, /\{ id: 'collections', label: 'Thu trong kỳ' \}/);
  assert.match(workspace, /\{ id: 'handover', label: 'Bàn giao & kế toán' \}/);
  assert.match(workspace, /\{ id: 'promises', label: 'Hẹn thu quá hạn' \}/);
  assert.match(workspace, /\{ id: 'exceptions', label: 'Ngoại lệ' \}/);
  assert.match(workspace, /useState<CodReportTab>\('custody'\)/);

  const filterIndex = workspace.indexOf('<form className={styles.filters}');
  const noticeIndex = workspace.indexOf('<p className={styles.notice}>');
  const cardsIndex = workspace.indexOf('<section className={styles.cards}');
  const tabsIndex = workspace.indexOf('<WorkspaceTabs');

  assert.ok(filterIndex >= 0 && filterIndex < tabsIndex);
  assert.ok(noticeIndex >= 0 && noticeIndex < tabsIndex);
  assert.ok(cardsIndex >= 0 && cardsIndex < tabsIndex);
});

test('COD reporting renders only the selected detail panel and groups handover lifecycle together', () => {
  const workspace = source('../app/components/cod-reporting-workspace.tsx');

  for (const tabId of ['custody', 'collections', 'handover', 'promises', 'exceptions']) {
    assert.match(workspace, new RegExp(`<WorkspaceTabPanel\\s+tabId="${tabId}"`));
  }

  const handoverPanel = workspace.match(
    /<WorkspaceTabPanel\s+tabId="handover"[\s\S]*?<\/WorkspaceTabPanel>/,
  )?.[0] ?? '';

  assert.match(handoverPanel, /Bàn giao trong kỳ/);
  assert.match(handoverPanel, /Kế toán tiếp nhận trong kỳ/);
  assert.match(handoverPanel, /Bàn giao chờ kế toán tiếp nhận/);
  assert.match(handoverPanel, /report\?\.activity\.handovers/);
  assert.match(handoverPanel, /report\?\.activity\.acceptances/);
  assert.match(handoverPanel, /report\?\.currentSnapshot\.pendingHandovers/);
});

test('COD reporting preserves canonical GET filters, drill-downs and selected tab while refetching', () => {
  const workspace = source('../app/components/cod-reporting-workspace.tsx');

  assert.match(workspace, /\/api\/reporting\/cod/);
  assert.match(workspace, /\{ cache: 'no-store' \}/);
  assert.match(workspace, /params\.set\('from', next\.from\)/);
  assert.match(workspace, /params\.set\('to', next\.to\)/);
  assert.match(workspace, /params\.set\('warehouseId', next\.warehouseId\)/);
  assert.doesNotMatch(workspace, /setActiveTab\(/);
  assert.match(workspace, /href="\/accounting\/cod-reconciliation"/);
  assert.match(workspace, /href="\/accounting\/reconciliation"/);
});

test('COD reporting reuses the shared accessible workspace tab primitive', () => {
  const workspace = source('../app/components/cod-reporting-workspace.tsx');
  const tabs = source('../app/components/workspace-tabs.tsx');

  assert.match(workspace, /from '\.\/workspace-tabs'/);
  assert.match(workspace, /<WorkspaceTabs/);
  assert.match(workspace, /<WorkspaceTabPanel/);
  assert.match(tabs, /role="tablist"/);
  assert.match(tabs, /role="tab"/);
  assert.match(tabs, /role="tabpanel"/);
  assert.match(tabs, /if \(activeTab !== tabId\) return null/);
});
