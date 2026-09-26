import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('shared file download keeps the object URL alive until the browser accepts the download', () => {
  const fileUtils = read('app/operations/data-exchange/data-exchange-file-utils.ts');
  const operational = read('app/components/operational-export-actions.tsx');
  assert.match(fileUtils, /window\.setTimeout\(\(\) => URL\.revokeObjectURL\(href\), 1000\)/);
  assert.doesNotMatch(fileUtils, /link\.remove\(\);\s*URL\.revokeObjectURL\(href\)/);
  assert.match(operational, /downloadBlob\(await response\.blob\(\), filenameForFormat\(filename, 'xlsx'\)\)/);
  assert.doesNotMatch(operational, /URL\.revokeObjectURL/);
});

test('CSV and single-sheet Excel continue to use the same shared download helper', () => {
  const fileUtils = read('app/operations/data-exchange/data-exchange-file-utils.ts');
  assert.match(fileUtils, /if \(format === 'csv'\) \{ downloadBlob/);
  assert.match(fileUtils, /downloadBlob\(await response\.blob\(\), filename\)/);
});
