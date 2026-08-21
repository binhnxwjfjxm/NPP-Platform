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

test('Login dùng logo Công Ty có cache bust và fallback icon Retail', async () => {
  const [login, css] = await Promise.all([
    read('app/login/page.tsx'),
    read('app/retail-final-polish.css'),
  ]);
  assert.match(login, /logo-transparent\.png\?v=20260821/);
  assert.match(login, /pwa-icon-retail\.png\?v=2/);
  assert.match(css, /\.retail-login-card \.company-login-logo/);
});

test('Cài đặt Máy in nói rõ boundary chọn máy của hộp thoại hệ thống', async () => {
  const [workspace, css] = await Promise.all([
    read('app/retail-workspace.tsx'),
    read('app/retail-final-polish.css'),
  ]);
  assert.match(workspace, /<strong>Máy in<\/strong>/);
  assert.match(workspace, /Máy in Wi-Fi được chọn trong hộp thoại in của thiết bị/);
  assert.match(css, /Máy in hiện tại · Chọn khi in/);
  assert.match(css, /Máy in chọn khi bấm In/);
  assert.doesNotMatch(css, /Đã kết nối/);
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
