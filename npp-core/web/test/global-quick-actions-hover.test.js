import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../app/components/global-quick-actions.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/components/global-quick-actions.module.css', import.meta.url), 'utf8');

test('Công Ty quick actions keep click behavior and add mouse hover expansion', () => {
  assert.match(source, /event\.pointerType !== 'mouse'/);
  assert.match(source, /onPointerEnter=\{handlePointerEnter\}/);
  assert.match(source, /onPointerLeave=\{handlePointerLeave\}/);
  assert.match(source, /onClick=\{\(\) => setOpen\(\(current\) => !current\)\}/);
  assert.match(source, /event\.key === 'Escape'/);
});

test('Công Ty quick actions use a responsive layered visual treatment with safe motion fallback', () => {
  assert.match(css, /linear-gradient\(135deg, #6366f1 0%, #4f46e5 46%, #2563eb 100%\)/);
  assert.match(css, /backdrop-filter: blur\(16px\) saturate\(145%\)/);
  assert.match(css, /padding-bottom: 14px/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
