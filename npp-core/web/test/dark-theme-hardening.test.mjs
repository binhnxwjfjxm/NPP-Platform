import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('dark theme hardening loads after the base appearance theme', () => {
  const layout = read('app/layout.tsx');
  const baseThemeIndex = layout.indexOf("import './appearance-theme.css';");
  const hardeningIndex = layout.indexOf("import './dark-theme-hardening.css';");

  assert.ok(baseThemeIndex >= 0, 'base appearance theme import must remain');
  assert.ok(hardeningIndex > baseThemeIndex, 'dark theme hardening must load after the base theme');
});

test('dark theme uses restrained green tokens and removes legacy bright gradients', () => {
  const css = read('app/dark-theme-hardening.css');

  assert.match(css, /--hp-primary:\s*#347456/);
  assert.match(css, /--hp-primary-hover:\s*#3e8060/);
  assert.match(css, /--hp-focus-outer:\s*#6c9f82/);
  assert.match(css, /background-image:\s*none\s*!important/);
  assert.doesNotMatch(css, /#28b96c|#56d891|#45d483/i);
});

test('dark theme covers shared surfaces, buttons, dashboard, tabs, modals and operational tables', () => {
  const css = read('app/dark-theme-hardening.css');

  assert.match(css, /\[class\*='Card'\]/);
  assert.match(css, /button\[class\*='Primary'\]/);
  assert.match(css, /dashboard-module/);
  assert.match(css, /app-shell-user-tabs-module/);
  assert.match(css, /modal-module/);
  assert.match(css, /fulfillment-product-table/);
  assert.match(css, /--surface:\s*var\(--hp-surface\)/);
  assert.match(css, /--line:\s*var\(--hp-border\)/);
  assert.match(css, /--ink:\s*var\(--hp-ink\)/);
});

test('dark theme keeps printing on white paper', () => {
  const css = read('app/dark-theme-hardening.css');

  assert.match(css, /@media print/);
  assert.match(css, /\[data-print-active='true'\]/);
  assert.match(css, /background:\s*#fff\s*!important/);
  assert.match(css, /color-scheme:\s*light\s*!important/);
});
