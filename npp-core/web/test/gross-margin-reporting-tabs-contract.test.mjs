import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('gross margin reporting keeps KPI reconciliation context above three detail tabs', () => {
  const workspace = source('../app/components/gross-margin-reporting-workspace.tsx');

  assert.match(workspace, /type GrossMarginReportTab = 'customers' \| 'skus' \| 'exceptions'/);
  assert.match(workspace, /\{ id: 'customers', label: 'Theo khách hàng' \}/);
  assert.match(workspace, /\{ id: 'skus', label: 'Theo SKU' \}/);
  assert.match(workspace, /\{ id: 'exceptions', label: 'Ngoại lệ' \}/);
  assert.match(workspace, /useState<GrossMarginReportTab>\('customers'\)/);
  assert.ok(workspace.indexOf('<div className={styles.cards}>') < workspace.indexOf('<WorkspaceTabs'));
  assert.ok(workspace.indexOf('<div className={styles.notice}>') < workspace.indexOf('<WorkspaceTabs'));
});

test('gross margin reporting maps customer, SKU and exception data to separate selected panels', () => {
  const workspace = source('../app/components/gross-margin-reporting-workspace.tsx');
  const customersPanel = workspace.match(/<WorkspaceTabPanel tabId="customers"[\s\S]*?<\/WorkspaceTabPanel>/)?.[0] ?? '';
  const skusPanel = workspace.match(/<WorkspaceTabPanel tabId="skus"[\s\S]*?<\/WorkspaceTabPanel>/)?.[0] ?? '';
  const exceptionsPanel = workspace.match(/<WorkspaceTabPanel tabId="exceptions"[\s\S]*?<\/WorkspaceTabPanel>/)?.[0] ?? '';

  assert.match(customersPanel, /Theo khách hàng/);
  assert.match(customersPanel, /report\.topCustomers/);
  assert.match(skusPanel, /Theo SKU/);
  assert.match(skusPanel, /report\.topSkus/);
  assert.match(exceptionsPanel, /Dòng chưa đủ điều kiện tính lãi gộp/);
  assert.match(exceptionsPanel, /report\.exceptions/);
});

test('gross margin reporting preserves canonical GET filters, drill-downs and selected tab on refetch', () => {
  const workspace = source('../app/components/gross-margin-reporting-workspace.tsx');

  assert.match(workspace, /\/api\/reporting\/gross-margin/);
  assert.match(workspace, /\{ method: 'GET', cache: 'no-store' \}/);
  assert.match(workspace, /void load\(draft\)/);
  assert.match(workspace, /void load\(EMPTY, true\)/);
  assert.doesNotMatch(workspace, /setActiveTab\(/);
  assert.match(workspace, /href="\/sales\/sales-orders"/);
  assert.match(workspace, /href="\/inventory\/costing"/);
});
