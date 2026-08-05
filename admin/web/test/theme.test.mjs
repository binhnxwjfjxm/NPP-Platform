import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const theme = read('app/hung-phat-warm-gold.css');
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

test('Admin remains responsive for desktop and mobile review flows', () => {
  assert.match(theme, /@media \(max-width: 850px\)/);
  assert.match(theme, /@media \(max-width: 560px\)/);
  assert.match(theme, /grid-template-columns:\s*repeat\(2/);
  assert.match(theme, /min-height:\s*46px/);
  assert.match(layout, /import '\.\/hung-phat-warm-gold\.css';/);
});
