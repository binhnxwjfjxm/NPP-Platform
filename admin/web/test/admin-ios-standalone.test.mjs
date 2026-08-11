import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = async (path) => readFile(new URL(path, root), 'utf8');

test('Admin iOS standalone shell avoids the WebKit top-inset bottom-gap contract', async () => {
  const [layout, mobileCss] = await Promise.all([
    read('app/layout.tsx'),
    read('app/admin-mobile-app.css'),
  ]);

  assert.match(layout, /viewportFit:\s*'cover'/);
  assert.match(layout, /statusBarStyle:\s*'black'/);
  assert.doesNotMatch(layout, /statusBarStyle:\s*'black-translucent'/);

  assert.match(mobileCss, /@media \(max-width: 760px\) and \(display-mode: standalone\)/);
  assert.match(mobileCss, /\.adminAppShell[\s\S]*?height:\s*100%;/);
  assert.match(mobileCss, /\.adminAppShell\s*\{[\s\S]*?height:\s*100vh;/);
  assert.doesNotMatch(mobileCss, /\.adminAppShell\s*\{\s*position:\s*fixed;/);
  assert.doesNotMatch(mobileCss, /\.adminAppShell\s*\{[\s\S]*?inset:\s*0;/);
  assert.doesNotMatch(mobileCss, /100dvh|100svh/);
});
