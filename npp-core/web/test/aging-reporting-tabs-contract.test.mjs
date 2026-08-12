import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('aging reporting splits AR and AP by business domain without changing global context', () => {
  const workspace = source('../app/components/aging-reporting-workspace.tsx');

  assert.match(workspace, /type AgingReportTab = 'receivable' \| 'payable'/);
  assert.match(workspace, /\{ id: 'receivable', label: 'Phải thu' \}/);
  assert.match(workspace, /\{ id: 'payable', label: 'Phải trả' \}/);
  assert.match(workspace, /useState<AgingReportTab>\('receivable'\)/);
  assert.match(workspace, /<WorkspaceTabs/);
  assert.ok(workspace.indexOf('<form className={styles.filters}') < workspace.indexOf('<WorkspaceTabs'));
  assert.ok(workspace.indexOf('<div className={styles.notice}>') < workspace.indexOf('<WorkspaceTabs'));
});

test('aging reporting keeps summary and counterpart list together inside each domain tab', () => {
  const workspace = source('../app/components/aging-reporting-workspace.tsx');
  const receivablePanel = workspace.match(/<WorkspaceTabPanel tabId="receivable"[\s\S]*?<\/WorkspaceTabPanel>/)?.[0] ?? '';
  const payablePanel = workspace.match(/<WorkspaceTabPanel tabId="payable"[\s\S]*?<\/WorkspaceTabPanel>/)?.[0] ?? '';

  assert.match(receivablePanel, /Phải thu khách hàng/);
  assert.match(receivablePanel, /Khách hàng còn công nợ/);
  assert.match(receivablePanel, /report\.receivable\.summary/);
  assert.match(receivablePanel, /report\.receivable\.customers/);
  assert.match(payablePanel, /Phải trả nhà cung cấp/);
  assert.match(payablePanel, /Nhà cung cấp còn công nợ/);
  assert.match(payablePanel, /report\.payable\.summary/);
  assert.match(payablePanel, /report\.payable\.suppliers/);
});

test('aging reporting preserves canonical GET filters, drill-down links and selected tab on refetch', () => {
  const workspace = source('../app/components/aging-reporting-workspace.tsx');

  assert.match(workspace, /\/api\/reporting\/aging/);
  assert.match(workspace, /\{ method: 'GET', cache: 'no-store' \}/);
  assert.match(workspace, /void load\(warehouseId\)/);
  assert.match(workspace, /void load\(''\)/);
  assert.doesNotMatch(workspace, /setActiveTab\(/);
  assert.match(workspace, /href="\/accounting\/receivables"/);
  assert.match(workspace, /href="\/accounting\/payables"/);
});
