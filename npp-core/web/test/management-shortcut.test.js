import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const layoutSource = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');
const shortcutSource = readFileSync(new URL('../app/components/management-shortcut.tsx', import.meta.url), 'utf8');
const salesWorkspaceSource = readFileSync(new URL('../app/sales/sales-orders/SalesOrderWorkspace.tsx', import.meta.url), 'utf8');
const styleSource = readFileSync(new URL('../app/components/app-shell-shortcuts.module.css', import.meta.url), 'utf8');

test('NPP exposes the daily management workspace from every business screen', () => {
  assert.match(layoutSource, /<ManagementShortcut \/>/);
  assert.match(shortcutSource, /href="\/management"/);
  assert.match(shortcutSource, /Công việc hằng ngày/);
  assert.match(shortcutSource, /data-testid="nav-management-shortcut"/);
  assert.match(shortcutSource, /'\/sales'/);
  assert.match(shortcutSource, /pathname\.startsWith\('\/management'\)/);
  assert.match(salesWorkspaceSource, /app-shell-core/);
  assert.match(styleSource, /position: fixed/);
  assert.match(styleSource, /\.managementShortcut/);
});
