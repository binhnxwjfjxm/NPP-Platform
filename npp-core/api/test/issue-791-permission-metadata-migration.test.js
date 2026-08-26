import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL('../../../database/migrations/shared/114_sales_order_permission_metadata.sql', import.meta.url);
const registryPath = new URL('../src/migrations/index.js', import.meta.url);
const permissionsPath = new URL('../src/access/permissions-sales.js', import.meta.url);

test('Issue #791 keeps Sales Order permission metadata aligned through a forward migration', async () => {
  const [migration, registry, permissions] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(registryPath, 'utf8'),
    readFile(permissionsPath, 'utf8'),
  ]);

  for (const value of [
    'core.sales-order.price.override',
    'Sửa giá bán trên đơn',
    'Cho phép sửa trực tiếp đơn giá trên dòng hàng; hệ thống tự lưu lịch sử thay đổi.',
    'core.sales-order.discount.override',
    'Sửa chiết khấu bán hàng',
    'Cho phép nhập chiết khấu theo từng dòng hoặc chiết khấu bổ sung toàn đơn theo đúng chính sách.',
  ]) {
    assert.match(migration, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(permissions, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(registry, /114_sales_order_permission_metadata/);
  assert.match(registry, /114_sales_order_permission_metadata\.sql/);
});
