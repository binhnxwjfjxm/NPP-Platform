import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const theme = read('app/hung-phat-warm-gold.css');
const styles = read('app/globals.css');
const mobileApp = read('app/admin-mobile-app.css');
const managementShell = read('app/admin-management-shell.css');
const layout = read('app/layout.tsx');
const shell = read('app/admin-shell.tsx');

for (const [name, value] of Object.entries({
  '--hp-canvas': '#f7f5f1',
  '--hp-bronze': '#98600f',
  '--hp-bronze-strong': '#754706',
  '--hp-ink': '#2d2924',
  '--hp-border': '#d8d0c4',
})) {
  test(`Admin theme exposes ${name}`, () => {
    assert.match(theme, new RegExp(`${name}:\\s*${value}`, 'i'));
  });
}

test('Admin keeps the approved warm-gold card geometry', () => {
  assert.match(styles, /\.topbarInner/);
  assert.match(styles, /\.metricGrid/);
  assert.match(styles, /\.iconBubble/);
  assert.match(styles, /\.menuPanel/);
  assert.match(styles, /border:\s*1px solid rgba\(152, 96, 15, 0\.13\)/);
  assert.match(styles, /0 10px 32px rgba\(76, 48, 20, 0\.055\)/);
});

test('Admin behaves like a four-destination mobile app while preserving iPhone safe areas', () => {
  assert.match(layout, /import '\.\/admin-mobile-app\.css';/);
  assert.match(layout, /import '\.\/admin-management-shell\.css';/);
  assert.match(layout, /statusBarStyle:\s*'black'/);
  assert.doesNotMatch(layout, /statusBarStyle:\s*'black-translucent'/);
  assert.match(layout, /viewportFit:\s*'cover'/);
  assert.match(shell, /className="adminBottomNav"/);
  for (const label of ['Tổng quan', 'Phê duyệt', 'Cảnh báo', 'Báo cáo']) assert.match(shell, new RegExp(`label: '${label}'`));
  assert.doesNotMatch(shell, /label: 'Menu'/);
  assert.match(mobileApp, /grid-template-rows:\s*auto minmax\(0, 1fr\) auto/);
  assert.match(mobileApp, /@media \(max-width: 760px\) and \(display-mode: standalone\)/);
  assert.match(mobileApp, /height:\s*100vh/);
  assert.doesNotMatch(mobileApp, /100dvh|100svh/);
  assert.match(mobileApp, /padding:\s*calc\(7px \+ env\(safe-area-inset-top\)\)/);
  assert.match(managementShell, /\.adminBottomNav\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(managementShell, /\.adminIconTabs/);
  assert.match(managementShell, /\.adminIconTab\.isActive/);
  assert.match(mobileApp, /\.adminAppMain\s*\{[\s\S]*?overflow-y:\s*auto/);
});

test('Admin focus ring has an opaque edge for light and dark surfaces', () => {
  assert.match(theme, /--hp-focus-inner:\s*#fffdf8/i);
  assert.match(theme, /--hp-focus-outer:\s*#754706/i);
  assert.match(theme, /outline:\s*2px solid var\(--hp-focus-inner\)/);
  assert.match(theme, /box-shadow:\s*0 0 0 4px var\(--hp-focus-outer\)/);
});
