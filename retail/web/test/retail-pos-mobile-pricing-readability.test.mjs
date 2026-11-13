import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Retail Lên đơn: đơn vị tính, đơn giá và thành tiền đủ lớn trên điện thoại', async () => {
  const [layout, workspace, css] = await Promise.all([
    read('app/layout.tsx'),
    read('app/retail-workspace.tsx'),
    read('app/retail-pos-entry.css'),
  ]);

  assert.match(layout, /import '\.\/retail-pos-entry\.css'/);
  const productRow = workspace.split('className={`cart-row editable compact-product-card')[1]?.split('</article>')[0];
  assert.ok(productRow, 'màn Lên đơn phải dùng cart-row editable');
  assert.match(productRow, /<em>\{displayUnit\(line\.unitName, line\.unitCode\)\}<\/em>/);
  assert.match(productRow, /aria-label={`Đơn giá \$\{line\.sku\}`}/);
  assert.match(productRow, /<dt>Thành tiền<\/dt>/);

  const readable = css.split('/* Retail POS: enlarge the unit and line-price fields')[1];
  assert.ok(readable, 'các điều chỉnh POS phải nằm trong file CSS được import');
  assert.match(readable, /\.compact-product-card \.line-main > em\s*\{[^}]*font-size:\s*clamp\(22px, 6vw, 27px\)/);
  assert.match(readable, /\.compact-product-card\.editable dl dd,[\s\S]*?font-size:\s*clamp\(22px, 5\.8vw, 26px\)/);
  assert.match(readable, /dl input\[aria-label\^="Đơn giá"\]\s*\{[^}]*min-height:\s*48px/);
  assert.match(readable, /@media \(max-width: 375px\)[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
});
