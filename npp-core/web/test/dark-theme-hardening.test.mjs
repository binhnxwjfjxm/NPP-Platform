import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const css = read('app/dark-theme-hardening.css');

test('dark theme contract loads after the base appearance theme', () => {
  const layout = read('app/layout.tsx');
  const baseThemeIndex = layout.indexOf("import './appearance-theme.css';");
  const hardeningIndex = layout.indexOf("import './dark-theme-hardening.css';");

  assert.ok(baseThemeIndex >= 0, 'base appearance theme import must remain');
  assert.ok(hardeningIndex > baseThemeIndex, 'dark theme contract must load after the base theme');
});

test('dark theme uses restrained forest green instead of neon accents', () => {
  assert.match(css, /--hp-primary:\s*#347456/);
  assert.match(css, /--hp-primary-hover:\s*#3e8060/);
  assert.match(css, /--hp-focus-outer:\s*#6c9f82/);
  assert.match(css, /--hp-primary-contrast:\s*#f4fbf6/);
  assert.doesNotMatch(css, /#28b96c|#56d891|#45d483/i);
});

test('dark theme resets legacy brown and slate text to readable inherited contrast', () => {
  assert.match(css, /body:not\(\[data-printing='true'\]\) \*\s*\{\s*color:\s*inherit\s*!important/s);
  assert.match(css, /\[class\*='muted'\]/);
  assert.match(css, /\[class\*='meta'\]/);
  assert.match(css, /\[class\*='hint'\]/);
  assert.match(css, /color:\s*var\(--hp-muted\)\s*!important/);
});

test('dark theme covers legacy structural surfaces instead of route-by-route patches', () => {
  for (const selector of [
    "[class*='TableWrap']",
    "[class*='TableWrapper']",
    "[class*='TableSection']",
    "[class*='Hero']",
    "[class*='Intro']",
    "[class*='QuickLink']",
    "[class*='Result']",
    "[class*='WorkspacePanel']",
    "[class*='Section']",
    "[class*='section']",
  ]) {
    assert.ok(css.includes(selector), `missing dark surface coverage for ${selector}`);
  }

  assert.match(css, /\[style\*='background: #fff'\]/);
  assert.match(css, /\[style\*='background: rgb\(255, 255, 255\)'\]/);
  assert.match(css, /\[class\*='Backdrop'\]/);
  assert.match(css, /background:\s*rgba\(3, 8, 5, \.74\)\s*!important/);
});

test('dark theme makes tables dark and text legible across list screens', () => {
  assert.match(css, /body:not\(\[data-printing='true'\]\) table\s*\{/);
  assert.match(css, /:where\(th, td\)/);
  assert.match(css, /thead :where\(tr, th\)/);
  assert.match(css, /--hp-row-even:\s*#181e1a/);
  assert.match(css, /--hp-row-hover:\s*#213027/);
});

test('dark theme replaces bright status pills with dark semantic tones', () => {
  assert.match(css, /--hp-success-bg:\s*#183527/);
  assert.match(css, /--hp-warning-bg:\s*#342b18/);
  assert.match(css, /--hp-danger-bg:\s*#3a201e/);
  assert.match(css, /--hp-info-bg:\s*#1b2e3a/);
  assert.match(css, /\[class\*='Success'\]/);
  assert.match(css, /\[class\*='Warning'\]/);
  assert.match(css, /\[class\*='Danger'\]/);
  assert.match(css, /\[class\*='Info'\]/);
});

test('dark theme keeps buttons restrained and primary actions green', () => {
  assert.match(css, /background-color:\s*var\(--hp-surface-soft\)\s*!important/);
  assert.match(css, /button\[class\*='Primary'\]/);
  assert.match(css, /button\[class\*='Save'\]/);
  assert.match(css, /button\[class\*='Confirm'\]/);
  assert.match(css, /linear-gradient\(180deg, var\(--hp-primary-hover\), var\(--hp-primary\)\)/);
});

test('dark theme prevents common white flashes from browser controls and loading states', () => {
  assert.match(css, /-webkit-autofill/);
  assert.match(css, /0 0 0 1000px var\(--hp-control-surface\) inset/);
  assert.match(css, /\[class\*='Skeleton'\]/);
  assert.match(css, /::-webkit-scrollbar-track/);
});

test('representative legacy modules with hard-coded light UI are covered by the global contract', () => {
  const organization = read('app/organization/organization.module.css');
  const customers = read('app/customers/customers.module.css');
  const products = read('app/products/products.module.css');
  const pricing = read('app/pricing/pricing.module.css');
  const inventory = read('app/inventory/inventory-workspace.module.css');

  assert.match(organization, /\.tableSection[\s\S]*background:\s*#fff/);
  assert.match(organization, /\.table td[\s\S]*color:\s*#4a423c/);
  assert.match(customers, /background:\s*#fff/);
  assert.match(products, /\.unitIntro[\s\S]*linear-gradient\(135deg, #f8fafc, #fff\)/);
  assert.match(pricing, /\.tableWrapper[\s\S]*background:\s*#fff/);
  assert.match(inventory, /\.hero[\s\S]*#fffaf6/);

  assert.ok(css.includes("[class*='TableSection']"));
  assert.ok(css.includes("[class*='TableWrapper']"));
  assert.ok(css.includes("[class*='Intro']"));
  assert.ok(css.includes("[class*='Hero']"));
  assert.match(css, /body:not\(\[data-printing='true'\]\) \*/);
});

test('dark theme keeps document paper white while application chrome stays dark', () => {
  assert.match(css, /print-templates-module/);
  assert.match(css, /\[class\*='paper'\]/);
  assert.match(css, /background:\s*#fff\s*!important/);
  assert.match(css, /@media print/);
  assert.match(css, /\[data-print-active='true'\]/);
  assert.match(css, /color-scheme:\s*light\s*!important/);
});
