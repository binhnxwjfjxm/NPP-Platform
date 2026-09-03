import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(relative) {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

test('sales order form replaces mutation keys only when its contents change', () => {
  const source = read('../app/sales/sales-orders/SalesOrderCommercialForm.tsx');
  assert.match(
    source,
    /const markDirty = useCallback\(\(\) => \{[\s\S]*?setSaveKey\(mutationKey\(`sales-\$\{props\.mode\}-save`\)\);[\s\S]*?setConfirmKey\(mutationKey\(`sales-\$\{props\.mode\}-confirm`\)\);/,
  );
});

test('sales order UI explains an idempotency payload mismatch in business language', () => {
  const source = read('../app/sales/sales-orders/sales-order-ui.ts');
  assert.match(source, /code === 'IDEMPOTENCY_PAYLOAD_MISMATCH'/);
  assert.match(source, /Nội dung đơn đã thay đổi\. Hãy lưu lại để hệ thống tạo yêu cầu mới\./);
});
