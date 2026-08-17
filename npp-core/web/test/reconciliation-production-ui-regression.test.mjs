import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('production reconciliation actions remain visible and quantity inputs do not expose storage scale zeroes', () => {
  const workspace = source('../app/logistics/trip-reconciliation/trip-reconciliation-workspace.tsx');
  const styles = source('../app/logistics/trip-reconciliation/trip-reconciliation-workspace.module.css');

  assert.match(workspace, /\[line\.inventoryIssueLineId, formatExactDecimal\(line\.outstandingBaseQuantity\)\]/);
  assert.match(styles, /\.actionBox button \{ border: 1px solid var\(--foreground\); background: var\(--foreground\); color: var\(--surface\); \}/);
  assert.match(styles, /\.actionBox button:disabled \{ opacity: 1;/);
  assert.match(workspace, />Xác nhận nhập hàng về kho<\/button>/);
});

test('COD overview metric numbers have their own rows instead of running into helper text', () => {
  const workspace = source('../app/components/cod-reporting-workspace.tsx');
  const styles = source('../app/components/cod-reporting-workspace.module.css');

  assert.match(workspace, /metricStyles\.metricCard/);
  assert.match(workspace, /metricStyles\.metricValue/);
  assert.match(workspace, /metricStyles\.metricHint/);
  assert.match(styles, /\.metricLabel,[\s\S]*\.metricValue,[\s\S]*\.metricHint \{[\s\S]*display: block;/);
  assert.doesNotMatch(workspace, /Current queue|due_at|COD canonical/);
});

test('COD accounting confirmation is a reporting tab, while the legacy route is only a compatibility redirect', () => {
  const reporting = source('../app/components/cod-reporting-workspace.tsx');
  const legacyPage = source('../app/accounting/cod-reconciliation/page.tsx');

  assert.match(reporting, /\{ id: 'accounting', label: 'Kế toán xác nhận' \}/);
  assert.match(reporting, /<CodReconciliationWorkspace/);
  assert.match(legacyPage, /redirect\('\/accounting\/cod-reporting\?tab=accounting'\)/);
});
