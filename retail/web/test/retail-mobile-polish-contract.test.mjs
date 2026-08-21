import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Retail mobile khóa ngang và giữ topbar pastel gọn', async () => {
  const [layout, css] = await Promise.all([read('app/layout.tsx'), read('app/retail-mobile-polish.css')]);
  assert.match(layout, /import '\.\/retail-mobile-polish\.css'/);
  assert.match(css, /html,\s*\nbody[\s\S]*?overflow-x:\s*hidden/);
  assert.match(css, /\.retail-issue675\s*\{[\s\S]*?overflow-x:\s*clip/);
  assert.match(css, /\.retail-issue675 \.retail-topbar[\s\S]*?min-height:\s*44px[\s\S]*?background:\s*rgba\(238, 248, 242, \.97\)/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*?margin-right:\s*-12px[\s\S]*?margin-left:\s*-12px/);
});

test('CTA Chọn sản phẩm và nút Xóa được canh lại rõ ràng', async () => {
  const css = await read('app/retail-mobile-polish.css');
  assert.match(css, /\.retail-issue675 \.choose-products[\s\S]*?display:\s*grid[\s\S]*?grid-template-columns:\s*38px minmax\(0, 1fr\) 20px/);
  assert.match(css, /\.retail-issue675 \.remove-line[\s\S]*?position:\s*absolute[\s\S]*?top:\s*10px[\s\S]*?right:\s*10px[\s\S]*?border-radius:\s*11px/);
  assert.match(css, /\.compact-product-card\.editable \.line-main[\s\S]*?padding-right:\s*58px/);
});

test('thanh In phiếu và Chốt đơn không còn card chung, mỗi nút có chiều sâu riêng', async () => {
  const css = await read('app/retail-mobile-polish.css');
  assert.match(css, /\.retail-issue675 \.order-action-bar[\s\S]*?display:\s*flex[\s\S]*?border:\s*0[\s\S]*?background:\s*transparent[\s\S]*?box-shadow:\s*none/);
  assert.match(css, /\.order-action-bar \.secondary-action[\s\S]*?box-shadow:\s*0 9px 22px/);
  assert.match(css, /\.order-action-bar \.primary-action[\s\S]*?box-shadow:\s*0 11px 24px/);
});
