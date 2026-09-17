import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Popup chỉ hiện cách hiển thị sản lượng khi có chọn Sản lượng', () => {
  const dialog = read('app/components/sales-reporting-export-dialog.tsx');

  assert.match(dialog, /Hiển thị sản lượng/);
  assert.match(dialog, /Theo ĐVT bán/);
  assert.match(dialog, /Ưu tiên Thùng/);
  assert.match(dialog, /Ưu tiên ĐVT lẻ/);
  assert.match(dialog, /analysisMetrics\.includes\('quantity'\) \? \(/);
  assert.match(dialog, /name="sales-export-quantity-display"/);
});

test('Popup gửi quantityDisplay qua gateway chỉ khi xuất có Sản lượng', () => {
  const dialog = read('app/components/sales-reporting-export-dialog.tsx');
  const gateway = read('lib/sales-reporting-export-gateway.ts');

  assert.match(dialog, /if \(analysisMetrics\.includes\('quantity'\)\) query\.set\('quantityDisplay', quantityDisplay\)/);
  assert.match(gateway, /'quantityDisplay'/);
  assert.match(gateway, /ALLOWED_QUERY/);
});

test('Khi có Sản phẩm trong hai tiêu chí, Sản phẩm luôn là chiều dòng để gom đúng Product cha', () => {
  const dialog = read('app/components/sales-reporting-export-dialog.tsx');

  assert.match(dialog, /dimension === 'products'\) return Object\.freeze\(\['products', 'customerGroups'\]\)/);
  assert.match(dialog, /isAnalysisDimension\(dimension\)\) return Object\.freeze\(\['products', dimension\]\)/);
  assert.match(dialog, /next\.includes\('products'\)/);
  assert.match(dialog, /\['products', \.\.\.next\.filter/);
});

test('Ngôn ngữ popup là ngôn ngữ vận hành và không đưa tên contract kỹ thuật ra màn hình', () => {
  const dialog = read('app/components/sales-reporting-export-dialog.tsx');

  assert.match(dialog, /Loại báo cáo/);
  assert.match(dialog, /Số liệu cần xuất/);
  assert.match(dialog, /Phân tích theo · chọn 2/);
  assert.doesNotMatch(dialog, />\s*(sold|carton|base)\s*</);
  assert.doesNotMatch(dialog, /quantityDisplay=/);
});
