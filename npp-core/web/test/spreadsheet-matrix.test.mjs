import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');

async function loadSpreadsheetModule() {
  const source = readFileSync(new URL('../lib/spreadsheet-matrix.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const url = `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`;
  return import(url);
}

test('XLSX XML parser accepts namespace-prefixed worksheet tags', async () => {
  const { parseWorksheetXml } = await loadSpreadsheetModule();
  const xml = `<?xml version="1.0" encoding="utf-8"?>
    <x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <x:sheetData>
        <x:row r="1">
          <x:c r="A1" t="str"><x:v>SKU</x:v></x:c>
          <x:c r="B1" t="inlineStr"><x:is><x:t>Khối lượng</x:t></x:is></x:c>
          <x:c r="C1" t="str"><x:v>ĐVT</x:v></x:c>
        </x:row>
        <x:row r="2">
          <x:c r="A2" t="str"><x:v>SKU-001</x:v></x:c>
          <x:c r="B2" t="n"><x:v>0.6</x:v></x:c>
          <x:c r="C2" t="str"><x:v>kg</x:v></x:c>
        </x:row>
      </x:sheetData>
    </x:worksheet>`;

  assert.deepEqual(parseWorksheetXml(xml, []), [
    ['SKU', 'Khối lượng', 'ĐVT'],
    ['SKU-001', '0.6', 'kg'],
  ]);
});

test('XLSX XML parser keeps unprefixed worksheet compatibility', async () => {
  const { parseWorksheetXml } = await loadSpreadsheetModule();
  const xml = `<worksheet><sheetData><row r="1"><c r="A1" t="str"><v>SKU</v></c><c r="B1" t="n"><v>1.25</v></c></row></sheetData></worksheet>`;

  assert.deepEqual(parseWorksheetXml(xml, []), [['SKU', '1.25']]);
});

test('XLSX XML parser accepts namespace-prefixed shared strings', async () => {
  const { parseSharedStringsXml, parseWorksheetXml } = await loadSpreadsheetModule();
  const sharedXml = `<x:sst xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:si><x:t>SKU-002</x:t></x:si><x:si><x:t>kg</x:t></x:si></x:sst>`;
  const sharedStrings = parseSharedStringsXml(sharedXml);
  const worksheetXml = `<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1" t="s"><x:v>1</x:v></x:c></x:row></x:sheetData></x:worksheet>`;

  assert.deepEqual(sharedStrings, ['SKU-002', 'kg']);
  assert.deepEqual(parseWorksheetXml(worksheetXml, sharedStrings), [['SKU-002', 'kg']]);
});
