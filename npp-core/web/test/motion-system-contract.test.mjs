import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const polishCss = source('../app/ui-polish.css');
const shellCss = source('../app/components/app-shell.module.css');
const shellSource = source('../app/components/app-shell-core.tsx');
const tabsSource = source('../app/components/workspace-tabs.tsx');
const workspaceCss = source('../app/components/inventory-reporting-workspace.module.css');

test('Core motion tokens define one restrained operational timing scale', () => {
  assert.match(polishCss, /--npp-motion-route-duration:\s*170ms/);
  assert.match(polishCss, /--npp-motion-tab-duration:\s*150ms/);
  assert.match(polishCss, /--npp-motion-nav-duration:\s*160ms/);
  assert.match(polishCss, /--npp-motion-action-duration:\s*110ms/);
  assert.match(polishCss, /--npp-motion-route-distance:\s*6px/);
  assert.match(polishCss, /--npp-motion-tab-distance:\s*4px/);
  assert.match(polishCss, /--npp-motion-ease-enter:\s*cubic-bezier\(0\.22,\s*0\.61,\s*0\.36,\s*1\)/);
  assert.match(polishCss, /@media \(prefers-reduced-motion: reduce\)/);
});

test('route and sidebar motion are owned by AppShell instead of ui-polish overrides', () => {
  assert.doesNotMatch(polishCss, /npp-route-enter/);
  assert.doesNotMatch(polishCss, /\[data-testid="app-sidebar"\][\s\S]*?transition:[\s\S]*?!important/);

  assert.match(shellCss, /animation:\s*content-enter var\(--npp-motion-route-duration\) var\(--npp-motion-ease-enter\)/);
  assert.match(shellCss, /from \{ opacity: 0\.82; transform: translateY\(var\(--npp-motion-route-distance\)\); \}/);
  assert.match(shellCss, /\.sidebar\s*\{[\s\S]*?var\(--npp-motion-nav-duration\)/);
  assert.match(shellCss, /\.subnav\s*\{[\s\S]*?var\(--npp-motion-nav-duration\)/);
  assert.match(shellCss, /\.navItem\s*\{[\s\S]*?var\(--npp-motion-action-duration\)/);
  assert.match(shellCss, /\.actionButton\s*\{[\s\S]*?var\(--npp-motion-action-duration\)/);
  assert.match(shellCss, /\.content \{ animation: none; \}/);
});

test('WorkspaceTabs switches immediately and animates only the mounted panel', () => {
  assert.match(tabsSource, /onClick=\{\(\) => onChange\(tab\.id\)\}/);
  assert.doesNotMatch(tabsSource, /setTimeout|requestAnimationFrame/);
  assert.match(workspaceCss, /\.tabPanel\s*\{[\s\S]*?workspace-tab-enter var\(--npp-motion-tab-duration\) var\(--npp-motion-ease-enter\)/);
  assert.match(workspaceCss, /from \{ opacity: 0\.86; transform: translateY\(var\(--npp-motion-tab-distance\)\); \}/);
  assert.match(workspaceCss, /\.tabButton\s*\{[\s\S]*?var\(--npp-motion-action-duration\)/);
  assert.match(workspaceCss, /\.tabPanel \{ animation: none; \}/);
});

test('motion never gates route navigation and keeps the access stability exception', () => {
  assert.doesNotMatch(shellSource, /setTimeout|requestAnimationFrame/);
  assert.match(shellSource, /<main key=\{pathname\} className=\{styles\.content\}/);
  assert.match(shellSource, /const accessStableMotion = pathname\.startsWith\('\/access'\)/);
  assert.match(shellSource, /stableMotion: true/);
});
