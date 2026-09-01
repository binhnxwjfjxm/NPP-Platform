import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Cài đặt có tab Giao diện và route riêng', () => {
  const tabs = read('app/settings/settings-tabs.tsx');
  const page = read('app/settings/appearance/page.tsx');
  const workspace = read('app/settings/appearance/appearance-workspace.tsx');
  const preferences = read('app/appearance-preferences.ts');

  assert.match(tabs, /href: '\/settings\/appearance'/);
  assert.match(tabs, /label: 'Giao diện'/);
  assert.match(page, /<AppearanceWorkspace \/>/);
  assert.match(workspace, /<SettingsTabs active="appearance" \/>/);
  assert.match(preferences, /label: 'Mặc định'/);
  assert.match(preferences, /label: 'Xanh lá'/);
  assert.match(preferences, /label: 'Tối'/);
});

test('giao diện lưu trên trình duyệt và bootstrap trước khi app hiển thị', () => {
  const layout = read('app/layout.tsx');
  const preferences = read('app/appearance-preferences.ts');
  const workspace = read('app/settings/appearance/appearance-workspace.tsx');

  assert.match(preferences, /hp-company-appearance-theme/);
  assert.match(preferences, /hp-company-appearance-scale/);
  assert.match(layout, /data-hp-theme="default"/);
  assert.match(layout, /data-hp-scale="0"/);
  assert.match(layout, /localStorage\.getItem/);
  assert.match(layout, /appearance-theme\.css/);
  assert.ok(
    layout.indexOf("import './appearance-theme.css';") > layout.indexOf("import './sales-order-entry-polish.css';"),
    'appearance theme must load last so it can switch color tokens without changing page layout',
  );
  assert.match(workspace, /localStorage\.setItem/);
  assert.match(workspace, /applyAppearance/);
});

test('thanh kích thước có đủ 4 cấp nhỏ, mặc định và 4 cấp lớn', () => {
  const preferences = read('app/appearance-preferences.ts');
  const workspace = read('app/settings/appearance/appearance-workspace.tsx');
  const globals = read('app/globals.css');
  const theme = read('app/appearance-theme.css');

  assert.match(preferences, /\[-4, -3, -2, -1, 0, 1, 2, 3, 4\]/);
  assert.match(workspace, /type="range"/);
  assert.match(workspace, /min=\{-4\}/);
  assert.match(workspace, /max=\{4\}/);
  assert.match(globals, /font-size:\s*calc\(120% \* var\(--hp-ui-scale, 1\)\)/);
  for (let level = -4; level <= 4; level += 1) {
    assert.match(theme, new RegExp(`data-hp-scale=['"]${level}['"]`));
  }
});

test('theme dùng token tập trung và khóa theo ba ảnh tham chiếu trong repo', () => {
  const theme = read('app/appearance-theme.css');

  assert.match(theme, /THEM-XANH-LA\.png/);
  assert.match(theme, /THEME-XANH-NHAT\.png/);
  assert.match(theme, /THEME-TOI\.png/);
  assert.match(theme, /data-hp-theme='green'/);
  assert.match(theme, /data-hp-theme='dark'/);
  assert.match(theme, /--hp-canvas:/);
  assert.match(theme, /--hp-surface:/);
  assert.match(theme, /--hp-sidebar-start:/);
  assert.match(theme, /--hp-primary:/);
  assert.match(theme, /--hp-border:/);
  assert.match(theme, /color-scheme:\s*dark/);
});
