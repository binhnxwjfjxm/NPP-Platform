import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const css = read('app/dark-theme-hardening.css');
const appearance = read('app/appearance-theme.css');

test('dark contract loads after the base appearance theme', () => {
  const layout = read('app/layout.tsx');
  const baseThemeIndex = layout.indexOf("import './appearance-theme.css';");
  const contractIndex = layout.indexOf("import './dark-theme-hardening.css';");

  assert.ok(baseThemeIndex >= 0, 'base appearance theme import must remain');
  assert.ok(contractIndex > baseThemeIndex, 'dark contract must load after the base theme');
});

test('THEME-TOI palette remains owned by appearance-theme and is not replaced by hardening', () => {
  assert.match(appearance, /:root\[data-hp-theme='dark'\][\s\S]*--hp-primary:\s*#28b96c/);
  assert.match(appearance, /:root\[data-hp-theme='dark'\][\s\S]*--hp-primary-strong:\s*#56d891/);
  assert.match(appearance, /:root\[data-hp-theme='dark'\][\s\S]*--hp-sidebar-accent:\s*#45d483/);
  assert.doesNotMatch(css, /--hp-primary\s*:/);
  assert.doesNotMatch(css, /--hp-primary-strong\s*:/);
  assert.doesNotMatch(css, /--hp-sidebar-accent\s*:/);
});

test('dark contract never erases every component color with a universal selector', () => {
  assert.doesNotMatch(css, /body:not\(\[data-printing='true'\]\)\s*\*\s*\{[\s\S]*?color:\s*inherit\s*!important/);
  assert.doesNotMatch(css, /body:not\(\[data-printing='true'\]\)\s*\*\s*\{[\s\S]*?color:\s*var\(--hp-ink\)\s*!important/);
  assert.match(css, /\[class\*='muted'\]/);
  assert.match(css, /\[class\*='title'\]/);
});

test('dark contract covers structural surfaces and known legacy pale bars', () => {
  for (const selector of [
    "[class*='Card']",
    "[class*='Panel']",
    "[class*='TableWrapper']",
    "[class*='TableSection']",
    "[class*='Hero']",
    "[class*='Intro']",
    "[class*='WorkspacePanel']",
    "article[class*='card']",
    "div[class*='card']",
    "[class*='selectionBar']",
    "[class*='pagination']",
    "[class*='detailHeader']",
    "[class*='detailFacts']",
  ]) {
    assert.ok(css.includes(selector), `missing dark surface coverage for ${selector}`);
  }

  assert.match(css, /\[style\*='background: #fff'\]/);
  assert.match(css, /\[style\*='background: rgb\(255, 255, 255\)'\]/);
});

test('dark tables and form controls cannot keep light chrome or dark text', () => {
  assert.match(css, /:where\(input, select, textarea, option\)[\s\S]*background:\s*var\(--hp-control-surface\)\s*!important/);
  assert.match(css, /body:not\(\[data-printing='true'\]\) table\s*\{/);
  assert.match(css, /:where\(th, td\)[\s\S]*color:\s*var\(--hp-ink\)\s*!important/);
  assert.match(css, /thead :where\(tr, th\)/);
  assert.match(css, /-webkit-autofill/);
});

test('all six shared status tones have distinct dark semantic colors', () => {
  for (const token of [
    '--hp-neutral-bg',
    '--hp-info-bg',
    '--hp-progress-bg',
    '--hp-warning-bg',
    '--hp-success-bg',
    '--hp-danger-bg',
  ]) {
    assert.ok(css.includes(token), `missing semantic token ${token}`);
  }

  for (const tone of ['neutral', 'info', 'progress', 'warning', 'success', 'danger']) {
    assert.ok(css.includes(`[data-tone='${tone}']`), `missing data-tone mapping for ${tone}`);
  }
});

test('order-management custom states and delivery lanes keep their business colors', () => {
  const orderCss = read('app/sales/order-management/order-management.module.css');

  for (const tone of ['draft', 'confirmed', 'waiting', 'cancelled', 'closed']) {
    assert.ok(orderCss.includes(`data-tone='${tone}'`), `fixture missing order tone ${tone}`);
    assert.ok(css.includes(`[data-tone='${tone}']`), `dark contract missing order tone ${tone}`);
  }

  for (const lane of ['counter', 'manual', 'trip']) {
    assert.ok(orderCss.includes(`data-lane='${lane}'`), `fixture missing delivery lane ${lane}`);
    assert.ok(css.includes(`[data-lane='${lane}']`), `dark contract missing delivery lane ${lane}`);
  }

  for (const stage of ['active', 'preparing', 'waiting_delivery', 'completed', 'cancelled']) {
    assert.ok(css.includes(`[data-stage='${stage}']`), `dark contract missing summary stage ${stage}`);
  }
});

test('buttons default dark but primary, print and link actions are restored explicitly', () => {
  const neutralButtonIndex = css.indexOf("body:not([data-printing='true']) button {");
  const primaryIndex = css.indexOf("button[class*='Primary']");
  const printIndex = css.indexOf("button[class*='Print']");
  const linkIndex = css.indexOf("button[class*='Link']");

  assert.ok(neutralButtonIndex >= 0, 'missing neutral dark button baseline');
  assert.ok(primaryIndex > neutralButtonIndex, 'primary override must follow neutral baseline');
  assert.ok(printIndex > neutralButtonIndex, 'print override must follow neutral baseline');
  assert.ok(linkIndex > neutralButtonIndex, 'link override must follow neutral baseline');
  assert.match(css, /linear-gradient\(180deg, var\(--hp-primary-strong\), var\(--hp-primary\)\)/);
});

test('semantic data-tone rules are later than the neutral badge baseline', () => {
  const neutralBadgeIndex = css.indexOf("[class*='Badge']");
  const successToneIndex = css.indexOf("[data-tone='success']");
  const dangerToneIndex = css.indexOf("[data-tone='danger']");

  assert.ok(neutralBadgeIndex >= 0);
  assert.ok(successToneIndex > neutralBadgeIndex);
  assert.ok(dangerToneIndex > neutralBadgeIndex);
});

test('loading, overlay and scrollbar chrome stay dark', () => {
  assert.match(css, /\[class\*='Backdrop'\]/);
  assert.match(css, /background:\s*rgba\(2, 8, 5, \.78\)\s*!important/);
  assert.match(css, /\[class\*='Skeleton'\]/);
  assert.match(css, /::-webkit-scrollbar-track/);
});

test('sample paper and print output remain white by design', () => {
  assert.match(css, /print-templates-module/);
  assert.match(css, /background:\s*#fff\s*!important/);
  assert.match(css, /@media print/);
  assert.match(css, /\[data-print-active='true'\]/);
  assert.match(css, /color-scheme:\s*light\s*!important/);
});
