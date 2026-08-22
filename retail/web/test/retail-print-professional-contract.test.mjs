import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const readRepo = (path) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');

test('phiếu Retail lấy tên sản phẩm thật mà không đổi snapshot của Công Ty', async () => {
  const [gateway, service, route, workspace] = await Promise.all([
    read('app/api/retail/[...segments]/route.ts'),
    readRepo('npp-core/api/src/services/retail-product-labels.js'),
    readRepo('npp-core/api/src/routes/retail-catalog.js'),
    read('app/retail-workspace.tsx'),
  ]);

  assert.match(service, /product\.name AS product_name/);
  assert.match(service, /variant\.name AS variant_name/);
  assert.match(route, /url\.pathname === '\/api\/retail\/product-labels'/);
  assert.match(route, /options\.PERMISSIONS\.coreProductRead/);
  assert.match(gateway, /path: '\/api\/retail\/product-labels'/);
  assert.match(gateway, /itemName: productName/);
  assert.match(gateway, /retailVariantName: label\?\.variantName/);
  assert.match(gateway, /presentationOrderNumber/);
  assert.match(gateway, /return number \|\| 'Đơn đang lập'/);
  assert.match(workspace, /<strong>\{line\.itemName\}<\/strong><small>\{line\.sku\}<\/small>/);
});

test('A4 A5 cân header và 80 58 dùng bố cục receipt riêng thay vì bảng thu nhỏ', async () => {
  const [layout, css, baseCss] = await Promise.all([
    read('app/layout.tsx'),
    read('app/retail-print-professional.css'),
    read('app/retail-lot7.css'),
  ]);

  assert.match(layout, /import '\.\/retail-final-polish\.css';\s*import '\.\/retail-print-professional\.css';/);
  assert.match(css, /\.paper-a4 \.print-document > header,\s*\.paper-a5 \.print-document > header/);
  assert.match(css, /grid-template-columns: minmax\(0, 1\.25fr\) minmax\(190px, \.75fr\)/);
  assert.match(css, /white-space: nowrap/);
  assert.match(css, /\.paper-80 \.print-document thead,\s*\.paper-58 \.print-document thead \{\s*display: none/);
  assert.match(css, /td:first-child:not\(:has\(> strong\)\)/);
  assert.match(css, /td:has\(> strong\)/);
  assert.match(css, /flex-wrap: wrap/);
  assert.match(css, /print-grand-total strong/);
  assert.doesNotMatch(css, /\.paper-80 \.print-document th.*font-size: 9px/);
  assert.match(baseCss, /\.paper-80 \.print-document/);
});

test('thiết lập in mobile vẫn chỉ lưu khổ giấy và mở giao diện in thật', async () => {
  const workspace = await read('app/retail-workspace.tsx');
  assert.match(workspace, /<strong>Thiết lập in<\/strong>/);
  assert.match(workspace, /Khổ giấy mặc định/);
  assert.match(workspace, /onClick=\{printTest\}>In thử/);
  assert.match(workspace, /window\.print\(\)/);
  assert.match(workspace, /điện thoại sẽ mở giao diện chọn máy in của thiết bị/);
  assert.doesNotMatch(workspace, /Máy in hiện tại/);
});
