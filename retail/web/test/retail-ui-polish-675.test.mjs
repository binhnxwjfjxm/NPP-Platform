import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Retail Trang chủ có đúng hero asset ở public và vẫn có fallback nếu ảnh lỗi', async () => {
  const [workspace, css, hero] = await Promise.all([
    read('app/retail-workspace.tsx'),
    read('app/retail-final-polish.css'),
    stat(new URL('../public/01-hero-nganh-hang.webp', import.meta.url)),
  ]);
  assert.match(workspace, /src="\/01-hero-nganh-hang\.webp"/);
  assert.ok(hero.size > 100_000, 'hero asset phải là ảnh thật, không phải placeholder');
  assert.match(css, /\.home-feature-art\[hidden\] \+ \.home-feature-copy/);
});

test('Login dùng logo Công Ty có cache bust mới và fallback icon Retail', async () => {
  const [login, css] = await Promise.all([
    read('app/login/page.tsx'),
    read('app/retail-final-polish.css'),
  ]);
  assert.match(login, /logo-transparent\.png\?v=20260822/);
  assert.match(login, /pwa-icon-retail\.png\?v=3/);
  assert.match(css, /\.retail-login-card \.company-login-logo/);
  assert.match(css, /display: block !important/);
  assert.match(css, /visibility: visible !important/);
});

test('Thao tác nhanh Trang chủ là card nổi không viền và icon không bị nhốt trong ô xám', async () => {
  const css = await read('app/retail-home-polish.css');
  assert.match(css, /\.compact-home-actions button \{[\s\S]*display: flex/);
  assert.match(css, /align-items: center/);
  assert.match(css, /justify-content: center/);
  assert.match(css, /border: 0/);
  assert.match(css, /box-shadow:[\s\S]*inset 0 1px 0/);
  assert.match(css, /button:first-child \{[\s\S]*linear-gradient\(180deg, #effaf3 0%, #dff2e7 100%\)/);
  assert.match(css, /button > span \{[\s\S]*background: transparent/);
  assert.match(css, /button > span::before \{[\s\S]*filter: drop-shadow/);
  assert.match(css, /button:active \{[\s\S]*translateY\(2px\)/);
  assert.match(css, /button::after \{[\s\S]*content: none/);
  assert.doesNotMatch(css, /border: 1px solid #dce6df|border-color: #88cca2|background: #f0f6f2|background: #d8f0e1/);
});

test('Nút thêm sản phẩm ngoài đơn và nút cộng trong danh sách có CTA rõ, icon cộng căn giữa', async () => {
  const css = await read('app/retail-final-polish.css');
  assert.match(css, /\.retail-issue675 \.choose-products \{/);
  assert.match(css, /\.retail-issue675 \.product-sheet \.add-product \{/);
  assert.match(css, /\.product-sheet \.add-product::before/);
  assert.match(css, /background: #18864c/);
  assert.match(css, /font-size: 0/);
  assert.match(css, /place-items: center/);
});

test('Thiết lập in mobile có direct Wi-Fi khi native bridge tồn tại và fallback hệ thống khi không có', async () => {
  const [workspace, printerPanel, printerCss, bridge, baseCss] = await Promise.all([
    read('app/retail-workspace.tsx'),
    read('app/printer-settings-panel.tsx'),
    read('app/retail-printer.css'),
    read('lib/printer-bridge.ts'),
    read('app/retail-final-polish.css'),
  ]);
  assert.match(workspace, /<strong>Thiết lập in<\/strong>/);
  assert.match(workspace, /PrinterSettingsPanel/);
  assert.match(workspace, /printWithConfiguredPrinter/);
  assert.match(printerPanel, /In Wi‑Fi trực tiếp/);
  assert.match(printerPanel, /In bằng hệ thống/);
  assert.match(printerPanel, /Tìm máy in/);
  assert.match(printerPanel, /In thử/);
  assert.match(bridge, /window\.RetailPrinterBridge/);
  assert.match(bridge, /window\.localStorage\.setItem/);
  assert.doesNotMatch(bridge, /fetch\(/);
  assert.match(printerCss, /\.printer-methods/);
  assert.match(baseCss, /\.printer-test-screen/);
});

test('A4 và A5 chia header phiếu hai bên, giấy nhiệt giữ một cột', async () => {
  const css = await read('app/retail-final-polish.css');
  assert.match(css, /\.paper-a4 \.print-document > header,[\s\S]*\.paper-a5 \.print-document > header \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(css, /\.paper-a4 \.print-document > header h1,[\s\S]*text-align: right/);
  assert.match(css, /\.paper-80 \.print-document > header,[\s\S]*\.paper-58 \.print-document > header \{[\s\S]*grid-template-columns: 1fr/);
  assert.match(css, /\.paper-80 \.print-document > header > \*,[\s\S]*text-align: center !important/);
});

test('Tiêu đề đơn và phiếu in có hierarchy riêng thay vì header thô', async () => {
  const css = await read('app/retail-final-polish.css');
  assert.match(css, /\.retail-issue675 \.order-identity/);
  assert.match(css, /\.order-document::before/);
  assert.match(css, /\.print-document > header h1/);
  assert.match(css, /\.print-document > header small/);
});

test('layout nạp final polish sau các lớp Retail trước đó và nạp lớp máy in riêng', async () => {
  const layout = await read('app/layout.tsx');
  const homeIndex = layout.indexOf("import './retail-home-polish.css'");
  const finalIndex = layout.indexOf("import './retail-final-polish.css'");
  const printerIndex = layout.indexOf("import './retail-printer.css'");
  assert.ok(homeIndex >= 0 && finalIndex > homeIndex);
  assert.ok(printerIndex > finalIndex);
});
