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

test('Thao tác nhanh Trang chủ căn giữa icon và chữ, không còn card màu trang trí lệch', async () => {
  const css = await read('app/retail-home-polish.css');
  assert.match(css, /\.compact-home-actions button \{[\s\S]*display: flex/);
  assert.match(css, /align-items: center/);
  assert.match(css, /justify-content: center/);
  assert.match(css, /text-align: center/);
  assert.match(css, /button::after \{[\s\S]*content: none/);
  assert.doesNotMatch(css, /#e2f0fb|#eee6f9/);
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

test('Thiết lập in trên mobile chỉ lưu khổ giấy và có In thử thật qua giao diện in của thiết bị', async () => {
  const [workspace, css] = await Promise.all([
    read('app/retail-workspace.tsx'),
    read('app/retail-final-polish.css'),
  ]);
  assert.match(workspace, /<strong>Thiết lập in<\/strong>/);
  assert.match(workspace, /Khổ giấy mặc định/);
  assert.match(workspace, /onClick=\{printTest\}>In thử<\/button>/);
  assert.match(workspace, /function printTest\(\)/);
  assert.match(workspace, /window\.print\(\)/);
  assert.match(workspace, /Retail chỉ lưu khổ giấy, không giả trạng thái đã kết nối máy in/);
  assert.doesNotMatch(workspace, /Máy in Wi-Fi được chọn trong hộp thoại in của thiết bị/);
  assert.doesNotMatch(css, /Máy in hiện tại · Chọn khi in|Máy in chọn khi bấm In/);
  assert.match(css, /\.printer-test-screen/);
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

test('layout nạp final polish sau các lớp Retail trước đó', async () => {
  const layout = await read('app/layout.tsx');
  const homeIndex = layout.indexOf("import './retail-home-polish.css'");
  const finalIndex = layout.indexOf("import './retail-final-polish.css'");
  assert.ok(homeIndex >= 0 && finalIndex > homeIndex);
});
