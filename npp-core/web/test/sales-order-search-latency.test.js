import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Lập đơn không còn tính lại toàn bộ đơn mỗi lần thêm hàng hoặc đổi một số lượng', async () => {
  const form = await read('app/sales/sales-orders/SalesOrderCommercialForm.tsx');
  assert.match(form, /const SEARCH_DELAY_MS = 0;/);
  assert.match(form, /const REPRICE_CONCURRENCY = 4;/);
  assert.match(form, /runWithConcurrency/);
  assert.match(form, /quantitySnapshotRef/);
  assert.match(form, /quantityRepricePendingRef/);

  const quantityEffectStart = form.indexOf('const quantitySignature =');
  const quantityEffectEnd = form.indexOf('function focusLineQuantity', quantityEffectStart);
  assert.ok(quantityEffectStart > 0 && quantityEffectEnd > quantityEffectStart);
  const quantityEffect = form.slice(quantityEffectStart, quantityEffectEnd);
  assert.match(quantityEffect, /previousQuantity !== undefined && previousQuantity !== quantity/);
  assert.match(quantityEffect, /quantityRepricePendingRef\.current\.add\(clientLineId\)/);
  assert.match(quantityEffect, /repriceLines\(changedLines, effectiveAt\)/);
  assert.doesNotMatch(quantityEffect, /repriceAll\(/);
});

test('Tính lại toàn đơn chỉ còn cho thay đổi ngữ cảnh giá và chạy có giới hạn đồng thời', async () => {
  const form = await read('app/sales/sales-orders/SalesOrderCommercialForm.tsx');
  assert.match(form, /const repriceLines = useCallback/);
  assert.match(form, /runWithConcurrency\(snapshot, REPRICE_CONCURRENCY/);
  assert.match(form, /const repriceAll = useCallback/);
  assert.match(form, /void repriceAll\(effectiveAt, customerMode, customerId, salesChannelId, priceSelectionMode\)/);
  assert.match(form, /const resolution = await priceFor\(\{\s*variantId: option\.id,\s*quantity: '1'/s);
});

test('Kết quả tính giá cũ chỉ bị loại trên đúng dòng thay đổi, không làm kẹt các dòng khác', async () => {
  const form = await read('app/sales/sales-orders/SalesOrderCommercialForm.tsx');
  assert.match(form, /pricingGenerationRef/);
  assert.doesNotMatch(form, /pricingRunRef/);
  assert.match(form, /pricingGenerationRef\.current\.get\(line\.clientLineId\) !== result\.pricingGeneration/);
  assert.match(form, /const lineGenerations = new Map/);
});
