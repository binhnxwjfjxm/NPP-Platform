import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shellSource = readFileSync(new URL('../app/components/app-shell.tsx', import.meta.url), 'utf8');
const styleSource = readFileSync(new URL('../app/components/app-shell-shortcuts.module.css', import.meta.url), 'utf8');

test('NPP exposes the daily management workspace from every business screen', () => {
  assert.match(shellSource, /href="\/management"/);
  assert.match(shellSource, /Công việc hằng ngày/);
  assert.match(shellSource, /data-testid="nav-management-shortcut"/);
  assert.match(shellSource, /pathname\.startsWith\('\/management'\)/);
  assert.match(styleSource, /\.managementShortcut/);
});
