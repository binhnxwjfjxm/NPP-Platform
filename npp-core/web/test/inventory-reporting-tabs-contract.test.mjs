import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('inventory reporting keeps global context above six business tabs', () => {
  const workspace = source('../app/components/inventory-reporting-workspace.tsx');

  assert.match(workspace, /type InventoryReportTab =[\s\S]*'overview'[\s\S]*'positions'[\s\S]*'movement'[\s\S]*'slow-moving'[\s\S]*'lots'[\s\S]*'exceptions'/);
  assert.match(workspace, /\{ id: 'overview', label: 'Tổng quan' \}/);
  assert.match(workspace, /\{ id: 'positions', label: 'Tồn hiện tại' \}/);
  assert.match(workspace, /\{ id: 'movement', label: 'Luân chuyển' \}/);
  assert.match(workspace, /\{ id: 'slow-moving', label: 'Chậm luân chuyển' \}/);
  assert.match(workspace, /\{ id: 'lots', label: 'Lô & hạn dùng' \}/);
  assert.match(workspace, /\{ id: 'exceptions', label: 'Cần kiểm tra' \}/);
  assert.match(workspace, /useState<InventoryReportTab>\('overview'\)/);
  assert.match(workspace, /<form className=\{styles\.filters\}/);
  assert.match(workspace, /<div className=\{styles\.cards\}>/);
  assert.match(workspace, /<div className=\{styles\.statusStrip\}>/);
  assert.match(workspace, /<WorkspaceTabs/);
  assert.doesNotMatch(workspace, /label: 'Ngoại lệ'/);
});

test('inventory reporting renders only the selected detail panel and groups movement views together', () => {
  const workspace = source('../app/components/inventory-reporting-workspace.tsx');

  for (const tabId of ['overview', 'positions', 'movement', 'slow-moving', 'lots', 'exceptions']) {
    assert.match(workspace, new RegExp(`<WorkspaceTabPanel\\s+[\\s\\S]*?tabId="${tabId}"`));
  }

  const movementPanel = workspace.match(
    /<WorkspaceTabPanel\s+tabId="movement"[\s\S]*?<\/WorkspaceTabPanel>/,
  )?.[0] ?? '';

  assert.match(movementPanel, /Nhập – xuất – tồn theo kỳ/);
  assert.match(movementPanel, /Loại nghiệp vụ trong kỳ/);
  assert.match(movementPanel, /report\.periodFlow/);
  assert.match(movementPanel, /report\.movementTypes/);
  assert.doesNotMatch(movementPanel, /Loại movement trong kỳ/);
});

test('inventory reporting preserves filter request, drill-down links and tab while refetching', () => {
  const workspace = source('../app/components/inventory-reporting-workspace.tsx');

  assert.match(workspace, /\/api\/reporting\/inventory/);
  assert.match(workspace, /\{ method: 'GET', cache: 'no-store' \}/);
  assert.match(workspace, /void load\(draft\)/);
  assert.match(workspace, /void load\(next, true\)/);
  assert.doesNotMatch(workspace, /setActiveTab\(/);
  assert.match(workspace, /href="\/inventory\/balances"/);
  assert.match(workspace, /href="\/inventory\/costing"/);
  assert.match(workspace, /href="\/inventory\/lots"/);
});

test('shared workspace tabs expose accessible tab semantics and mobile-safe horizontal labels', () => {
  const tabs = source('../app/components/workspace-tabs.tsx');
  const styles = source('../app/components/inventory-reporting-workspace.module.css');

  assert.match(tabs, /role="tablist"/);
  assert.match(tabs, /role="tab"/);
  assert.match(tabs, /aria-selected=\{selected\}/);
  assert.match(tabs, /aria-controls=\{panelElementId\}/);
  assert.match(tabs, /role="tabpanel"/);
  assert.match(tabs, /aria-labelledby=/);
  assert.match(tabs, /if \(activeTab !== tabId\) return null/);
  assert.match(styles, /\.tabList\s*\{[\s\S]*overflow-x:\s*auto/);
  assert.match(styles, /\.tabButton\s*\{[\s\S]*white-space:\s*nowrap/);
  assert.match(styles, /\.tabPanel\s*\{[\s\S]*display:\s*grid/);
});
