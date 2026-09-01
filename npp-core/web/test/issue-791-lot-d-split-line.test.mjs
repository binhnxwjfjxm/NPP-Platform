import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const formPath = new URL('../app/sales/sales-orders/SalesOrderCommercialForm.tsx', import.meta.url);

test('Issue #791 Lô D keeps Add unique-only and Tách dòng creates an independent repriced line', async () => {
  const form = await readFile(formPath, 'utf8');

  assert.match(form, /Hàng này đã có trong đơn\. Dùng Tách dòng nếu cần thêm dòng riêng\./);
  assert.match(form, /async function splitLine\(sourceClientLineId: string\)/);
  assert.match(form, /if \(!canPriceOverride\) return onError\('Cần quyền Sửa giá bán trên đơn để tách dòng\.'\)/);
  assert.match(form, /clientLineId: crypto\.randomUUID\(\)/);
  assert.match(form, /quantity: '1'/);
  assert.match(form, /manualUnitPriceMinor: ''/);
  assert.match(form, /discountMode: 'PERCENT'/);
  assert.match(form, /discountValue: '0'/);
  const splitBlock = form.match(/const split: LineDraft = \{[\s\S]*?\n    \};/)?.[0] ?? '';
  assert.match(splitBlock, /baseUnitPriceMinor: '0'/);
  assert.match(splitBlock, /systemUnitPriceMinor: '0'/);
  assert.match(splitBlock, /pricingFingerprint: ''/);
  assert.match(splitBlock, /priceSteps: \[\]/);
  assert.match(splitBlock, /resolvingPrice: true/);
  assert.doesNotMatch(splitBlock, /resolvingPrice: false/);
  assert.match(form, /\.\.\.current\.slice\(0, sourceIndex \+ 1\), split, \.\.\.current\.slice\(sourceIndex \+ 1\)/);
  assert.match(form, /focusLineVariant\(split\.clientLineId\)/);
  assert.match(form, /variantId: split\.variantId,[\s\S]*?quantity: '1'/);
  assert.match(form, />↳ Tách dòng<\/button>/);
});

test('Issue #791 Lô D keys repricing and async updates by client line identity, not SKU identity', async () => {
  const form = await readFile(formPath, 'utf8');

  assert.match(form, /const priceRefs = useRef\(new Map<string, HTMLInputElement>\(\)\)/);
  assert.match(form, /clientLineId: line\.clientLineId/);
  assert.match(form, /const byLineId = new Map\(results\.map\(\(result\) => \[result\.clientLineId, result\]\)\)/);
  assert.match(form, /byLineId\.get\(line\.clientLineId\)/);
  assert.match(form, /line\.clientLineId === pending\.clientLineId/);
  assert.match(form, /line\.clientLineId === split\.clientLineId/);
  assert.doesNotMatch(form, /const byVariant = new Map/);
});

test('Lô 2 switches the real sellable ĐVT variant on every line and reprices from canonical pricing', async () => {
  const form = await readFile(formPath, 'utf8');

  assert.match(form, /productId: string \| null;/);
  assert.match(form, /conversionToBase: string;/);
  assert.match(form, /productId: null,[\s\S]*?variantId: line\.variantId,[\s\S]*?conversionToBase: line\.conversionToBase/);
  assert.match(form, /productId: option\.productId,[\s\S]*?variantId: option\.id,[\s\S]*?conversionToBase: option\.conversionToBase \?\? '1'/);
  assert.match(form, /apiRequest<ProductVariant\[\]>\(`\/api\/products\/\$\{productId\}\/variants`\)/);
  assert.match(form, /variant\.is_active && variant\.is_sellable/);
  assert.match(form, /variant\.variant_kind === 'BASE' \|\| variant\.variant_kind === 'CARTON'/);
  assert.match(form, /async function changeLineVariant\(clientLineId: string, nextVariantId: string\)/);
  assert.match(form, /variantId: option\.id,[\s\S]*?sku: option\.sku,[\s\S]*?unitCode: option\.unit_code \?\? '',[\s\S]*?conversionToBase: option\.conversion_to_base \?\? '1'/);
  assert.match(form, /manualUnitPriceMinor: '',[\s\S]*?baseUnitPriceMinor: '0',[\s\S]*?systemUnitPriceMinor: '0',[\s\S]*?pricingFingerprint: ''/);
  assert.match(form, /variantId: option\.id,[\s\S]*?quantity: source\.quantity,[\s\S]*?effectiveAt: pricingAt/);
  assert.match(form, /data-testid={`sales-line-variant-select-\$\{index \+ 1\}`}/);
  assert.match(form, /className=\{styles\.directPriceInput\}[\s\S]*?data-testid=\{`sales-line-variant-select-/);
  assert.match(form, /onChange=\{\(event\) => void changeLineVariant\(line\.clientLineId, event\.target\.value\)\}/);
  assert.match(form, /<span>Hàng hóa<\/span><span>ĐVT<\/span><span>SL<\/span>/);
  assert.match(form, /const unitLabel = variant\.unit_name\?\.trim\(\) \|\| variant\.unit_symbol\?\.trim\(\) \|\| variant\.unit_code\?\.trim\(\);/);
  assert.match(form, /if \(unitLabel\) return unitLabel;/);
  assert.match(form, /aria-label=\{`Chọn ĐVT cho \$\{line\.sku\}`\}/);
  assert.doesNotMatch(form, /Đơn vị bán · Lẻ\/Thùng/);
  assert.doesNotMatch(form, /Quy đổi kho/);
  assert.match(form, /lines: lines\.map\(\(line\) => \(\{[\s\S]*?variantId: line\.variantId/);
});
