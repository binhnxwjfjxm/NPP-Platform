import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const theme = read('app/hung-phat-warm-gold.css');
const layout = read('app/layout.tsx');

const tokens = {
  '--hp-canvas': '#f7f5f1',
  '--hp-surface': '#ffffff',
  '--hp-bronze': '#98600f',
  '--hp-bronze-strong': '#754706',
  '--hp-ink': '#2d2924',
  '--hp-border': '#d8d0c4',
};

test('NPP desktop theme uses the shared Hưng Phát warm-gold tokens', () => {
  for (const [name, value] of Object.entries(tokens)) {
    assert.match(theme, new RegExp(`${name}:\\s*${value}`, 'i'));
  }
  assert.match(theme, /table/);
  assert.match(theme, /thead/);
  assert.match(theme, /\[data-collapsed\] > aside/);
});

test('NPP loads the theme after existing layout overrides', () => {
  const themeIndex = layout.indexOf("import './hung-phat-warm-gold.css';");
  const previousIndex = layout.indexOf("import './issue-107-purchase-order-layout.css';");
  assert.ok(themeIndex > previousIndex);
});
