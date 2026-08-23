import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Admin shared foundation keeps one compact icon-tab implementation', async () => {
  const [tabs, foundation, layout] = await Promise.all([
    read('app/admin-icon-tabs.tsx'),
    read('app/admin-foundation.css'),
    read('app/layout.tsx'),
  ]);

  assert.match(tabs, /data-admin-tabs/);
  assert.match(tabs, /<AdminIcon name=\{tab\.icon\} size=\{18\}/);
  assert.match(foundation, /\.adminIconTabs\s*\{[\s\S]*display:\s*flex/);
  assert.match(foundation, /\.adminIconTab\s*\{[\s\S]*min-height:\s*42px/);
  assert.match(foundation, /\.adminIconTab\s*\{[\s\S]*border:\s*0/);
  assert.match(foundation, /\.adminIconTab\s*\{[\s\S]*box-shadow:\s*none/);
  assert.match(foundation, /\.adminIconTab\.isActive::after/);
  assert.match(layout, /import '\.\/admin-foundation\.css';/);
  assert.ok(layout.indexOf("import './admin-management-shell.css';") < layout.indexOf("import './admin-foundation.css';"), 'shared foundation must own the final cross-module tab/header rules');
});

test('Admin foundation exposes only proven shared primitives from Lô 0', async () => {
  const [primitives, shell, foundation] = await Promise.all([
    read('app/admin-ui-primitives.tsx'),
    read('app/admin-shell.tsx'),
    read('app/admin-foundation.css'),
  ]);

  for (const name of ['AdminToolbar', 'AdminFilterChip', 'AdminStatusBadge', 'AdminKpiGrid', 'AdminKpiCard', 'AdminStatePanel', 'AdminActionBar']) {
    assert.match(primitives, new RegExp(`export function ${name}`));
  }

  assert.doesNotMatch(primitives, /export function AdminSearch|export function AdminPagination|export function AdminDataTable/);
  assert.match(shell, /export type AdminContentWidth = 'wide' \| 'focused' \| 'special'/);
  assert.match(shell, /contentWidth = 'wide'/);
  assert.match(shell, /data-admin-content-width=\{contentWidth\}/);
  assert.match(foundation, /\.adminContentWide/);
  assert.match(foundation, /\.adminContentFocused/);
  assert.match(foundation, /\.adminContentSpecial/);
});

test('Admin foundation keeps office UI hierarchy compact and responsive', async () => {
  const foundation = await read('app/admin-foundation.css');

  assert.match(foundation, /\.adminPageHeader h1/);
  assert.match(foundation, /\.adminToolbar/);
  assert.match(foundation, /\.adminFilterChip/);
  assert.match(foundation, /\.adminStatusBadge\.is-danger/);
  assert.match(foundation, /\.adminKpiGrid/);
  assert.match(foundation, /\.adminStatePanel/);
  assert.match(foundation, /\.adminActionBar/);
  assert.match(foundation, /@media \(max-width: 760px\)/);
  assert.doesNotMatch(foundation, /backend|canonical|fixture|payload|debug/i);
});
