import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = async (path) => readFile(new URL(path, root), 'utf8');

test('Delivery pins the iPhone app frame to the viewport without duplicating safe-area padding', async () => {
  const [layout, viewportFix, mobileApp, globals] = await Promise.all([
    read('app/layout.tsx'),
    read('app/delivery-viewport-fix.css'),
    read('app/delivery-mobile-app.css'),
    read('app/globals.css'),
  ]);

  const mobileImport = layout.indexOf("import './delivery-mobile-app.css';");
  const viewportImport = layout.indexOf("import './delivery-viewport-fix.css';");
  assert.ok(mobileImport >= 0 && viewportImport > mobileImport);

  assert.match(viewportFix, /@media \(max-width: 759px\)/);
  assert.match(viewportFix, /\.deliveryAppFrame\s*\{[\s\S]*?position:\s*fixed/);
  assert.match(viewportFix, /\.deliveryAppFrame\s*\{[\s\S]*?inset:\s*0/);
  assert.match(viewportFix, /\.deliveryAppFrame\s*\{[\s\S]*?height:\s*auto/);
  assert.match(viewportFix, /\.deliveryAppFrame\s*\{[\s\S]*?min-height:\s*0/);
  assert.doesNotMatch(viewportFix, /safe-area-inset-bottom/);

  assert.match(globals, /\*\s*\{\s*box-sizing:\s*border-box;\s*\}/);
  assert.match(mobileApp, /grid-template-rows:\s*auto minmax\(0, 1fr\) calc\(64px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(mobileApp, /\.deliveryAppDock\s*\{[\s\S]*?min-height:\s*calc\(64px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(mobileApp, /\.deliveryAppDock\s*\{[\s\S]*?padding:\s*5px 7px calc\(5px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(mobileApp, /\.deliveryDockItem\s*\{[\s\S]*?min-height:\s*48px/);
});
