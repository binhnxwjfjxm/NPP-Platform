import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Mẫu phiếu Retail có preview trực tiếp và cỡ chữ lưu dùng chung', () => {
  const workspace = read('app/retail-workspace.tsx');
  const preview = read('app/retail-print-template-preview.tsx');
  const css = read('app/retail-print-template-editor.css');
  const layout = read('app/layout.tsx');
  const bridge = read('lib/printer-bridge.ts');

  assert.match(workspace, /RetailPrintTemplatePreview/);
  assert.match(workspace, /templateFontSizePercent/);
  assert.match(workspace, /fontSizePercent: templateFontSizePercent/);
  assert.match(workspace, /--retail-print-font-scale/);
  assert.doesNotMatch(workspace, /disabled=\{!order\}>Xem trước<\/button>/);

  assert.match(preview, /Xem trước thực tế/);
  assert.match(preview, /className="print-document"/);
  assert.match(preview, /visibleFieldKeys/);
  assert.match(preview, /dữ liệu mẫu/);

  assert.match(css, /template-font-size-stepper/);
  assert.match(css, /--retail-print-font-scale/);
  assert.match(css, /template-preview-stage/);
  assert.match(layout, /retail-print-template-editor\.css/);

  assert.match(bridge, /fontSizePercent\?: number/);
  assert.match(bridge, /fontSizePercent: safeFontSizePercent/);
  assert.match(bridge, /visibleFields\.has\('line_sku'\)/);
});
