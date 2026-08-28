import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('khổ nhiệt của in đơn thật được tính theo chiều dài nội dung trước khi mở giao diện in', async () => {
  const [layout, sizer, workspace] = await Promise.all([
    read('app/layout.tsx'),
    read('app/retail-system-print-page-sizer.tsx'),
    read('app/retail-workspace.tsx'),
  ]);

  assert.match(layout, /RetailSystemPrintPageSizer/);
  assert.match(layout, /<RetailSystemPrintPageSizer \/>/);
  assert.match(sizer, /MutationObserver/);
  assert.match(sizer, /observer\.observe\(document\.head, \{ childList: true \}\)/);
  assert.match(sizer, /style\[data-retail-print-page="true"\]/);
  assert.match(sizer, /\.print-screen \.print-document/);
  assert.match(sizer, /paper-80/);
  assert.match(sizer, /paper-58/);
  assert.match(sizer, /getBoundingClientRect\(\)\.height/);
  assert.match(sizer, /MILLIMETERS_PER_INCH = 25\.4/);
  assert.match(sizer, /CSS_PIXELS_PER_INCH = 96/);
  assert.match(sizer, /THERMAL_HEIGHT_SAFETY_MM = 1/);
  assert.match(sizer, /Math\.ceil/);
  assert.match(sizer, /`@page \{ size: \$\{widthMm\}mm \$\{heightMm\}mm; margin: 4mm; \}`/);
  assert.match(workspace, /requestAnimationFrame\(\(\) => \{/);
  assert.match(workspace, /addEventListener\('afterprint', cleanup/);
  assert.match(workspace, /setTimeout\(cleanup, 120000\)/);
});
