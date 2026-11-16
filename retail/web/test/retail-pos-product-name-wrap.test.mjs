import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Retail Lên đơn: tên hàng dài tự xuống dòng, không ẩn bằng dấu ba chấm', async () => {
  const [layout, workspace, globalCss, posCss] = await Promise.all([
    read('app/layout.tsx'),
    read('app/retail-workspace.tsx'),
    read('app/globals.css'),
    read('app/retail-pos-entry.css'),
  ]);

  assert.match(layout, /import '\\.\\/retail-pos-entry\\.css'/);
  assert.match(globalCss, /\\.line-main strong, \\.product-copy strong \\{[^}]*text-overflow: ellipsis; white-space: nowrap;/);

  const saved = workspace.split('className={`cart-row cart-row-saved compact-product-card')[1]?.split('</article>')[0];
  const editable = workspace.split('className={`cart-row editable compact-product-card')[1]?.split('</article>')[0];
  assert.ok(saved && editable, 'cả đơn đã lưu và giỏ đang sửa phải dùng compact-product-card');
  assert.match(saved, /<div className="line-main"><strong>\\{line\\.itemName\\}<\\/strong>/);
  assert.match(editable, /<div className="line-main"><strong>\\{line\\.productName\\}<\\/strong>/);
  assert.match(editable, /className="quantity-stepper"/);
  assert.match(editable, /className="remove-line"/);
  assert.match(editable, /<dt>Đơn giá<\\/dt>/);

  const rule = posCss.match(/\\.retail-issue675 \\.compact-product-card \\.line-main > strong\\s*\\{([^}]*)\\}/)?.[1];
  assert.ok(rule, 'tên hàng có CSS riêng ghi đè luật cắt một dòng ở globals');
  assert.match(rule, /white-space:\\s*normal\\s*;/);
  assert.match(rule, /text-overflow:\\s*clip\\s*;/);
  assert.match(rule, /overflow:\\s*visible\\s*;/);
  assert.match(rule, /overflow-wrap:\\s*anywhere\\s*;/);
  assert.doesNotMatch(rule, /line-clamp|max-height|nowrap|ellipsis/);
});
