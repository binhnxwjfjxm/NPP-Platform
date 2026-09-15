import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const formPath = fileURLToPath(new URL('../app/sales/sales-orders/SalesOrderForm.tsx', import.meta.url));
const commercialFormPath = fileURLToPath(new URL('../app/sales/sales-orders/SalesOrderCommercialForm.tsx', import.meta.url));

test('F4 đưa con trỏ vào tìm khách và cho chọn hoàn toàn bằng bàn phím', async () => {
  const form = await readFile(formPath, 'utf8');
  const commercial = await readFile(commercialFormPath, 'utf8');

  assert.ok(form.includes("const CUSTOMER_SEARCH_SELECTOR = '[data-testid=\"sales-customer-search-input\"]';"));
  assert.ok(form.includes("event.key === 'F4'"));
  assert.ok(form.includes("customerSearch?.setAttribute('aria-keyshortcuts', 'F4')"));
  assert.match(form, /target === currentCustomerSearch[\s\S]*?ArrowDown[\s\S]*?buttons\[0\]\?\.focus\(\)/);
  assert.match(form, /target === currentCustomerSearch[\s\S]*?Enter[\s\S]*?buttons\[0\]\?\.click\(\)/);
  assert.match(form, /target instanceof HTMLButtonElement[\s\S]*?CUSTOMER_RESULTS_SELECTOR[\s\S]*?ArrowDown[\s\S]*?focus\(\)/);
  assert.ok(commercial.includes('data-testid="sales-customer-results"'));
});

test('F3 dùng lại tìm hàng hiện hữu, Enter thêm hàng và giữ focus vào số lượng', async () => {
  const form = await readFile(formPath, 'utf8');
  const commercial = await readFile(commercialFormPath, 'utf8');

  assert.ok(form.includes("const PRODUCT_SEARCH_SELECTOR = '[aria-label=\"Nhập hàng hóa\"] input[autocomplete=\"off\"]';"));
  assert.ok(form.includes("event.key === 'F3'"));
  assert.ok(form.includes("productSearch?.setAttribute('aria-keyshortcuts', 'F3')"));
  assert.ok(commercial.includes('function handleSkuKeyDown'));
  assert.match(commercial, /event\.key === 'ArrowDown'[\s\S]*?event\.key === 'ArrowUp'[\s\S]*?event\.key === 'Enter'/);
  assert.ok(commercial.includes('void addSku(skuResults[activeSkuIndex]);'));
  assert.ok(commercial.includes('focusLineQuantity(pending.clientLineId);'));
});

test('phím mũi tên chỉnh SL và Tab đi thẳng sang đơn giá mà không đổi contract nghiệp vụ', async () => {
  const form = await readFile(formPath, 'utf8');

  assert.ok(form.includes("const QUANTITY_INPUT_PREFIX = 'Số lượng ';"));
  assert.ok(form.includes("event.key === 'ArrowUp' || event.key === 'ArrowDown'"));
  assert.ok(form.includes("event.key === 'ArrowUp' ? 'Tăng số lượng ' : 'Giảm số lượng '"));
  assert.ok(form.includes('action.click();'));
  assert.ok(form.includes("if (event.key === 'Tab')"));
  assert.ok(form.includes('input[aria-label^=\\"${PRICE_INPUT_PREFIX}\\"]'));
  assert.ok(form.includes('focusAndSelect(priceInput);'));
});

test('shortcut chỉ điều phối focus trong popup lập đơn, không phát sinh request hoặc thao tác dữ liệu', async () => {
  const form = await readFile(formPath, 'utf8');

  const start = form.indexOf('function useSalesOrderKeyboardShortcuts');
  const end = form.indexOf('export default function SalesOrderForm');
  const shortcutSource = form.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.ok(shortcutSource.includes("document.addEventListener('keydown', handleKeyDown, true)"));
  assert.ok(shortcutSource.includes('event.preventDefault();'));
  assert.ok(shortcutSource.includes('shortcutTargetIsIgnored(event.target)'));
  assert.doesNotMatch(shortcutSource, /apiRequest|fetch\(|mutationKey|setSkuTerm|setCustomerId/);
});
