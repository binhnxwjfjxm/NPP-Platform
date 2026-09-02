import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const runtime = read('app/appearance-theme-runtime.css');
const layout = read('app/layout.tsx');
const salesWorkspace = read('app/sales/sales-orders/SalesOrderWorkspace.tsx');
const inventoryReporting = read('app/components/inventory-reporting-workspace.module.css');
const appShell = read('app/components/app-shell-core.tsx');

test('final appearance runtime remains the last theme layer', () => {
  const hardening = layout.indexOf("import './dark-theme-hardening.css';");
  const runtimeIndex = layout.indexOf("import './appearance-theme-runtime.css';");
  assert.ok(hardening >= 0);
  assert.ok(runtimeIndex > hardening);
});

test('legacy Công Ty surface variables bridge to active appearance tokens', () => {
  for (const [legacy, canonical] of [
    ['--surface', '--hp-surface'],
    ['--border', '--hp-border'],
    ['--line', '--hp-border'],
    ['--text', '--hp-ink'],
    ['--muted', '--hp-muted'],
    ['--shadow', '--hp-shadow'],
    ['--bronze', '--hp-primary'],
    ['--bronze-strong', '--hp-primary-strong'],
  ]) {
    assert.match(runtime, new RegExp(`${legacy}:\\s*var\\(${canonical}\\)`));
  }
  assert.match(inventoryReporting, /var\(--surface,\s*#fff\)/);
});

test('sales order business status and delivery lane attributes keep semantic colors', () => {
  assert.match(salesWorkspace, /data-sales-order-tone=/);
  assert.match(salesWorkspace, /data-sales-order-lane=/);
  for (const tone of ['draft', 'waiting', 'confirmed', 'cancelled', 'closed']) {
    assert.ok(runtime.includes(`[data-sales-order-tone='${tone}']`), `missing sales order tone ${tone}`);
  }
  for (const lane of ['counter', 'manual', 'trip']) {
    assert.ok(runtime.includes(`[data-sales-order-lane='${lane}']`), `missing sales order lane ${lane}`);
  }
});

test('sidebar group buttons are explicitly flattened after generic button theming', () => {
  assert.match(appShell, /styles\.navGroupButton/);
  assert.match(runtime, /\[class\*='navGroupButton'\]/);
  assert.match(runtime, /\[class\*='navGroupActive'\]\s*>\s*\[class\*='navGroupButton'\]/);
  assert.match(runtime, /border-radius:\s*2px\s*!important/);
  assert.match(runtime, /box-shadow:\s*inset 2px 0 0 var\(--hp-sidebar-accent\)\s*!important/);
});

test('inventory reporting legacy pale surfaces and semantic states are covered', () => {
  for (const selector of [
    'inventory-reporting-workspace_filters__',
    'inventory-reporting-workspace_linkButton__',
    'inventory-reporting-workspace_tabList__',
    'inventory-reporting-workspace_tabButtonActive__',
    'inventory-reporting-workspace_statusGood__',
    'inventory-reporting-workspace_statusWarn__',
    'inventory-reporting-workspace_statusBad__',
    'inventory-reporting-workspace_statusNeutral__',
  ]) {
    assert.ok(runtime.includes(selector), `missing inventory reporting runtime coverage for ${selector}`);
  }
});

test('sales order editor has distinct canvas, surface and muted hierarchy in dark theme', () => {
  for (const selector of [
    'sales-orders_orderEditorModal__',
    'sales-orders_modalHeader__',
    'sales-orders_orderEditorFooter__',
    'sales-orders_compactHeader__',
    'sales-orders_productEntry__',
    'sales-orders_orderLines__',
    'sales-orders_lineTableHeader__',
    'sales-orders_segmentActive__',
  ]) {
    assert.ok(runtime.includes(selector), `missing sales editor hierarchy selector ${selector}`);
  }
  assert.match(runtime, /sales-orders_orderEditorModal__[\s\S]*background:\s*var\(--hp-canvas\)\s*!important/);
  assert.match(runtime, /sales-orders_modalHeader__[\s\S]*background:\s*var\(--hp-surface-soft\)\s*!important/);
  assert.match(runtime, /sales-orders_compactHeader__[\s\S]*background:\s*var\(--hp-surface\)\s*!important/);
  assert.match(runtime, /sales-orders_lineTableHeader__[\s\S]*background:\s*var\(--hp-surface-muted\)\s*!important/);
});
