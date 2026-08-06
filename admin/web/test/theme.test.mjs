import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const theme = read('app/hung-phat-warm-gold.css');
const styles = read('app/globals.css');
const layout = read('app/layout.tsx');

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

test('Admin matches the approved warm-gold dashboard geometry', () => {
  assert.match(styles, /\.topbarInner/);
  assert.match(styles, /\.metricGrid/);
  assert.match(styles, /grid-template-columns:\s*repeat\(4/);
  assert.match(styles, /\.dashboardGrid/);
  assert.match(styles, /\.exceptionWorkspace/);
  assert.match(styles, /\.iconBubble/);
  assert.match(styles, /\.filterChip/);
  assert.match(styles, /\.menuPanel/);
  assert.match(styles, /border:\s*1px solid rgba\(152, 96, 15, 0\.13\)/);
  assert.match(styles, /0 10px 32px rgba\(76, 48, 20, 0\.055\)/);
});

test('Admin remains responsive without a mobile bottom dock', () => {
  assert.match(styles, /@media \(max-width: 850px\)/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /@media \(max-width: 640px\)/);
  assert.match(styles, /@media \(max-width: 470px\)/);
  assert.match(styles, /\.desktopNav\s*\{[\s\S]*?display:\s*none/);
  assert.match(styles, /\.mobileMenuItem\s*\{[\s\S]*?display:\s*grid/);
  assert.doesNotMatch(styles, /bottomDock|bottomNavigation/);
  assert.match(layout, /import '\.\/hung-phat-warm-gold\.css';/);
});

test('Admin focus ring has an opaque edge for light and dark surfaces', () => {
  assert.match(theme, /--hp-focus-inner:\s*#fffdf8/i);
  assert.match(theme, /--hp-focus-outer:\s*#754706/i);
  assert.match(theme, /outline:\s*2px solid var\(--hp-focus-inner\)/);
  assert.match(theme, /box-shadow:\s*0 0 0 4px var\(--hp-focus-outer\)/);
});
