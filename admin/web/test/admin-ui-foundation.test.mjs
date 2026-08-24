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
  assert.ok(layout.indexOf("import './admin-management-shell.css';") < layout.indexOf("import './admin-foundation.css';"), 'shared foundation must own the visual tab/header rules');
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

test('Admin mobile icon tabs stay vertically locked while swiping horizontally', async () => {
  const [foundation, interaction, layout] = await Promise.all([
    read('app/admin-foundation.css'),
    read('app/admin-mobile-interaction.css'),
    read('app/layout.tsx'),
  ]);

  assert.match(foundation, /\.adminIconTabs\s*\{[\s\S]*overflow-x:\s*auto/);
  assert.match(foundation, /\.adminIconTabs\s*\{[\s\S]*overflow-y:\s*hidden/);
  assert.match(foundation, /\.adminIconTabs\s*\{[\s\S]*overscroll-behavior-x:\s*contain/);
  assert.match(foundation, /\.adminIconTabs\s*\{[\s\S]*overscroll-behavior-y:\s*none/);
  assert.match(foundation, /\.adminIconTab\s*\{[\s\S]*height:\s*42px[\s\S]*max-height:\s*42px/);
  assert.match(foundation, /@media \(max-width: 760px\)[\s\S]*\.adminIconTabs\s*\{[\s\S]*height:\s*41px[\s\S]*max-height:\s*41px/);
  assert.match(foundation, /@media \(max-width: 760px\)[\s\S]*\.adminIconTab\s*\{[\s\S]*height:\s*40px[\s\S]*max-height:\s*40px/);
  assert.match(interaction, /\.adminAppShell,[\s\S]*\.adminIconTabs,[\s\S]*\.adminToolbarActions\s*\{[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%/);
  assert.match(interaction, /\.adminIconTabs\s*\{[\s\S]*width:\s*100%;[\s\S]*overflow-y:\s*hidden;[\s\S]*touch-action:\s*pan-x/);
  assert.ok(layout.indexOf("import './admin-closeout.css';") < layout.indexOf("import './admin-mobile-interaction.css';"), 'mobile interaction constraints must load last');
});

test('Admin mobile rails cannot expand the page viewport and page zoom is disabled', async () => {
  const [interaction, layout] = await Promise.all([
    read('app/admin-mobile-interaction.css'),
    read('app/layout.tsx'),
  ]);

  assert.match(interaction, /\.adminToolbarControls,[\s\S]*\.adminToolbarActions\s*\{[\s\S]*max-width:\s*100%/);
  assert.doesNotMatch(interaction, /aria-label="Kỳ tổng quan"|aria-label="Kỳ báo cáo"|aria-label="Lọc theo kho"/);
  assert.match(interaction, /touch-action:\s*pan-x pan-y/);
  assert.doesNotMatch(interaction, /pinch-zoom/);
  assert.match(layout, /maximumScale:\s*1/);
  assert.match(layout, /userScalable:\s*false/);
});
