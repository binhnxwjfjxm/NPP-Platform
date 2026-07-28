import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');

test('pricing explains priority and price selection in office language', async () => {
  const [copy, page] = await Promise.all([
    readSource('../app/components/business-language-boundary.tsx'),
    readSource('../app/pricing/page.tsx'),
  ]);
  assert.match(page, /scope="pricing"/);
  assert.match(copy, /Thứ tự ưu tiên áp dụng/);
  assert.match(copy, /Khi nhiều bảng giá cùng phù hợp, hệ thống ưu tiên bảng có số cao hơn/);
  assert.match(copy, /Kiểm tra giá áp dụng/);
  assert.match(copy, /Diễn giải cách tính giá/);
});

test('document numbering uses office terminology and shows an example', async () => {
  const [copy, page] = await Promise.all([
    readSource('../app/components/business-language-boundary.tsx'),
    readSource('../app/document-numbering/page.tsx'),
  ]);
  assert.match(page, /scope="document-numbering"/);
  assert.match(copy, /Chu kỳ đánh lại số/);
  assert.match(copy, /Số chữ số/);
  assert.match(copy, /Số thứ tự tiếp theo/);
  assert.match(copy, /HĐ-2026-000001/);
  assert.match(copy, /Tự động tạo số chứng từ/);
});

test('inventory separates lookup from one-time opening setup', async () => {
  const [types, balances, opening, copy] = await Promise.all([
    readSource('../lib/inventory-types.ts'),
    readSource('../app/inventory/balances/page.tsx'),
    readSource('../app/inventory/opening-balances/page.tsx'),
    readSource('../app/components/business-language-boundary.tsx'),
  ]);
  assert.match(types, /Tra cứu tồn kho/);
  assert.match(types, /Thiết lập tồn đầu kỳ/);
  assert.match(balances, /Số lượng hiện tại, khả dụng, đang giữ và vị trí hàng/);
  assert.match(opening, /Dùng một lần khi bắt đầu sử dụng hệ thống hoặc chuyển dữ liệu cũ/);
  assert.match(copy, /Thông tin bổ sung/);
  assert.match(copy, /Dữ liệu các dòng hàng/);
  assert.match(copy, /Xác nhận ghi nhận tồn đầu kỳ/);
});
