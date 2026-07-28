import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

test('pricing editors are controlled by workspace React state', async () => {
  const pricing = await source('../app/pricing/pricing-workspace.tsx');
  assert.match(pricing, /type EditorModal = 'channel' \| 'list' \| 'item' \| null/);
  assert.match(pricing, /useState<EditorModal>\(null\)/);
  assert.match(pricing, /open=\{editorModal === 'channel'\}/);
  assert.match(pricing, /open=\{editorModal === 'list'\}/);
  assert.match(pricing, /open=\{editorModal === 'item'\}/);
  assert.match(pricing, /add-sales-channel-button/);
  assert.match(pricing, /add-price-list-button/);
  assert.match(pricing, /add-price-item-button/);
  assert.doesNotMatch(pricing, /MutationObserver|document\.querySelector/);
});

test('document numbering editor uses React state and clears canceled modal errors', async () => {
  const numbering = await source('../app/document-numbering/document-numbering-workspace.tsx');
  assert.match(numbering, /const \[showForm, setShowForm\] = useState\(false\)/);
  assert.match(numbering, /<Modal[\s\S]*open=\{showForm\}/);
  assert.match(numbering, /number-series-modal/);
  assert.match(numbering, /function closeForm\(\) \{[\s\S]*setShowForm\(false\);[\s\S]*setError\(null\);[\s\S]*\}/);
  assert.doesNotMatch(numbering, /MutationObserver|document\.querySelector/);
});

test('shared modal provides dialog semantics, escape close, backdrop close and focus trap', async () => {
  const modal = await source('../app/components/modal.tsx');
  assert.match(modal, /role="dialog"/);
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /event\.key === 'Escape'/);
  assert.match(modal, /event\.target === event\.currentTarget/);
  assert.match(modal, /querySelectorAll<HTMLElement>\(FOCUSABLE\)/);
  assert.match(modal, /document\.body\.style\.overflow = 'hidden'/);
});
