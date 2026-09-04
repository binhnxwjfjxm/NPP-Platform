import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('popup máy in Retail mobile dùng bố cục 5 bước và action cố định', async () => {
  const [panel, pairing, css] = await Promise.all([
    read('app/printer-settings-panel.tsx'),
    read('app/retail-print-windows-pairing.tsx'),
    read('app/retail-printer.css'),
  ]);

  assert.match(panel, /<strong>Chọn cách in<\/strong>/);
  assert.match(panel, /printer-device-step/);
  assert.match(panel, /<strong>Cài đặt in<\/strong>/);
  assert.match(panel, /printer-status-step/);
  assert.match(panel, /printer-settings-actions/);

  assert.match(pairing, /printer-pairing-card/);
  assert.match(pairing, /Thiết bị đã kết nối/);
  assert.match(pairing, /printer-agent-status/);

  assert.match(css, /counter-reset:\s*printer-step/);
  assert.match(css, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /position:\s*sticky/);
  assert.match(css, /@media \(max-width: 360px\)/);
});
