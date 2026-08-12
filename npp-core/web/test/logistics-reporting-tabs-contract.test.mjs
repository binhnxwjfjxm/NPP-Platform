import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('logistics reporting keeps filters and KPI context above five detail tabs', () => {
  const workspace = source('../app/components/logistics-reporting-workspace.tsx');

  assert.match(workspace, /type LogisticsReportTab = 'drivers' \| 'vehicles' \| 'results' \| 'trips' \| 'exceptions'/);
  assert.match(workspace, /\{ id: 'drivers', label: 'Tài xế' \}/);
  assert.match(workspace, /\{ id: 'vehicles', label: 'Phương tiện' \}/);
  assert.match(workspace, /\{ id: 'results', label: 'Kết quả giao' \}/);
  assert.match(workspace, /\{ id: 'trips', label: 'Chuyến gần nhất' \}/);
  assert.match(workspace, /\{ id: 'exceptions', label: 'Ngoại lệ' \}/);
  assert.match(workspace, /useState<LogisticsReportTab>\('drivers'\)/);
  assert.match(workspace, /<form className=\{styles\.filters\}/);
  assert.match(workspace, /<div className=\{styles\.cards\}>/);
  assert.match(workspace, /<WorkspaceTabs/);
});

test('logistics reporting renders one business detail panel at a time', () => {
  const workspace = source('../app/components/logistics-reporting-workspace.tsx');

  for (const tabId of ['drivers', 'vehicles', 'results', 'trips', 'exceptions']) {
    assert.match(workspace, new RegExp(`<WorkspaceTabPanel\\s+tabId="${tabId}"`));
  }

  const drivers = workspace.match(/<WorkspaceTabPanel tabId="drivers"[\s\S]*?<\/WorkspaceTabPanel>/)?.[0] ?? '';
  const vehicles = workspace.match(/<WorkspaceTabPanel tabId="vehicles"[\s\S]*?<\/WorkspaceTabPanel>/)?.[0] ?? '';
  const results = workspace.match(/<WorkspaceTabPanel tabId="results"[\s\S]*?<\/WorkspaceTabPanel>/)?.[0] ?? '';
  const trips = workspace.match(/<WorkspaceTabPanel tabId="trips"[\s\S]*?<\/WorkspaceTabPanel>/)?.[0] ?? '';
  const exceptions = workspace.match(/<WorkspaceTabPanel tabId="exceptions"[\s\S]*?<\/WorkspaceTabPanel>/)?.[0] ?? '';

  assert.match(drivers, /report\.drivers/);
  assert.match(vehicles, /report\.vehicles/);
  assert.match(results, /report\.failureReasons/);
  assert.match(trips, /report\.trips/);
  assert.match(exceptions, /report\.reconciliation/);
  assert.match(exceptions, /report\.dataQuality\.exceptions/);
});

test('logistics reporting preserves canonical GET filters and operational drill-downs', () => {
  const workspace = source('../app/components/logistics-reporting-workspace.tsx');

  assert.match(workspace, /\/api\/reporting\/logistics/);
  assert.match(workspace, /\{ method: 'GET', cache: 'no-store' \}/);
  assert.match(workspace, /void load\(from, to, warehouseId\)/);
  assert.match(workspace, /href="\/logistics\/trips"/);
  assert.match(workspace, /href="\/logistics\/delivery-attempts"/);
  assert.match(workspace, /href="\/inventory\/delivery-orders"/);
  assert.match(workspace, /href="\/logistics\/trip-reconciliation"/);
});

test('logistics reporting uses the shared accessible workspace tab primitive', () => {
  const workspace = source('../app/components/logistics-reporting-workspace.tsx');
  const tabs = source('../app/components/workspace-tabs.tsx');

  assert.match(workspace, /from '\.\/workspace-tabs'/);
  assert.match(workspace, /label="Chi tiết hiệu suất giao hàng"/);
  assert.doesNotMatch(workspace, /className=\{styles\.tabList\}/);
  assert.match(tabs, /role="tablist"/);
  assert.match(tabs, /role="tab"/);
  assert.match(tabs, /role="tabpanel"/);
  assert.match(tabs, /if \(activeTab !== tabId\) return null/);
});