import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const form = readFileSync(new URL('../app/sales/sales-orders/SalesOrderCommercialForm.tsx', import.meta.url), 'utf8');

test('gõ tìm khách chỉ render bộ chọn khách, không cập nhật state của toàn form', () => {
  assert.match(form, /const ExistingCustomerPicker = memo/);
  const pickerStart = form.indexOf('const ExistingCustomerPicker = memo');
  const pickerEnd = form.indexOf('type OrderNoteFieldProps', pickerStart);
  assert.ok(pickerStart >= 0 && pickerEnd > pickerStart);
  const picker = form.slice(pickerStart, pickerEnd);
  assert.match(picker, /const \[search, setSearch\] = useState\(''\)/);
  assert.match(picker, /onChange=\{\(event\) => setSearch\(event\.target\.value\)\}/);
  assert.doesNotMatch(form, /const \[customerSearch, setCustomerSearch\]/);
});

test('chỉ chọn sang khách khác mới cập nhật customerId và chạy lại ngữ cảnh giá', () => {
  assert.match(form, /const selectExistingCustomer = useCallback\(\(nextCustomerId: string\) => \{\s*if \(nextCustomerId === customerId\) return;\s*setCustomerId\(nextCustomerId\);\s*markDirty\(\);/s);
  assert.match(form, /onSelect=\{selectExistingCustomer\}/);
  assert.match(form, /const signature = `\$\{customerMode\}:\$\{customerId\}:\$\{salesChannelId\}:\$\{priceSelectionMode\}`/);
  assert.match(form, /if \(pricingContextRef\.current === signature\) return/);
});

test('địa chỉ khách chỉ tải lại khi khách hoặc chế độ khách thực sự đổi', () => {
  const effectStart = form.indexOf("if (customerMode === 'WALK_IN')");
  const effectEnd = form.indexOf("useEffect(() => {\n    const term = skuTerm.trim();", effectStart);
  assert.ok(effectStart >= 0 && effectEnd > effectStart);
  const block = form.slice(effectStart, effectEnd);
  assert.match(block, /\[customerId, customerMode, hasVersionDirectDestination, onError\]\);/);
  assert.doesNotMatch(block, /\[collectionPolicy, customerId|priceSelectionMode\]\);/);
});
