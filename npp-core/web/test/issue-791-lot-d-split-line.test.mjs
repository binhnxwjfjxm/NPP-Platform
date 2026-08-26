import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const formPath = new URL('../app/sales/sales-orders/SalesOrderCommercialForm.tsx', import.meta.url);

test('Issue #791 Lô D keeps Add unique-only and exposes Tách dòng for an independent duplicate line', async () => {
  const form = await readFile(formPath, 'utf8');

  assert.match(form, /Hàng này đã có trong đơn\. Dùng Tách dòng nếu cần thêm dòng riêng\./);
  assert.match(form, /function splitLine\(sourceClientLineId: string\)/);
  assert.match(form, /if \(!canPriceOverride\) return onError\('Cần quyền Sửa giá bán trên đơn để tách dòng\.'\)/);
  assert.match(form, /clientLineId: crypto\.randomUUID\(\)/);
  assert.match(form, /quantity: '1'/);
  assert.match(form, /manualUnitPriceMinor: '0'/);
  assert.match(form, /discountMode: 'PERCENT'/);
  assert.match(form, /discountValue: '0'/);
  assert.match(form, /\.\.\.current\.slice\(0, sourceIndex \+ 1\), split, \.\.\.current\.slice\(sourceIndex \+ 1\)/);
  assert.match(form, /focusLinePrice\(split\.clientLineId\)/);
  assert.match(form, />↳ Tách dòng<\/button>/);
});

test('Issue #791 Lô D keys repricing and async Add updates by client line identity, not SKU identity', async () => {
  const form = await readFile(formPath, 'utf8');

  assert.match(form, /const priceRefs = useRef\(new Map<string, HTMLInputElement>\(\)\)/);
  assert.match(form, /clientLineId: line\.clientLineId/);
  assert.match(form, /const byLineId = new Map\(results\.map\(\(result\) => \[result\.clientLineId, result\]\)\)/);
  assert.match(form, /byLineId\.get\(line\.clientLineId\)/);
  assert.match(form, /line\.clientLineId === pending\.clientLineId/);
  assert.doesNotMatch(form, /const byVariant = new Map/);
});
