import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const formSource = readFileSync(
  new URL('../app/sales/sales-orders/SalesOrderForm.tsx', import.meta.url),
  'utf8',
);

test('editor keeps the order identity captured when the form opens', () => {
  assert.match(formSource, /type SalesOrderEditorTarget = Readonly<\{/);
  assert.match(formSource, /const editorTargetRef = useRef<SalesOrderEditorTarget \| null>\(null\)/);
  assert.match(
    formSource,
    /editorTargetRef\.current = captureSalesOrderEditorTarget\(props\.mode, props\.orderId, props\.version\)/,
  );
  assert.match(formSource, /orderId: mode === 'create' \? undefined : orderId/);
  assert.match(formSource, /normalizeVersionForEditing\(editorTarget\.version \?\? copyVersion\)/);
  assert.match(formSource, /mode=\{editorTarget\.mode\}/);
  assert.match(formSource, /orderId=\{editorTarget\.orderId\}/);
  assert.match(
    formSource,
    /key=\{`\$\{editorTarget\.mode\}:\$\{editorTarget\.orderId \?\? 'new-sales-order'\}:\$\{normalizedVersion\?\.id \?\? 'no-version'\}`\}/,
  );
  assert.doesNotMatch(formSource, /orderId=\{props\.orderId\}/);
});

test('create mode never inherits the currently selected order id', () => {
  assert.match(
    formSource,
    /return Object\.freeze\(\{\s*mode,\s*orderId: mode === 'create' \? undefined : orderId,\s*version: version \?\? null,/s,
  );
});
