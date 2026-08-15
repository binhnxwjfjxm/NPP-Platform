import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const editorSource = readFileSync(
  new URL('../app/purchasing/purchase-orders/components/PurchaseOrderEditorV4.tsx', import.meta.url),
  'utf8',
);
const editorStyles = readFileSync(
  new URL('../app/purchasing/purchase-orders/components/purchase-order-editor-v2.module.css', import.meta.url),
  'utf8',
);
const priceStyles = readFileSync(
  new URL('../app/purchasing/purchase-orders/components/purchase-order-price.module.css', import.meta.url),
  'utf8',
);

test('purchase order lines use a bounded dense grid for large drafts', () => {
  assert.match(
    editorStyles,
    /\.lineList\s*\{[\s\S]*?max-height:\s*min\(56vh,\s*620px\);[\s\S]*?overflow:\s*auto;[\s\S]*?scrollbar-gutter:\s*stable;/,
  );
  assert.match(
    editorStyles,
    /\.lineCard\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*minmax\(170px,\s*1\.05fr\)\s*minmax\(0,\s*5\.4fr\);[\s\S]*?padding:\s*6px\s*8px;/,
  );
  assert.match(
    editorStyles,
    /\.lineFields\s*\{[\s\S]*?grid-template-columns:[\s\S]*?minmax\(64px,\s*0\.45fr\)[\s\S]*?minmax\(300px,\s*2\.5fr\)[\s\S]*?minmax\(150px,\s*1fr\);/,
  );
  assert.match(
    editorStyles,
    /\.lineFields input,[\s\S]*?\.lineFields select\s*\{[\s\S]*?min-height:\s*30px;/,
  );
  assert.match(
    priceStyles,
    /\.priceRow\s*\{[\s\S]*?grid-column:\s*auto;[\s\S]*?padding:\s*0;[\s\S]*?border:\s*0;/,
  );
});

test('dense layout keeps every purchase-order line function', () => {
  for (const capability of [
    'Số lượng',
    'Đơn vị',
    'Quy đổi',
    'Đơn giá mua',
    'Nhập thủ công',
    'Dùng giá nhà cung cấp',
    'Áp lại giá',
    'Kiểu chiết khấu',
    'Giá trị chiết khấu',
    'Thuế suất %',
    'Lý do nhập giá thủ công',
    'Thành tiền dự kiến',
    'Ghi chú dòng',
    'Xóa dòng',
  ]) {
    assert.ok(editorSource.includes(capability), `missing preserved capability: ${capability}`);
  }

  assert.match(editorSource, /calculatePurchaseOrderDraftTotals\(/);
  assert.match(editorSource, /priceOverrideReason:\s*line\.priceOverrideReason\.trim\(\)/);
  assert.match(editorSource, /discountMode:\s*line\.discountMode/);
  assert.match(editorSource, /taxRate:\s*toApiDecimal\(line\.taxRate/);
});

test('mobile layout restores full-height cards instead of clipping functions', () => {
  assert.match(
    editorStyles,
    /@media \(max-width:\s*760px\)[\s\S]*?\.lineList\s*\{[\s\S]*?max-height:\s*none;[\s\S]*?overflow:\s*visible;/,
  );
  assert.match(
    priceStyles,
    /@media \(max-width:\s*900px\)[\s\S]*?\.priceRow\s*\{[\s\S]*?grid-template-columns:\s*1fr;/,
  );
});
