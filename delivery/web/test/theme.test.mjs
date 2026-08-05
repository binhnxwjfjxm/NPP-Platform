import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const theme = read('app/hung-phat-mobile.css');
const layout = read('app/layout.tsx');

const tokens = {
  '--hp-canvas': '#f7f5f1',
  '--hp-bronze': '#98600f',
  '--hp-bronze-strong': '#754706',
  '--hp-ink': '#2d2924',
  '--hp-border': '#d8d0c4',
};

test('Delivery uses the shared warm-gold palette', () => {
  for (const [name, value] of Object.entries(tokens)) {
    assert.match(theme, new RegExp(`${name}:\\s*${value}`, 'i'));
  }
});

test('Delivery shell is mobile-first with sticky chrome and touch targets', () => {
  assert.match(theme, /width:\s*min\(100%, 600px\)/);
  assert.match(theme, /\.appHeader,[\s\S]*?position:\s*sticky/);
  assert.match(theme, /min-height:\s*46px/);
  assert.match(theme, /env\(safe-area-inset-bottom\)/);
  assert.match(layout, /import '\.\/hung-phat-mobile\.css';/);
  assert.match(layout, /viewportFit:\s*'cover'/);
  assert.match(layout, /themeColor:\s*'#754706'/);
});

test('Delivery focus ring has an opaque edge for light and dark surfaces', () => {
  assert.match(theme, /--hp-focus-inner:\s*#fffdf8/i);
  assert.match(theme, /--hp-focus-outer:\s*#754706/i);
  assert.match(theme, /outline:\s*2px solid var\(--hp-focus-inner\)/);
  assert.match(theme, /box-shadow:\s*0 0 0 4px var\(--hp-focus-outer\)/);
});
